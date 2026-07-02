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
import {
  buildAggregate,
  type AggregateResult,
} from "@/features/investigation-analysis/lib/aggregate";
import { normalizeText } from "@/features/investigation-analysis/lib/catalog";
import {
  findQuoteTextMatch,
  quoteSupportsVisibleInlineFragment,
  removeUnsupportedInlineQuotes,
} from "@/features/investigation-analysis/lib/quote-matching";
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
    options: { detail?: string; cause?: unknown } = {},
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
A reproche is valid only if it is clearly grounded in the case material. Do not generate a reproche from pure inference, from context alone, or because something could theoretically be problematic. The title and summary must never be stronger than the source: keep subjective feelings attributed to the speaker, keep hearsay marked as hearsay, and never turn context into established misconduct. When in doubt, downgrade an item to context or merge it into a broader reproche rather than create a weak standalone allegation.
Use cautious professional report language: "the available elements indicate", "it has not been established", "appears", "is consistent with", "is not corroborated by", and similar formulations. Prefer "better supported by the available elements" over "more plausible" when comparing versions. Avoid dashboard-style summaries, slogans, or categorical conclusions that go beyond the evidence.
You reference evidence only by the ids given to you (interview ids, quote ids, event ids). Use quote text only as rare, short inline fragments inside account prose when the exact wording matters. The report interface resolves quote ids back to verbatim, page-cited evidence, so any id you invent or place under the wrong source will be dropped.
Return ONLY valid JSON matching the requested schema — no markdown, no commentary.`;

function buildUserPrompt(aggregate: AggregateResult): string {
  const payload = {
    interviews: aggregate.ai.interviews,
    quotes: aggregate.ai.quotes,
    events: aggregate.ai.events,
    witnesses: aggregate.witnesses.map((witness) => ({
      name: witness.name,
      relatedAllegations: witness.relatedAllegations,
      whyTheyMatter: witness.whyTheyMatter,
    })),
  };

  return `Analyze this workplace investigation case grievance by grievance, the way an investigation report does.

You are given, as JSON:
- interviews: one object per interview (id, name, role, roleHint, date, issue, primaryClaimants, primaryAccused, allegations, events, witnesses, people). Each allegation may include supportingEvidence, contradictoryEvidence, missingEvidence, and followUpQuestions extracted from that same interview. "roleHint" is the investigator-assigned party role for the interviewee ("claimant", "accused", or "reference"). Use it to slot accounts; do not override it from extracted scope text.
- quotes: verified verbatim evidence items, each with an id, the interview it came from, and the speaker. Use these only to support rare short inline quote fragments in account prose.
- events: case-level events, each with an id.
- witnesses: consolidated witness names.

Produce:
1. scopeSummary: a concise statement of what this whole case is about — the core dispute, the main parties, the time frame if available, and the nature of the grievances. Keep it under 100 words.
2. reproches: one object per report-level grievance the claimant raises. Generate a standalone reproche ONLY when at least one of these is clearly true in the source: (1) the claimant explicitly alleges it; (2) the accused explicitly responds to it as an allegation; (3) a reference person explicitly raises it as a concern; (4) a documented incident clearly creates a disputed issue; or (5) multiple source-grounded facts form a clear disputed pattern. Do not generate a reproche from context only. Group related events, examples, dates, and repeated behaviours into the same reproche when they concern the same alleged course of conduct or workplace issue. Do not create one reproche per minor event; prefer a few well-scoped grievances over many near-duplicates. For each:
   - id: a stable id you assign (e.g. "r1").
   - title: a short, neutral, cautious label for the grievance. Prefer hedged framings: "Reproach of alleged...", "Reproach concerning...", "Reproach of perceived...", "Reproach of disputed...", "Reproach of insufficiently clarified...", "Reproach relating to...". Do not state disputed conduct as established fact (avoid "Caroline excluded...", "Caroline humiliated...", "Serge failed...", "Caroline manipulated...") unless that conduct is already established in the source. The title must never be stronger than the source.
   - sourceBasis: how this reproche is grounded in the case material — exactly one of "explicit_claimant_allegation" (the claimant explicitly alleges it), "explicit_accused_response" (the accused explicitly responds to it as an allegation), "explicit_reference_concern" (a reference person explicitly raises it as a concern), "documented_incident" (a documented incident clearly creates a disputed issue), "source_grounded_pattern" (multiple source-grounded facts form a clear disputed pattern), or "context_only" (only background/context supports it, with no explicit allegation, response, concern, incident, or grounded pattern). Use "context_only" honestly when none of the first five clearly applies — such items will be removed as standalone reproaches and should instead live as context inside another reproache's findings.
   - sourceBasisInterviewIds: interview ids that directly support the sourceBasis. Include the claimant interview for explicit claimant allegations, the accused interview for explicit accused responses, reference interviews for explicit reference concerns, and any interviews containing the source-grounded facts or documented incident.
   - sourceBasisQuoteIds: quote ids that directly support the sourceBasis. Use only verified quote ids from the supporting interviews. Leave empty only when the basis is supported by extracted allegations/events but no verified quote exists.
   - sourceBasisEventIds: event ids that directly support the sourceBasis. Required for "documented_incident" when an event id exists.
   - amplificationRisk: "low", "medium", or "high". Set "high" when the title states disputed conduct as fact, the reproache rests on one weak inference or only on hearsay, it turns a subjective feeling into an established act, it uses wording stronger than the source, or it is mainly professional context rather than an allegation. If the risk is high, first soften the title, merge the item into a broader reproache, or mark it sourceBasis "context_only" — do not emit a high-risk standalone reproache you could have softened.
   - grievanceType: "Recurring" when the grievance is about a frequent or systematic behaviour over time; "Incident" when it is about a single, datable moment; "Unclear" otherwise.
   - description: one or two neutral sentences framing what is being alleged.
   - claimantStatement: { interviewId, summary, quoteIds } — answer "What does the claimant allege?" using only the claimant interview. Write one neutral report-style paragraph, not extracted bullet facts. Do not include the accused response, reference person views, credibility assessment, corroboration, contradiction, or evaluation in this summary. Include 1-2 short inline quote fragments from verified claimant quotes for the key contested wording (include at least one whenever verified claimant quote evidence exists). Include only the quoteIds that support those inline fragments. Use null interviewId and an empty summary only if the claimant did not address it.
   - accusedStatement: { interviewId, summary, quoteIds } — answer "How does the accused respond?" using only the accused interview. Write one neutral report-style paragraph, not extracted bullet facts. Do not include claimant assertions, reference person views, credibility assessment, corroboration, contradiction, or evaluation in this summary. Include 1-2 short inline quote fragments from verified accused quotes for the key contested wording (include at least one whenever verified accused quote evidence exists). Include only the quoteIds that support those inline fragments. If the accused was not interviewed or did not address it, use null interviewId and note that in the evaluation.
   - referenceStatements: an array of { interviewId, summary, quoteIds }, one per reference person who spoke to this grievance, in a stable order (they render as "Reference person 1", "Reference person 2", …). Each summary answers "What does this reference person say?" using only that reference person's own interview. Write one neutral report-style paragraph per reference person. Do not merge several reference persons into one summary. Do not include claimant assertions, accused responses, credibility assessment, corroboration, contradiction, or evaluation in these summaries. Include 1 short inline quote fragment from that reference person's verified quotes when verified quote evidence exists. Include only the quoteId that supports that inline fragment. Omit reference persons who said nothing relevant.
   - findings: bullet points answering "What can and cannot be established from the available elements?" Compare accounts here only. Capture convergence, divergence, corroboration, contradiction, available supporting/contradictory evidence, and limits of the record in cautious terms. Include both elements that support the grievance and elements that limit or weaken it.
   - evaluation: a prose paragraph that weighs the claimant account, accused account, reference person accounts, and available evidence against each other, then justifies the verdict. Only this field may compare accounts or assess credibility. Stay factual and cautious; do not assert legal conclusions, guilt, or a definitive plausibility finding.
   - verdict: one of "Supported", "Partially supported", "Not established", "Word against word" (directly conflicting accounts with no corroboration either way), or "Requires investigator assessment".
   - openQuestions: what still needs to be clarified for this grievance, using extracted followUpQuestions and missingEvidence when relevant.
   - relatedEventIds: event ids relevant to this grievance.
3. globalAssessment: a short case-level synthesis across all grievances — the overall picture, whether a pattern emerges, and the weight of the findings taken together. Do not state a legal conclusion.
4. gaps: missingInterviews (people/roles still to interview), missingEvidence, missingClarification.

Anti-amplification rule — the title and summary must never be stronger than the source:
- If the source says "Philippe felt excluded", write "Reproach of perceived exclusion from certain communications or decisions"; do NOT write "Caroline excluded Philippe".
- If the source says "Christophe felt uncomfortable", write "Christophe describes discomfort regarding the situation"; do NOT write "Christophe confirms harassment".
- If the source says "Serge does not recall", write "Serge does not recall the event"; do NOT write "Serge denies the event".

Self-check before keeping each reproche — verify all of: (1) who explicitly raised this issue; (2) which interview or document supports it; (3) what exact conduct, omission, or disputed situation is alleged; (4) whether this is a real reproche or only context; (5) whether the title is neutral; (6) whether the wording is stronger than the evidence; (7) whether it is better as a standalone reproche or as supporting context inside another. If any answer is unclear, mark sourceBasis "context_only" (so it is dropped as a standalone) or merge it into a broader reproche.

Rules:
- Use ONLY ids that appear in the provided data. Do not invent ids, names, or quotes.
- Use the extracted supportingEvidence, contradictoryEvidence, missingEvidence, and followUpQuestions as analytical inputs only. Do not copy them mechanically if they are redundant or not relevant to the consolidated grievance.
  - Account summaries should read like professional investigation-report prose, not extraction output. Write the surrounding narration in your own neutral words, and quote the key contested wording verbatim — never paraphrase or reword the text inside the quotation marks.
- The anti-amplification and caution rules govern titles and claims, NOT quoting. They are not a reason to drop quotes: keep using short verified quote fragments. Quoting the source verbatim is the opposite of amplification — it keeps the exact wording attributable to the speaker.
- Inline quotes are expected, not optional: each account must include at least one short verified quote fragment whenever verified quote evidence from that account's own source exists. The goal is short inline quotes, not removing quotes.
- Inline quote fragments must be short and embedded naturally in the sentence. Target 1-6 words; never paste full transcript sentences.
- Use inline quote fragments for important wording, labels, tone, or contested expressions. Do not quote every factual sentence, and do not create standalone quote lists, quote blocks, or transcript excerpts in any field.
- Every inline quote fragment must be copied exactly (verbatim, word-for-word) from one verified quote in that same account's quoteIds. Do not invent quote text, do not reword a quote, and do not put unverified wording in quotation marks.
- Do not put any text in quotation marks unless that exact wording appears in one of the statement's verified quoteIds. Any unsupported quotation marks will be stripped before saving.
- Every quoteId you cite in a statement must come from exactly the same interview as that statement's interviewId, and the exact quoted wording from that quote must appear visibly in the statement summary. Never cite a quoteId as a hidden source only. Never move a quote across accounts (claimant prose uses claimant quotes only, accused prose uses accused quotes only, each reference person uses their own quotes only).
- Do not cite quoteIds in findings, evaluation, globalAssessment, gaps, or openQuestions.
- Quote targets: claimantStatement 1-2 quoteIds, accusedStatement 1-2 quoteIds, each referenceStatement 1 quoteId when verified evidence exists. Do not exceed this — never 4-5 quotes per account, and do not repeat the same evidence.
- Leave an array empty (and a summary blank) when there is genuinely nothing to report.
- Keep account sections strictly source-separated: claimantStatement from claimant-role interviews, accusedStatement from accused-role interviews, and referenceStatements from reference-role interviews. If an interview's roleHint does not fit the section, do not use it there.
- Do not evaluate credibility, reliability, plausibility, corroboration, contradiction, or evidentiary weight inside claimantStatement, accusedStatement, or referenceStatements. Put all comparisons in findings and evaluation.
- When an account reports what someone else allegedly said or did, keep that hearsay attribution explicit in that same account: e.g. "The claimant reports that X allegedly told him..." Do not turn another person's reported words into established fact until findings and evaluation.
- Each reproche must clearly answer: what the claimant alleges, how the accused responds, what reference persons say, and what can and cannot be established from the available elements.
- When versions conflict, describe the subject of the contradiction, the competing versions, and what would clarify it. Do not resolve the conflict unless the provided evidence clearly supports one version.
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
      { detail: `truncated, chars=${content.length}` },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new AnalysisError(
      "The AI returned a response that was not valid JSON.",
      { cause: error, detail: content.slice(0, 1000) },
    );
  }

  try {
    return analysisResponseSchema.parse(parsed);
  } catch (error) {
    throw new AnalysisError(
      "The AI analysis did not match the expected format.",
      {
        cause: error,
        detail:
          error instanceof ZodError
            ? error.issues.map((i) => i.path.join(".")).join(", ")
            : String(error),
      },
    );
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
  documents: CaseDocument[],
): Promise<InvestigationAnalysis> {
  const aggregate = buildAggregate(documents);

  if (aggregate.counts.interviewCount === 0) {
    throw new AnalysisError(
      "No extracted interviews to analyze. Extract at least one document first.",
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
  ai: AnalysisResponse,
): InvestigationAnalysis {
  const roleByInterviewId = new Map(
    aggregate.ai.interviews.map((interview) => [
      interview.id,
      interview.roleHint,
    ]),
  );
  const eventIds = new Set(aggregate.ai.events.map((event) => event.id));

  const groundedReproches = ai.reproches.filter((reproche) =>
    isStandaloneReproche(reproche, aggregate, roleByInterviewId, eventIds),
  );
  const droppedCount = ai.reproches.length - groundedReproches.length;
  if (droppedCount > 0) {
    console.info(
      `[analysis] dropped ${droppedCount} ungrounded or high-risk reproche(s) of ${ai.reproches.length}`,
    );
  }

  const reproches = groundedReproches.map((reproche) => ({
    ...reproche,
    ...sanitizeReprocheSourceRefs(reproche, aggregate, eventIds),
    claimantStatement: sanitizeStatementQuotes(
      reproche.claimantStatement,
      aggregate,
      roleByInterviewId,
      "claimant",
      2,
    ),
    accusedStatement: sanitizeStatementQuotes(
      reproche.accusedStatement,
      aggregate,
      roleByInterviewId,
      "accused",
      2,
    ),
    referenceStatements: reproche.referenceStatements.map((statement) =>
      sanitizeStatementQuotes(
        statement,
        aggregate,
        roleByInterviewId,
        "reference",
        1,
      ),
    ),
  }));

  // Map each interview to its interviewee's normalized name, then collect, per
  // person, the grievances any of their interviews participate in.
  const personKeyByInterviewId = new Map(
    aggregate.interviews.map((i) => [i.id, normalizeText(i.name)]),
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
        .filter((key): key is string => Boolean(key)),
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
    reprocheCount: reproches.length,
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

type AiReproche = AnalysisResponse["reproches"][number];
type RoleHint = "claimant" | "accused" | "reference";

function isStandaloneReproche(
  reproche: AiReproche,
  aggregate: AggregateResult,
  roleByInterviewId: Map<string, RoleHint>,
  eventIds: Set<string>,
): boolean {
  if (
    reproche.sourceBasis === "context_only" ||
    reproche.amplificationRisk === "high"
  ) {
    return false;
  }

  switch (reproche.sourceBasis) {
    case "explicit_claimant_allegation":
      return hasRoleSupport(reproche, "claimant", aggregate, roleByInterviewId);
    case "explicit_accused_response":
      return hasRoleSupport(reproche, "accused", aggregate, roleByInterviewId);
    case "explicit_reference_concern":
      return hasRoleSupport(
        reproche,
        "reference",
        aggregate,
        roleByInterviewId,
      );
    case "documented_incident":
      return (
        hasEventSupport(reproche, eventIds) ||
        hasSourceBasisQuote(reproche, aggregate)
      );
    case "source_grounded_pattern":
      return (
        sourceSupportCount(reproche, aggregate, roleByInterviewId, eventIds) >=
        2
      );
    default:
      return false;
  }
}

function hasRoleSupport(
  reproche: AiReproche,
  role: RoleHint,
  aggregate: AggregateResult,
  roleByInterviewId: Map<string, RoleHint>,
): boolean {
  const supportingInterviewIds = new Set(
    reproche.sourceBasisInterviewIds.filter(
      (interviewId) => roleByInterviewId.get(interviewId) === role,
    ),
  );
  if (supportingInterviewIds.size === 0) return false;

  const hasSupportingQuote = reproche.sourceBasisQuoteIds.some((quoteId) => {
    const quote = aggregate.quoteById.get(quoteId);
    return Boolean(
      quote &&
        supportingInterviewIds.has(quote.documentId) &&
        isUsableQuote(quote),
    );
  });
  if (hasSupportingQuote) return true;

  return role === "claimant" || role === "accused"
    ? hasExtractedAllegationSupport(supportingInterviewIds, aggregate)
    : hasExtractedReferenceSupport(supportingInterviewIds, aggregate);
}

function hasEventSupport(reproche: AiReproche, eventIds: Set<string>): boolean {
  return [...reproche.sourceBasisEventIds, ...reproche.relatedEventIds].some(
    (eventId) => eventIds.has(eventId),
  );
}

function sourceSupportCount(
  reproche: AiReproche,
  aggregate: AggregateResult,
  roleByInterviewId: Map<string, RoleHint>,
  eventIds: Set<string>,
): number {
  const refs = new Set<string>();

  for (const interviewId of reproche.sourceBasisInterviewIds) {
    if (
      roleByInterviewId.has(interviewId) &&
      interviewHasExtractedSupport(interviewId, aggregate)
    ) {
      refs.add(`interview:${interviewId}`);
    }
  }

  for (const quoteId of reproche.sourceBasisQuoteIds) {
    const quote = aggregate.quoteById.get(quoteId);
    if (isUsableQuote(quote)) refs.add(`quote:${quoteId}`);
  }

  for (const eventId of [
    ...reproche.sourceBasisEventIds,
    ...reproche.relatedEventIds,
  ]) {
    if (eventIds.has(eventId)) refs.add(`event:${eventId}`);
  }

  return refs.size;
}

function hasSourceBasisQuote(
  reproche: AiReproche,
  aggregate: AggregateResult,
): boolean {
  return reproche.sourceBasisQuoteIds.some((quoteId) =>
    isUsableQuote(aggregate.quoteById.get(quoteId)),
  );
}

function hasExtractedAllegationSupport(
  interviewIds: Set<string>,
  aggregate: AggregateResult,
): boolean {
  return aggregate.ai.interviews.some(
    (interview) =>
      interviewIds.has(interview.id) && interview.allegations.length > 0,
  );
}

function hasExtractedReferenceSupport(
  interviewIds: Set<string>,
  aggregate: AggregateResult,
): boolean {
  return aggregate.ai.interviews.some(
    (interview) =>
      interviewIds.has(interview.id) &&
      (interview.allegations.length > 0 || interview.events.length > 0),
  );
}

function interviewHasExtractedSupport(
  interviewId: string,
  aggregate: AggregateResult,
): boolean {
  return aggregate.ai.interviews.some(
    (interview) =>
      interview.id === interviewId &&
      (interview.allegations.length > 0 || interview.events.length > 0),
  );
}

function sanitizeReprocheSourceRefs(
  reproche: AiReproche,
  aggregate: AggregateResult,
  eventIds: Set<string>,
): Pick<
  AiReproche,
  "sourceBasisInterviewIds" | "sourceBasisQuoteIds" | "sourceBasisEventIds"
> {
  return {
    sourceBasisInterviewIds: uniqueIds(reproche.sourceBasisInterviewIds).filter(
      (interviewId) =>
        aggregate.ai.interviews.some(
          (interview) => interview.id === interviewId,
        ),
    ),
    sourceBasisQuoteIds: uniqueIds(reproche.sourceBasisQuoteIds).filter(
      (quoteId) => isUsableQuote(aggregate.quoteById.get(quoteId)),
    ),
    sourceBasisEventIds: uniqueIds(reproche.sourceBasisEventIds).filter(
      (eventId) => eventIds.has(eventId),
    ),
  };
}

function sanitizeStatementQuotes(
  statement: ReprocheStatement,
  aggregate: AggregateResult,
  roleByInterviewId: Map<string, RoleHint>,
  expectedRole: RoleHint,
  limit: number,
): ReprocheStatement {
  if (!statement.interviewId) {
    return { ...statement, quoteIds: [] };
  }

  if (roleByInterviewId.get(statement.interviewId) !== expectedRole) {
    return { interviewId: null, summary: "", quoteIds: [] };
  }

  const sameInterviewQuotes = aggregate.quotes.filter(
    (quote) =>
      quote.documentId === statement.interviewId && isUsableQuote(quote),
  );
  const explicitQuotes = uniqueIds(statement.quoteIds)
    .map((quoteId) => aggregate.quoteById.get(quoteId))
    .filter((quote): quote is AggregateResult["quotes"][number] =>
      Boolean(
        quote &&
          quote.documentId === statement.interviewId &&
          isUsableQuote(quote) &&
          findQuoteTextMatch(statement.summary, quote.text),
      ),
    );
  const inlineQuotes = sameInterviewQuotes.filter((quote) =>
    quoteSupportsVisibleInlineFragment(statement.summary, quote.text),
  );
  const supportedQuotes = uniqueQuotes([...inlineQuotes, ...explicitQuotes]);
  const visibleQuoteCount = inlineQuotes.length;
  const usableQuotes = supportedQuotes.slice(
    0,
    Math.max(limit, visibleQuoteCount),
  );
  const summary = removeUnsupportedInlineQuotes(
    statement.summary,
    supportedQuotes,
  );

  return {
    ...statement,
    summary,
    quoteIds: usableQuotes.map((quote) => quote.id),
  };
}

function isUsableQuote(
  quote: AggregateResult["quotes"][number] | undefined,
): boolean {
  return Boolean(quote?.provenanceId && quote.page !== null);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function uniqueQuotes<TQuote extends { id: string }>(
  quotes: TQuote[],
): TQuote[] {
  const seen = new Set<string>();
  return quotes.filter((quote) => {
    if (seen.has(quote.id)) return false;
    seen.add(quote.id);
    return true;
  });
}
