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
import type { ReprocheStatement } from "@/features/investigation-analysis/types";

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
You receive structured extractions from several interviews in one case. Your job is to reproduce the analysis a human investigator writes in a formal investigation report: take each report-level grievance ("reproche") raised by the claimant, keep the claimant account, accused account, and reference person accounts strictly separated, then compare them only in the findings and evaluation.
Use only the material provided. Never infer guilt, never draw legal conclusions, and never invent facts, names, quotes, or events.
Use cautious professional report language: "the available elements indicate", "it has not been established", "appears", "is consistent with", "is not corroborated by", and similar formulations. Avoid dashboard-style summaries, slogans, or categorical conclusions that go beyond the evidence.
You reference evidence only by the ids given to you (interview ids, quote ids, event ids). Use quote text only as rare, short inline fragments inside account prose when the exact wording matters. The report interface resolves quote ids back to verbatim, page-cited evidence, so any id you invent or place under the wrong source will be dropped.
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
- quotes: verified verbatim evidence items, each with an id, the interview it came from, and the speaker. Use these only to support rare short inline quote fragments in account prose.
- events: case-level events, each with an id.
- witnesses: consolidated witness names.

Produce:
1. scopeSummary: a concise statement of what this whole case is about — the core dispute, the main parties, and the nature of the grievances.
2. reproches: one object per report-level grievance the claimant raises. Group related events, examples, dates, and repeated behaviours into the same reproche when they concern the same alleged course of conduct or workplace issue. Do not create one reproche per minor event; prefer a few well-scoped grievances over many near-duplicates. For each:
   - id: a stable id you assign (e.g. "r1").
   - title: a short, neutral label for the grievance (e.g. "Excessive control over expense approvals").
   - grievanceType: "Recurring" when the grievance is about a frequent or systematic behaviour over time; "Incident" when it is about a single, datable moment; "Unclear" otherwise.
   - description: one or two neutral sentences framing what is being alleged.
   - claimantStatement: { interviewId, summary, quoteIds } — answer "What does the claimant allege?" using only the claimant interview. Write one neutral report-style paragraph, not extracted bullet facts. Do not include the accused response, reference person views, credibility assessment, corroboration, contradiction, or evaluation in this summary. Use at most 1-2 short inline quote fragments from verified claimant quotes only when exact wording is important. Include only the quoteIds that support those inline fragments. Use null interviewId and an empty summary only if the claimant did not address it.
   - accusedStatement: { interviewId, summary, quoteIds } — answer "How does the accused respond?" using only the accused interview. Write one neutral report-style paragraph, not extracted bullet facts. Do not include claimant assertions, reference person views, credibility assessment, corroboration, contradiction, or evaluation in this summary. Use at most 1-2 short inline quote fragments from verified accused quotes only when exact wording is important. Include only the quoteIds that support those inline fragments. If the accused was not interviewed or did not address it, use null interviewId and note that in the evaluation.
   - referenceStatements: an array of { interviewId, summary, quoteIds }, one per reference person who spoke to this grievance, in a stable order (they render as "Reference person 1", "Reference person 2", …). Each summary answers "What does this reference person say?" using only that reference person's own interview. Write one neutral report-style paragraph per reference person. Do not merge several reference persons into one summary. Do not include claimant assertions, accused responses, credibility assessment, corroboration, contradiction, or evaluation in these summaries. Use at most 1 short inline quote fragment from that reference person's verified quotes only when exact wording is important. Include only the quoteId that supports that inline fragment. Omit reference persons who said nothing relevant.
   - findings: bullet points answering "What can and cannot be established from the available elements?" Compare accounts here only. Capture convergence, divergence, corroboration, lack of corroboration, and limits of the record in cautious terms.
   - evaluation: a prose paragraph that weighs the claimant account, accused account, reference person accounts, and available evidence against each other, then justifies the verdict. Only this field may compare accounts or assess credibility. Stay factual and cautious; do not assert legal conclusions or guilt.
   - verdict: one of "Supported", "Partially supported", "Not established", "Word against word" (directly conflicting accounts with no corroboration either way), or "Requires investigator assessment".
   - openQuestions: what still needs to be clarified for this grievance.
   - relatedEventIds: event ids relevant to this grievance.
3. globalAssessment: a short case-level synthesis across all grievances — the overall picture, whether a pattern emerges, and the weight of the findings taken together. Do not state a legal conclusion.
4. gaps: missingInterviews (people/roles still to interview), missingEvidence, missingClarification.

Rules:
- Use ONLY ids that appear in the provided data. Do not invent ids, names, or quotes.
- Account summaries should read like professional investigation-report prose, not extraction output. Prefer neutral paraphrase over quotation.
- Do not create standalone quote lists, quote blocks, or transcript excerpts in any generated field.
- Inline quote fragments must be rare, short, and embedded naturally in the sentence. Target 1-6 words; never paste full transcript sentences.
- Use inline quote fragments only for important wording, labels, tone, or contested expressions. Do not quote every factual sentence.
- Every inline quote fragment must be copied exactly from one verified quote in that same account's quoteIds.
- Every quoteId you cite in a statement must come from exactly the same interview as that statement's interviewId.
- Do not cite quoteIds in findings, evaluation, globalAssessment, gaps, or openQuestions.
- Quote targets: claimantStatement 0-2 quoteIds, accusedStatement 0-2 quoteIds, each referenceStatement 0-1 quoteId. Use none when no strong quote fragment is needed.
- Leave an array empty (and a summary blank) when there is genuinely nothing to report.
- Keep account sections strictly source-separated: claimantStatement from claimant-role interviews, accusedStatement from accused-role interviews, and referenceStatements from reference-role interviews. If an interview's roleHint does not fit the section, do not use it there.
- Do not evaluate credibility, reliability, plausibility, corroboration, contradiction, or evidentiary weight inside claimantStatement, accusedStatement, or referenceStatements. Put all comparisons in findings and evaluation.
- When an account reports what someone else allegedly said or did, keep that hearsay attribution explicit in that same account: e.g. "The claimant reports that X allegedly told him..." Do not turn another person's reported words into established fact until findings and evaluation.
- Each reproche must clearly answer: what the claimant alleges, how the accused responds, what reference persons say, and what can and cannot be established from the available elements.
- Write in the style of a professional investigation report, not a dashboard.

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
  const roleByInterviewId = new Map(
    aggregate.ai.interviews.map((interview) => [interview.id, interview.roleHint])
  );
  const reproches = ai.reproches.map((reproche) => ({
    ...reproche,
    claimantStatement: sanitizeStatementQuotes(
      reproche.claimantStatement,
      aggregate,
      roleByInterviewId,
      "claimant",
      2
    ),
    accusedStatement: sanitizeStatementQuotes(
      reproche.accusedStatement,
      aggregate,
      roleByInterviewId,
      "accused",
      2
    ),
    referenceStatements: reproche.referenceStatements.map((statement) =>
      sanitizeStatementQuotes(
        statement,
        aggregate,
        roleByInterviewId,
        "reference",
        1
      )
    ),
  }));

  // Map each interview to its interviewee's normalized name, then collect, per
  // person, the grievances any of their interviews participate in.
  const personKeyByInterviewId = new Map(
    aggregate.interviews.map((i) => [i.id, normalizeText(i.name)])
  );
  const reprocheIdsByPersonKey = new Map<string, string[]>();
  for (const reproche of reproches) {
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
    reprocheCount: reproches.length || aggregate.counts.reprocheCount,
    witnessCount: aggregate.counts.witnessCount,
    eventCount: aggregate.counts.eventCount,
    scopeSummary: ai.scopeSummary,
    globalAssessment: ai.globalAssessment,
    interviews: aggregate.interviews,
    quotes: aggregate.quotes,
    mainParties: aggregate.mainParties,
    reproches,
    timeline: aggregate.timeline,
    people,
    witnesses: aggregate.witnesses,
    gaps: ai.gaps,
  };

  // Validate the assembled object so a schema drift fails loudly here (on write)
  // rather than silently when the dashboard later reads it back.
  return investigationAnalysisSchema.parse(analysis);
}

function sanitizeStatementQuotes(
  statement: ReprocheStatement,
  aggregate: AggregateResult,
  roleByInterviewId: Map<string, "claimant" | "accused" | "reference">,
  expectedRole: "claimant" | "accused" | "reference",
  limit: number
): ReprocheStatement {
  if (!statement.interviewId) {
    return { ...statement, quoteIds: [] };
  }

  if (roleByInterviewId.get(statement.interviewId) !== expectedRole) {
    return { interviewId: null, summary: "", quoteIds: [] };
  }

  const quoteIds = uniqueIds(statement.quoteIds).filter((quoteId) => {
    const quote = aggregate.quoteById.get(quoteId);
    return (
      quote?.documentId === statement.interviewId &&
      quote.provenanceId !== null &&
      quote.page !== null
    );
  });

  return {
    ...statement,
    quoteIds: quoteIds.slice(0, limit),
  };
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}
