import "server-only";

import { ZodError } from "zod";

import type { CaseDocument } from "@/lib/types";
import { getAnalysisProvider } from "@/features/extraction/lib/providers";
import {
  analysisResponseSchema,
  investigationAnalysisSchema,
  type AnalysisResponse,
  type InvestigationAnalysis,
} from "@/features/investigation-analysis/validation";
import { buildAggregate, type AggregateResult } from "@/features/investigation-analysis/lib/aggregate";
import { normalizeText } from "@/features/investigation-analysis/lib/catalog";

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
You receive structured extractions from several interviews in one case. Your job is to reproduce the analysis a human investigator writes in a formal report: take each distinct grievance ("reproche") raised by the claimant, and triangulate it ACROSS the interviews — the claimant's account, the accused person's account, and each reference person's account — then reach a reasoned finding.
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

  return `Analyze this workplace investigation case grievance by grievance, the way an investigation report does.

You are given, as JSON:
- interviews: one object per interview (id, name, role, roleHint, date, issue, primaryClaimants, primaryAccused, allegations, events, witnesses, people). "roleHint" is the investigator-assigned party role for the interviewee ("claimant", "accused", or "reference"). Use it to slot accounts; do not override it from extracted scope text.
- quotes: verbatim evidence items, each with an id, the interview it came from, and the speaker. Reference these by id only.
- events: case-level events, each with an id.
- witnesses: consolidated witness names.

Produce:
1. scopeSummary: a concise statement of what this whole case is about — the core dispute, the main parties, and the nature of the grievances.
2. reproches: one object per distinct grievance the claimant raises. Consolidate per-interview allegations that describe the same underlying grievance into ONE reproche; prefer a few well-scoped grievances over many near-duplicates. For each:
   - id: a stable id you assign (e.g. "r1").
   - title: a short, neutral label for the grievance (e.g. "Excessive control over expense approvals").
   - grievanceType: "Recurring" when the grievance is about a frequent or systematic behaviour over time; "Incident" when it is about a single, datable moment; "Unclear" otherwise.
   - description: one or two neutral sentences framing what is being alleged.
   - claimantStatement: { interviewId, summary, quoteIds } — the claimant's account of THIS grievance. interviewId is the claimant's interview; summary paraphrases what they said about it; quoteIds cite their words. Use null interviewId and an empty summary only if the claimant did not address it.
   - accusedStatement: { interviewId, summary, quoteIds } — the accused person's response to THIS grievance, same shape. If the accused was not interviewed or did not address it, use null interviewId and note that in the evaluation.
   - referenceStatements: an array of { interviewId, summary, quoteIds }, one per reference person who spoke to this grievance, in a stable order (they render as "Reference person 1", "Reference person 2", …). Omit reference persons who said nothing relevant.
   - findings: bullet points capturing where the accounts converge and where they diverge.
   - evaluation: a prose paragraph that weighs the accounts against each other and the evidence, assesses credibility where the accounts conflict, and justifies the verdict. Stay factual; do not assert legal conclusions or guilt.
   - verdict: one of "Supported", "Partially supported", "Not established", "Word against word" (directly conflicting accounts with no corroboration either way), or "Requires investigator assessment".
   - openQuestions: what still needs to be clarified for this grievance.
   - relatedEventIds: event ids relevant to this grievance.
3. globalAssessment: a short case-level synthesis across all grievances — the overall picture, whether a pattern emerges, and the weight of the findings taken together. Do not state a legal conclusion.
4. gaps: missingInterviews (people/roles still to interview), missingEvidence, missingClarification.

Rules:
- Use ONLY ids that appear in the provided data. Do not invent ids, names, or quotes.
- Reference quotes by id only; never copy quote text into your output.
- Every quoteId you cite in a statement must come from an interview consistent with that statement's interviewId where possible.
- Leave an array empty (and a summary blank) when there is genuinely nothing to report.

Case data:
${JSON.stringify(payload)}

Return ONLY valid JSON matching the schema described above.`;
}

async function requestAnalysis(prompt: string): Promise<AnalysisResponse> {
  const { content, truncated } = await getAnalysisProvider().complete({
    system: SYSTEM_PROMPT,
    user: prompt,
  });

  if (!content) {
    throw new AnalysisError("The AI returned an empty analysis.");
  }
  if (truncated) {
    throw new AnalysisError(
      "The AI analysis was cut off before it finished. Try again.",
      { detail: `truncated, chars=${content.length}` }
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
 * aggregate from the documents' extractions, ask the model to triangulate each
 * grievance across the interviews, then merge the model's id-referencing
 * reasoning with the aggregate into the persisted dashboard shape. Throws
 * {@link AnalysisError} on any failure.
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
 * witnesses, people) into the final validated analysis. Person profiles link to
 * the grievances they take part in (as claimant, accused, or reference person)
 * so every quote/event/grievance a person is tied to stays traceable without
 * trusting the model to repeat ids.
 */
function mergeAnalysis(
  aggregate: AggregateResult,
  ai: AnalysisResponse
): InvestigationAnalysis {
  // Map each interview to its interviewee's normalized name, then collect, per
  // person, the grievances any of their interviews participate in.
  const personKeyByInterviewId = new Map(
    aggregate.interviews.map((i) => [i.id, normalizeText(i.name)])
  );
  const reprocheIdsByPersonKey = new Map<string, string[]>();
  for (const reproche of ai.reproches) {
    const interviewIds = [
      reproche.claimantStatement.interviewId,
      reproche.accusedStatement.interviewId,
      ...reproche.referenceStatements.map((s) => s.interviewId),
    ].filter((id): id is string => Boolean(id));

    const personKeys = new Set(
      interviewIds
        .map((id) => personKeyByInterviewId.get(id))
        .filter((key): key is string => Boolean(key))
    );
    for (const key of personKeys) {
      const list = reprocheIdsByPersonKey.get(key) ?? [];
      list.push(reproche.id);
      reprocheIdsByPersonKey.set(key, list);
    }
  }

  const people = aggregate.people.map((person) => {
    const key = normalizeText(person.name);
    return {
      name: person.name,
      interviewIds: person.interviewIds,
      relatedReprocheIds: reprocheIdsByPersonKey.get(key) ?? [],
      supportingQuoteIds: aggregate.quoteIdsBySpeaker.get(key) ?? [],
      eventIds: aggregate.eventIdsByPerson.get(key) ?? [],
      witnesses: [],
    };
  });

  const analysis = {
    generatedAt: new Date().toISOString(),
    interviewCount: aggregate.counts.interviewCount,
    reprocheCount: ai.reproches.length || aggregate.counts.reprocheCount,
    witnessCount: aggregate.counts.witnessCount,
    eventCount: aggregate.counts.eventCount,
    scopeSummary: ai.scopeSummary,
    globalAssessment: ai.globalAssessment,
    interviews: aggregate.interviews,
    quotes: aggregate.quotes,
    mainParties: aggregate.mainParties,
    reproches: ai.reproches,
    timeline: aggregate.timeline,
    people,
    witnesses: aggregate.witnesses,
    gaps: ai.gaps,
  };

  // Validate the assembled object so a schema drift fails loudly here (on write)
  // rather than silently when the dashboard later reads it back.
  return investigationAnalysisSchema.parse(analysis);
}
