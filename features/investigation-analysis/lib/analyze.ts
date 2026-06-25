import "server-only";

import OpenAI from "openai";
import { ZodError } from "zod";

import { env } from "@/lib/env";
import type { CaseDocument } from "@/lib/types";
import {
  analysisResponseSchema,
  investigationAnalysisSchema,
  type AnalysisResponse,
  type InvestigationAnalysis,
} from "@/features/investigation-analysis/validation";
import { buildAggregate, type AggregateResult } from "@/features/investigation-analysis/lib/aggregate";
import { normalizeText } from "@/features/investigation-analysis/lib/catalog";

let client: OpenAI | null = null;

function getClient() {
  if (!client) client = new OpenAI({ apiKey: env.openaiApiKey });
  return client;
}

/**
 * A failure produced while turning the model's cross-interview reasoning into a
 * validated analysis. `userMessage` is safe to surface to investigators; the
 * underlying JSON/Zod diagnostics are logged server-side only.
 */
export class AnalysisError extends Error {
  readonly userMessage: string;
  readonly detail?: string;

  constructor(
    userMessage: string,
    options: { detail?: string; cause?: unknown } = {}
  ) {
    super(userMessage, options.cause ? { cause: options.cause } : undefined);
    this.name = "AnalysisError";
    this.userMessage = userMessage;
    this.detail = options.detail;
  }
}

const SYSTEM_PROMPT = `You are a cross-interview investigation analyst for workplace investigators.
You receive structured extractions from several interviews in one case. Your job is to reason ACROSS interviews: consolidate duplicate allegations, identify patterns, surface contradictions between accounts, and name the evidence gaps that block findings.
Use only the material provided. Never infer guilt, never draw legal conclusions, and never invent facts, names, quotes, or events.
You reference evidence only by the ids given to you (interview ids, quote ids, event ids). NEVER reproduce quote text — cite the quote id instead. The dashboard resolves ids back to verbatim, page-cited evidence, so any id you invent will be dropped.
Return ONLY valid JSON matching the requested schema — no markdown, no commentary.`;

function buildUserPrompt(aggregate: AggregateResult): string {
  const payload = {
    interviews: aggregate.ai.interviews,
    quotes: aggregate.ai.quotes,
    events: aggregate.ai.events,
    witnesses: aggregate.witnesses.map((w) => w.name),
  };

  return `Analyze this workplace investigation case across its interviews.

You are given, as JSON:
- interviews: one object per interview (id, name, role, date, issue, primaryClaimants, primaryAccused, allegations, events, witnesses, people).
- quotes: verbatim evidence items, each with an id, the interview it came from, and the speaker. Reference these by id only.
- events: case-level events, each with an id.
- witnesses: consolidated witness names.

Produce:
1. scopeSummary: a concise statement of what this whole case is about — the core dispute, the main parties, and the nature of the allegations.
2. allegations: consolidate the per-interview allegations into case-level allegations. Merge ones that describe the same underlying claim even when worded differently. For each:
   - id: a stable id you assign (e.g. "a1").
   - title: a short label. description: one or two sentences.
   - claimants / subjects: canonical person names.
   - relatedInterviewIds: every interview that touches this allegation.
   - supportingInterviewIds / contradictoryInterviewIds: interviews whose accounts support vs. conflict with it.
   - supportingQuoteIds / contradictoryQuoteIds: quote ids (from the quotes list) that support vs. weaken it.
   - relatedWitnesses: witness names relevant to it.
   - relatedEventIds: event ids relevant to it.
   - timelineConsistency: a short note on whether the timeline of accounts is consistent.
   - openQuestions: what still needs to be clarified.
3. mobbingPatterns: recurring behavioural patterns across interviews (e.g. exclusion, repeated criticism). For each: id, title, targets, perpetrators, relatedAllegationIds, relatedInterviewIds, supportingQuoteIds, timelineConsistency, repetition ("Repeated" | "Isolated" | "Unclear"), systematicity ("Systematic" | "Isolated" | "Unclear"), missingEvidence.
4. contradictions: concrete conflicts between two accounts. For each: id, description, interviewAId, interviewBId, quoteIdsA, quoteIdsB.
5. gaps: missingInterviews (people/roles still to interview), missingEvidence, missingClarification.

Rules:
- Use ONLY ids that appear in the provided data. Do not invent ids, names, or quotes.
- Reference quotes by id only; never copy quote text into your output.
- Prefer fewer, well-consolidated allegations over many near-duplicates.
- Leave an array empty when there is genuinely nothing to report.

Case data:
${JSON.stringify(payload)}

Return ONLY valid JSON matching the schema described above.`;
}

async function requestAnalysis(prompt: string): Promise<AnalysisResponse> {
  const completion = await getClient().chat.completions.create({
    model: env.openaiModel,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  const choice = completion.choices[0];
  const content = choice?.message?.content;
  if (!content) {
    throw new AnalysisError("The AI returned an empty analysis.");
  }
  if (choice.finish_reason === "length") {
    throw new AnalysisError(
      "The AI analysis was cut off before it finished. Try again.",
      { detail: `finish_reason=length, chars=${content.length}` }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new AnalysisError(
      "The AI returned a response that was not valid JSON.",
      { cause: error, detail: content.slice(0, 1000) }
    );
  }

  try {
    return analysisResponseSchema.parse(parsed);
  } catch (error) {
    throw new AnalysisError("The AI analysis did not match the expected format.", {
      cause: error,
      detail:
        error instanceof ZodError
          ? error.issues.map((i) => i.path.join(".")).join(", ")
          : String(error),
    });
  }
}

/**
 * Run the full cross-interview analysis for a case: build the deterministic
 * aggregate from the documents' extractions, ask the model to reason over it,
 * then merge the model's id-referencing reasoning with the aggregate into the
 * persisted dashboard shape. Throws {@link AnalysisError} on any failure.
 */
export async function generateCaseAnalysis(
  documents: CaseDocument[]
): Promise<InvestigationAnalysis> {
  const aggregate = buildAggregate(documents);

  if (aggregate.counts.interviewCount === 0) {
    throw new AnalysisError(
      "No extracted interviews to analyze. Extract at least one document first."
    );
  }

  const ai = await requestAnalysis(buildUserPrompt(aggregate));
  return mergeAnalysis(aggregate, ai);
}

/**
 * Combine the model's reasoning (which references evidence by id) with the
 * deterministic aggregates the server owns (clickable quotes, timeline, parties,
 * witnesses, people) into the final validated analysis. Person profiles are
 * derived here so every quote/event/allegation a person is linked to stays
 * traceable without trusting the model to repeat ids.
 */
function mergeAnalysis(
  aggregate: AggregateResult,
  ai: AnalysisResponse
): InvestigationAnalysis {
  const people = aggregate.people.map((person) => {
    const key = normalizeText(person.name);
    const relatedAllegationIds = ai.allegations
      .filter((allegation) =>
        [...allegation.claimants, ...allegation.subjects].some(
          (name) => normalizeText(name) === key
        )
      )
      .map((allegation) => allegation.id);

    return {
      name: person.name,
      interviewIds: person.interviewIds,
      relatedAllegationIds,
      supportingQuoteIds: aggregate.quoteIdsBySpeaker.get(key) ?? [],
      eventIds: aggregate.eventIdsByPerson.get(key) ?? [],
      witnesses: [],
    };
  });

  const analysis = {
    generatedAt: new Date().toISOString(),
    interviewCount: aggregate.counts.interviewCount,
    allegationCount: ai.allegations.length || aggregate.counts.allegationCount,
    witnessCount: aggregate.counts.witnessCount,
    eventCount: aggregate.counts.eventCount,
    scopeSummary: ai.scopeSummary,
    interviews: aggregate.interviews,
    quotes: aggregate.quotes,
    mainParties: aggregate.mainParties,
    allegations: ai.allegations,
    mobbingPatterns: ai.mobbingPatterns.map((pattern) => ({
      ...pattern,
      status: "Requires investigator assessment",
    })),
    contradictions: ai.contradictions,
    timeline: aggregate.timeline,
    people,
    witnesses: aggregate.witnesses,
    gaps: ai.gaps,
  };

  // Validate the assembled object so a schema drift fails loudly here (on write)
  // rather than silently when the dashboard later reads it back.
  return investigationAnalysisSchema.parse(analysis);
}
