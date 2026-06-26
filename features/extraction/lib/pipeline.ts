import "server-only";

import { ZodError } from "zod";
import { extractionResponseSchema } from "@/lib/validation";
import { CASE_TYPES, type IntervieweeRole } from "@/lib/types";
import { env } from "@/lib/env";
import type { ExtractionResponse } from "@/lib/validation";
import {
  splitChunkIntoSinglePages,
  type ExtractionChunk,
} from "@/features/extraction/lib/extraction-chunks";
import { getExtractionProvider } from "@/features/extraction/lib/providers";

/**
 * A failure produced while turning a model response into validated extraction
 * data. `userMessage` is safe to surface to investigators; `detail`/`cause`
 * carry the real JSON/Zod diagnostics for server-side logging only.
 * `recoverable` marks failures (truncation, malformed/incomplete JSON) that a
 * smaller consolidation batch might fix on retry.
 */
export class ExtractionError extends Error {
  readonly userMessage: string;
  readonly recoverable: boolean;
  readonly detail?: string;

  constructor(
    userMessage: string,
    options: { recoverable?: boolean; detail?: string; cause?: unknown } = {}
  ) {
    super(userMessage, options.cause ? { cause: options.cause } : undefined);
    this.name = "ExtractionError";
    this.userMessage = userMessage;
    this.recoverable = options.recoverable ?? false;
    this.detail = options.detail;
  }
}

function isRecoverableExtractionError(error: unknown): boolean {
  return error instanceof ExtractionError && error.recoverable;
}

const SYSTEM_PROMPT = `You are an investigation analysis assistant for workplace investigators.
Your job is not to summarize interviews. Your job is to extract traceable investigative material that helps investigators build findings, assess allegations, test evidence, identify contradictions, plan follow-up questions, and prepare conclusions.
Use only information explicitly present in the transcript. Clearly separate facts, allegations, opinions, assumptions, hearsay, observations, evidence, and contradictions.
Never infer guilt, never draw legal conclusions, and never invent facts.
Every allegation, event, finding, quote, witness reference, assessment, and action recommendation must include sourcePages back to the original document page labels provided by the user when real source pagination is available.
If real source pagination is unavailable, leave sourcePages empty and add an extraction warning that source pagination is unavailable for this document.
Never expose, cite, or mention internal processing chunks. Investigators work with documents and pages only.
If a field is not present, return null for metadata or an empty array for lists.
Names attached to recording/transcription metadata, meeting ownership, or a speaker asking consent/context questions are not interviewee names.
Return ONLY valid JSON matching the requested schema — no markdown, no commentary.`;

const CASE_TYPE_LIST = CASE_TYPES.join('", "');

export type ExtractionMode = "lean" | "full";

const DEFAULT_EXTRACTION_MODE: ExtractionMode = "lean";

const LEAN_USER_PROMPT = `Analyze this workplace investigation interview transcript source unit in lean extraction mode.
{{INTERVIEWEE_ROLE_GUIDANCE}}
Extract only material useful to an investigator at the first review stage:

1. Document metadata: interviewee name, interview date, interviewee role, interviewer names.
2. Allegations mentioned.
3. Key facts directly related to allegations, the interview subject, employment context, management actions, disputed events, or referenced evidence.
4. Key timeline events directly related to allegations, employment context, management actions, disputed situations, or referenced evidence.
5. Named people and possible roles.
6. Potential witnesses or participants.
7. Referenced evidence or documents, including emails, Teams messages, reports, evaluations, meeting minutes, complaints, contracts, calendars, expense notes, security reports, and shared documents.
8. Supporting quotes attached to extracted allegations, facts, events, witnesses, or referenced evidence.

Lean limits:
- Do not generate follow-up questions. Return [] for top-level followUpQuestions and allegation followUpQuestions.
- Do not generate standalone notable/relevant quote lists. Return [] for top-level notableQuotes and pageFindings.notableQuotes.
- Keep allegation relevantQuotes only when they directly support that allegation.
- Extract at most 30 factualStatements for the whole document.
- Extract at most 30 keyEvents for the whole document.
- Keep people and witnesses concise: name, stated role if available, pages, and one short relevance reason.
- Keep extractionWarnings to at most 10 useful, actionable document-level warnings. Remove duplicates, generic warnings, and contradictions.
- Skip exhaustive opinions, assumptions, hearsay, observations, risk areas, finding readiness analysis, evidence assessments, and recommended next interviews unless the item is directly necessary to understand an allegation or evidence gap.

Traceability rules:
- Use only information explicitly present in the transcript.
- Quote text in supportingQuotes and allegation relevantQuotes must be copied verbatim from the transcript. Never fabricate, paraphrase, translate, or shorten a quote.
- If the transcript header names a single "Source page", every item must include sourcePages with that exact page label, such as "Page 4".
- If the transcript header lists "Source pages" for a range, the body is split by "--- Page N ---" markers; set each item's sourcePages to the specific page label(s) where it appears, such as "Page 5", never the whole range or a marker line.
- If the transcript header says "Source pagination: unavailable", sourcePages must be [] for every item and extractionWarnings must include that original page references are unavailable.
- Never expose, cite, or mention internal chunks or segments.
- Page numbers for clickable quote navigation are verified later by deterministic matching. The model must only provide exact quote text and sourcePages.

Classification rules:
- Keep allegations separate from facts and events. An allegation is a claim to be tested; it is not a proven fact.
- Do not classify opinions, interpretations, assumptions, hearsay, or direct observations as allegations unless they assert specific alleged misconduct or a complaint to be investigated.
- Use null rather than guessing a date, claimant, subject, role, speaker, or metadata value.
- Suggested case type must be one of "${CASE_TYPE_LIST}" only if clearly supported; otherwise null.

Return ONLY valid JSON matching this shape:

{
  "intervieweeName": string | null,
  "interviewDate": string | null,
  "role": string | null,
  "interviewerNames": string[],
  "extractionWarnings": string[],
  "summary": string,
  "investigationScope": {
    "primaryClaimants": string[],
    "primaryAccused": string[],
    "scopeSummary": string,
    "primaryAllegations": string[],
    "secondaryObservations": string[],
    "sourcePages": string[]
  },
  "allegations": [
    {
      "date": string | null,
      "claimant": string | null,
      "subject": string | null,
      "classification": "primary" | "secondary",
      "allegation": string,
      "description": string,
      "supportingEvidence": [{ "description": string, "sourcePages": string[] }],
      "contradictoryEvidence": [{ "description": string, "sourcePages": string[] }],
      "missingEvidence": string[],
      "relevantQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }],
      "witnesses": [{ "name": string, "relevance": string, "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }], "sourcePages": string[] }],
      "followUpQuestions": string[],
      "riskAreas": string[],
      "sourcePages": string[]
    }
  ],
  "peopleMentioned": string[],
  "canonicalIdentities": [{ "canonicalName": string, "variants": string[], "role": string | null, "sourcePages": string[] }],
  "keyEvents": [{ "date": string | null, "description": string, "participants": string[], "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }], "sourcePages": string[] }],
  "notableQuotes": [],
  "factualStatements": [{ "description": string, "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }], "sourcePages": string[] }],
  "opinions": [{ "description": string, "sourcePages": string[] }],
  "assumptions": [{ "description": string, "sourcePages": string[] }],
  "hearsay": [{ "description": string, "sourcePages": string[] }],
  "observations": [{ "description": string, "sourcePages": string[] }],
  "potentialWitnesses": [{ "name": string, "relevance": string, "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }], "sourcePages": string[] }],
  "consolidatedWitnesses": [{ "name": string, "whyTheyMatter": string, "relatedAllegations": string[], "mentionedInInterviews": string[], "priorityScore": number, "sourcePages": string[] }],
  "missingInformation": [{ "description": string, "sourcePages": string[] }],
  "followUpQuestions": [],
  "recommendedNextInterviews": [],
  "riskAreas": [{ "description": string, "sourcePages": string[] }],
  "findingReadiness": {
    "supportableFindings": [{ "description": string, "sourcePages": string[] }],
    "unprovenFindings": [{ "description": string, "sourcePages": string[] }],
    "evidenceToCollect": [{ "description": string, "sourcePages": string[] }]
  },
  "investigationImpact": string,
  "interviewPosition": {
    "classification": "Supports claimant" | "Supports accused" | "Mixed / nuanced" | "Neutral witness" | "Unknown",
    "rationale": string,
    "sourcePages": string[]
  },
  "evidenceAssessment": [],
  "pageFindings": [
    {
      "sourcePage": string,
      "allegations": [],
      "factualStatements": [{ "description": string, "sourcePages": string[] }],
      "opinions": [],
      "assumptions": [],
      "hearsay": [],
      "observations": [],
      "notableQuotes": [],
      "supportingEvidence": [{ "description": string, "sourcePages": string[] }],
      "contradictoryEvidence": [{ "description": string, "sourcePages": string[] }],
      "potentialWitnesses": [{ "name": string, "relevance": string, "sourcePages": string[] }],
      "relevantEvents": [{ "date": string | null, "description": string, "participants": string[], "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }], "sourcePages": string[] }]
    }
  ],
  "suggestedCaseType": "${CASE_TYPE_LIST}" | null
}

Transcript:
"""
{{TRANSCRIPT}}
"""`;

const FULL_USER_PROMPT = `Analyze this workplace investigation interview transcript source unit.
{{INTERVIEWEE_ROLE_GUIDANCE}}
Optimize for investigation, evidence analysis, traceability, and report preparation. Do not optimize for summarization.

For the provided source label, extract:

1. Interview metadata: interviewee name, interview date, interviewee role, and interviewer names.
2. Extraction warnings: uncertainty, unreliable speaker labels, ambiguous interviewee identity, missing answer attribution, poor source quality, unavailable pagination, or places where a source unit is too thin to assess.
3. Investigation scope: primary claimant(s), primary accused person(s), the actual issue under investigation, primary allegations, and secondary observations.
4. Allegations: claims, accusations, complaints, or alleged misconduct. For each, identify who is making the allegation, who is the subject, what exactly is alleged, whether it is primary or secondary, supporting evidence, contradictory evidence, missing evidence, relevant quotes, witnesses, follow-up questions, risk areas, and sourcePages.
5. Factual statements: concrete claims of fact, dates, procedural steps, actions taken, communications, decisions, or things the interviewee says occurred. Do not mix these with opinions. For each factual statement, include supportingQuotes containing the verbatim transcript sentence(s) the fact is drawn from, copied exactly from the source — never paraphrase, summarize, translate, or invent a quote. Leave supportingQuotes empty only when no verbatim quote in the transcript supports the fact.
6. Opinions: subjective evaluations, beliefs, judgments, impressions, interpretations, characterizations, or motive attributions.
7. Assumptions: statements that are speculative, inferred, uncertain, or not based on direct knowledge.
8. Hearsay: statements relaying what someone else allegedly said, saw, believed, reported, or experienced.
9. Observations: direct sensory or firsthand observations by the speaker, separate from interpretations of motive or character.
10. Notable quotes: complete, contextual sentences useful for findings, contradictions, credibility, motive, knowledge, or chronology.
11. Supporting evidence: statements or documents mentioned that support an allegation or relevant finding.
12. Contradictory evidence: statements or documents mentioned that refute, weaken, conflict with, or complicate an allegation or relevant finding.
13. Potential witnesses: people who may confirm, refute, contextualize, or add evidence. For each witness, include supportingQuotes containing the verbatim transcript sentence(s) that mention them or explain why they may be relevant, copied exactly from the source — never paraphrase, translate, or invent a quote. Leave supportingQuotes empty only when no verbatim quote supports the witness.
14. Recommended next interviews: people or roles to interview next and why.
15. Relevant events: dated or sequenceable happenings, procedural steps, meetings, reports, decisions, or incidents.
16. People mentioned and canonical identities: deduplicated canonical people only, with likely transcription variants merged.
17. Finding readiness: what findings can be supported, what remains unproven, and what evidence still needs collection.
18. A short investigation-focused summary of this source unit.
19. Suggested case type, chosen from "${CASE_TYPE_LIST}", only if clearly supported.

Rules:
- If the transcript header names a single "Source page", every item must include sourcePages with that exact page label, such as "Page 4".
- If the transcript header lists "Source pages" for a range, the body is split by "--- Page N ---" markers; set each item's sourcePages to the specific page label(s) where it appears, such as "Page 5", never the whole range or a marker line.
- If the transcript header says "Source pagination: unavailable", sourcePages must be [] for every item and extractionWarnings must include that original page references are unavailable.
- Do not use internal segment or chunk labels as sourcePages. Internal processing labels are not source locations.
- Keep allegations separate from facts and events. An allegation is a claim to be tested; it is not a proven fact.
- Do not classify opinions, interpretations, assumptions, hearsay, or direct observations as allegations unless they also assert specific alleged misconduct or a complaint to be investigated.
- Example: "Philippe has difficulty accepting Caroline as his superior" is an opinion or interpretation attributed to the speaker. It is not an allegation unless the transcript connects it to specific alleged misconduct.
- Clearly distinguish direct observations from hearsay, opinions, assumptions, and factual statements.
- Use null rather than guessing a date, claimant, subject, role, speaker, or metadata value.
- Supporting evidence and contradictory evidence must be tied to what appears in this source unit. Use a page citation only when real pagination is available.
- Quote text in supportingQuotes, relevantQuotes, and notableQuotes must be copied verbatim from the transcript. Never fabricate, paraphrase, translate, or shorten a quote; if no exact transcript quote supports the item, leave its quote list empty.
- Missing information, follow-up questions, recommended next interviews, and risk areas should almost always contain items. Return an empty array only when the transcript genuinely leaves no reasonable investigation gap, question, interview, or risk.
- If evidence is not tied to a specific allegation on this page, still include it in the page-level supportingEvidence or contradictoryEvidence arrays.

Concept rules:
- Allegation: an accusation, complaint, or alleged misconduct that needs to be tested.
- Fact: a concrete asserted occurrence, action, date, communication, decision, or procedural step.
- Opinion: a subjective evaluation, judgment, interpretation, or characterization.
- Assumption: speculation, inference, uncertain conclusion, or statement without direct knowledge.
- Hearsay: secondhand information attributed to another person or unspecified others.
- Observation: what the speaker directly saw, heard, received, or personally experienced, without interpreting motive.
- Primary allegations are within the main investigation scope. Secondary observations provide context but are not themselves the main complaint.

Speaker-label rules:
- A line such as "Natascha Mullis Transkription gestartet" means Natascha
  started the transcription; it is not evidence that Natascha is the interviewee.
- A first speaker who asks for consent to record, explains confidentiality, or
  introduces accusations is normally an interviewer.
- A document title such as "Besprechung avec [Name] = Personne mise en cause" is
  evidence that [Name] is the person interviewed, but add a warning if the body
  lacks reliable speaker attribution.
- If the transcript combines questions and answers without clear speakers, do
  not pretend certainty.
- If a quote or answer matters but speaker attribution is uncertain, keep the
  quote only if it is contextually useful and add an explicit extractionWarnings
  entry explaining that attribution is uncertain.

People quality rules:
- Use one canonical spelling per person, preferring the most complete spelling
  that appears in the transcript.
- Merge accents, OCR/transcription variations, reversed first/last-name order,
  and minor misspellings when they clearly refer to the same person.
- Populate canonicalIdentities with canonicalName, variants, role if explicit,
  and sourcePages. The peopleMentioned list must use only canonicalName values.
- Do not include bare role labels such as "interviewer", "employee",
  "manager", "witness", "speaker 1", or "unknown speaker" as people.
- Do not include corrupted strings with digits, replacement characters, or
  mostly punctuation unless the same person is repeatedly identifiable.

Event and allegation rules:
- Allegations describe what someone claims happened or complains about.
- Key events describe dated or sequenceable happenings, procedural steps, meetings, reports, decisions, or incidents.
- Use ISO dates when exact dates are explicit. Otherwise preserve explicit partial dates or relative dates in date, and use null when no date is present.

Return ONLY valid JSON.

Expected schema:

{
  "intervieweeName": string | null,
  "interviewDate": string | null,
  "role": string | null,
  "interviewerNames": string[],
  "extractionWarnings": string[],
  "summary": string,
  "investigationScope": {
    "primaryClaimants": string[],
    "primaryAccused": string[],
    "scopeSummary": string,
    "primaryAllegations": string[],
    "secondaryObservations": string[],
    "sourcePages": string[]
  },
  "allegations": [
    {
      "date": string | null,
      "claimant": string | null,
      "subject": string | null,
      "classification": "primary" | "secondary",
      "allegation": string,
      "description": string,
      "supportingEvidence": [{ "description": string, "sourcePages": string[] }],
      "contradictoryEvidence": [{ "description": string, "sourcePages": string[] }],
      "missingEvidence": string[],
      "relevantQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }],
      "witnesses": [{ "name": string, "relevance": string, "sourcePages": string[] }],
      "followUpQuestions": string[],
      "riskAreas": string[],
      "sourcePages": string[]
    }
  ],
  "peopleMentioned": string[],
  "canonicalIdentities": [{ "canonicalName": string, "variants": string[], "role": string | null, "sourcePages": string[] }],
  "keyEvents": [
    {
      "date": string | null,
      "description": string,
      "participants": string[],
      "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }],
      "sourcePages": string[]
    }
  ],
  "notableQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }],
  "factualStatements": [{ "description": string, "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }], "sourcePages": string[] }],
  "opinions": [{ "description": string, "sourcePages": string[] }],
  "assumptions": [{ "description": string, "sourcePages": string[] }],
  "hearsay": [{ "description": string, "sourcePages": string[] }],
  "observations": [{ "description": string, "sourcePages": string[] }],
  "potentialWitnesses": [{ "name": string, "relevance": string, "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }], "sourcePages": string[] }],
  "consolidatedWitnesses": [{ "name": string, "whyTheyMatter": string, "relatedAllegations": string[], "mentionedInInterviews": string[], "priorityScore": number, "sourcePages": string[] }],
  "missingInformation": [{ "description": string, "sourcePages": string[] }],
  "followUpQuestions": [{ "description": string, "sourcePages": string[] }],
  "recommendedNextInterviews": [{ "description": string, "sourcePages": string[] }],
  "riskAreas": [{ "description": string, "sourcePages": string[] }],
  "findingReadiness": {
    "supportableFindings": [{ "description": string, "sourcePages": string[] }],
    "unprovenFindings": [{ "description": string, "sourcePages": string[] }],
    "evidenceToCollect": [{ "description": string, "sourcePages": string[] }]
  },
  "investigationImpact": string,
  "interviewPosition": {
    "classification": "Supports claimant" | "Supports accused" | "Mixed / nuanced" | "Neutral witness" | "Unknown",
    "rationale": string,
    "sourcePages": string[]
  },
  "evidenceAssessment": [
    {
      "allegation": string,
      "strengthOfSupportingEvidence": string,
      "strengthOfContradictoryEvidence": string,
      "confidenceLevel": string,
      "supportableFindings": string[],
      "unprovenFindings": string[],
      "evidenceToCollect": string[],
      "missingInformation": string[],
      "recommendedActions": string[],
      "sourcePages": string[]
    }
  ],
  "pageFindings": [
    {
      "sourcePage": string,
      "allegations": [same allegation object shape as above],
      "factualStatements": [{ "description": string, "sourcePages": string[] }],
      "opinions": [{ "description": string, "sourcePages": string[] }],
      "assumptions": [{ "description": string, "sourcePages": string[] }],
      "hearsay": [{ "description": string, "sourcePages": string[] }],
      "observations": [{ "description": string, "sourcePages": string[] }],
      "notableQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }],
      "supportingEvidence": [{ "description": string, "sourcePages": string[] }],
      "contradictoryEvidence": [{ "description": string, "sourcePages": string[] }],
      "potentialWitnesses": [{ "name": string, "relevance": string, "sourcePages": string[] }],
      "relevantEvents": [{ "date": string | null, "description": string, "participants": string[], "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }], "sourcePages": string[] }]
    }
  ],
  "suggestedCaseType": "${CASE_TYPE_LIST}" | null
}

Transcript:
"""
{{TRANSCRIPT}}
"""`;

const VERIFICATION_PROMPT = `You are performing the final consolidation pass for a workplace investigation extraction.

You will receive JSON extraction drafts from separate document pages. Consolidate them into one final investigation result.

- Deduplicate people, canonical identities, allegations, events, quotes, facts, opinions, assumptions, hearsay, observations, witnesses, risk areas, and follow-up questions.
- Merge people spelling variations under one canonical name, preferring the most
  complete spelling. Remove corrupted names, role labels, speaker labels,
  organizations, and transcript artifacts.
- Build canonicalIdentities from likely duplicate names and transcription
  variants. peopleMentioned must contain only canonical person names.
- Keep only information explicitly present in the drafts.
- Prefer the most specific non-null metadata values.
- Reject interviewee names that are only supported by transcription-started,
  recorder, meeting-owner, or interviewer-question evidence.
- Preserve extractionWarnings when drafts show unreliable speaker attribution or
  conflicting interviewee evidence.
- Preserve or add extractionWarnings when quote or answer attribution remains
  uncertain after consolidation.
- Preserve all real sourcePages. When merging items, combine their sourcePages.
- Never expose, preserve, or create chunk or internal segment references. If a draft contains a chunk or internal segment reference, omit the source reference and add an extraction warning.
- Identify the primary claimant(s), primary accused person(s), and actual
  investigation scope from the combined drafts.
- Separate allegations from facts, opinions, assumptions, hearsay, observations,
  and key events. Allegations are claims to be tested; keyEvents are dated or
  sequenceable happenings, procedural steps, meetings, reports, decisions, or
  incidents.
- Do not classify opinions, interpretations, assumptions, hearsay, or direct
  observations as allegations unless they assert specific alleged misconduct or
  a complaint to be investigated. Example: "Philippe has difficulty accepting
  Caroline as his superior" is an opinion or interpretation, not an allegation.
- Mark allegations as "primary" only when they belong to the main investigation
  scope. Mark contextual issues as "secondary".
- Keep quote text as complete, contextual sentences. Remove fragments and duplicate quotes.
- Preserve each factual statement's and witness's supportingQuotes verbatim from the drafts, keeping their sourcePages. Deduplicate identical quotes, but never fabricate, paraphrase, translate, or shorten a quote, and never add a quote that is not present in the drafts.
- Produce a concise investigation-focused summary of the whole document that surfaces allegations, evidence, contradictions, missing information, and investigative impact. Do not write a generic meeting summary.
- For every major allegation, clearly answer: what allegation is being discussed, who makes it, who is the subject, what supports it, what contradicts it, what is missing, which witnesses may confirm/refute it, what follow-up questions should be asked, what risk areas require further investigation, and how this interview affects the investigation.
- Always produce missingInformation, followUpQuestions, recommendedNextInterviews,
  and riskAreas unless there is genuinely no reasonable investigative gap.
- Generate consolidatedWitnesses with why each witness matters, related
  allegations, which interview mentioned them, priorityScore from 0-100, and
  sourcePages.
- Populate findingReadiness to answer: what findings can be supported, what
  remains unproven, and what evidence still needs collection.
- Add an Interview Position section by setting interviewPosition.classification to exactly one of: "Supports claimant", "Supports accused", "Mixed / nuanced", "Neutral witness", or "Unknown". Explain why and cite sourcePages.
- Add evidenceAssessment for every major allegation with strength of supporting evidence, strength of contradictory evidence, confidence level, missing information, recommended next investigative actions, and sourcePages.
- Preserve pageFindings from page drafts only when true page references are available. If true page references are unavailable, do not invent pageFindings and warn that exact source pagination could not be verified.
- Return null for suggestedCaseType unless the combined drafts clearly support one of: "${CASE_TYPE_LIST}".
- Return ONLY valid JSON matching the schema below.

Expected schema:

{
  "intervieweeName": string | null,
  "interviewDate": string | null,
  "role": string | null,
  "interviewerNames": string[],
  "extractionWarnings": string[],
  "summary": string,
  "investigationScope": {
    "primaryClaimants": string[],
    "primaryAccused": string[],
    "scopeSummary": string,
    "primaryAllegations": string[],
    "secondaryObservations": string[],
    "sourcePages": string[]
  },
  "allegations": [
    {
      "date": string | null,
      "claimant": string | null,
      "subject": string | null,
      "classification": "primary" | "secondary",
      "allegation": string,
      "description": string,
      "supportingEvidence": [{ "description": string, "sourcePages": string[] }],
      "contradictoryEvidence": [{ "description": string, "sourcePages": string[] }],
      "missingEvidence": string[],
      "relevantQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }],
      "witnesses": [{ "name": string, "relevance": string, "sourcePages": string[] }],
      "followUpQuestions": string[],
      "riskAreas": string[],
      "sourcePages": string[]
    }
  ],
  "peopleMentioned": string[],
  "canonicalIdentities": [{ "canonicalName": string, "variants": string[], "role": string | null, "sourcePages": string[] }],
  "keyEvents": [
    {
      "date": string | null,
      "description": string,
      "participants": string[],
      "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }],
      "sourcePages": string[]
    }
  ],
  "notableQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }],
  "factualStatements": [{ "description": string, "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }], "sourcePages": string[] }],
  "opinions": [{ "description": string, "sourcePages": string[] }],
  "assumptions": [{ "description": string, "sourcePages": string[] }],
  "hearsay": [{ "description": string, "sourcePages": string[] }],
  "observations": [{ "description": string, "sourcePages": string[] }],
  "potentialWitnesses": [{ "name": string, "relevance": string, "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }], "sourcePages": string[] }],
  "consolidatedWitnesses": [{ "name": string, "whyTheyMatter": string, "relatedAllegations": string[], "mentionedInInterviews": string[], "priorityScore": number, "sourcePages": string[] }],
  "missingInformation": [{ "description": string, "sourcePages": string[] }],
  "followUpQuestions": [{ "description": string, "sourcePages": string[] }],
  "recommendedNextInterviews": [{ "description": string, "sourcePages": string[] }],
  "riskAreas": [{ "description": string, "sourcePages": string[] }],
  "findingReadiness": {
    "supportableFindings": [{ "description": string, "sourcePages": string[] }],
    "unprovenFindings": [{ "description": string, "sourcePages": string[] }],
    "evidenceToCollect": [{ "description": string, "sourcePages": string[] }]
  },
  "investigationImpact": string,
  "interviewPosition": {
    "classification": "Supports claimant" | "Supports accused" | "Mixed / nuanced" | "Neutral witness" | "Unknown",
    "rationale": string,
    "sourcePages": string[]
  },
  "evidenceAssessment": [
    {
      "allegation": string,
      "strengthOfSupportingEvidence": string,
      "strengthOfContradictoryEvidence": string,
      "confidenceLevel": string,
      "supportableFindings": string[],
      "unprovenFindings": string[],
      "evidenceToCollect": string[],
      "missingInformation": string[],
      "recommendedActions": string[],
      "sourcePages": string[]
    }
  ],
  "pageFindings": [
    {
      "sourcePage": string,
      "allegations": [same allegation object shape as above],
      "factualStatements": [{ "description": string, "sourcePages": string[] }],
      "opinions": [{ "description": string, "sourcePages": string[] }],
      "assumptions": [{ "description": string, "sourcePages": string[] }],
      "hearsay": [{ "description": string, "sourcePages": string[] }],
      "observations": [{ "description": string, "sourcePages": string[] }],
      "notableQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }],
      "supportingEvidence": [{ "description": string, "sourcePages": string[] }],
      "contradictoryEvidence": [{ "description": string, "sourcePages": string[] }],
      "potentialWitnesses": [{ "name": string, "relevance": string, "sourcePages": string[] }],
      "relevantEvents": [{ "date": string | null, "description": string, "participants": string[], "supportingQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }], "sourcePages": string[] }]
    }
  ],
  "suggestedCaseType": "${CASE_TYPE_LIST}" | null
}

Page drafts:
{{DRAFTS}}`;

/**
 * Send a transcript to the LLM and return validated structured data plus a
 * best-guess case type. Throws if the model returns malformed output or output
 * that fails Zod validation — callers translate that into a `failed` document
 * status.
 */
export async function extractInterviewData(
  transcript: string,
  mode: ExtractionMode = DEFAULT_EXTRACTION_MODE,
  intervieweeRole: IntervieweeRole | null = null
): Promise<ExtractionResponse> {
  return requestExtraction(
    buildUserPrompt(transcript, mode, intervieweeRole),
    mode
  );
}

export async function extractInterviewChunk(
  chunk: ExtractionChunk,
  documentName: string,
  intervieweeRole: IntervieweeRole | null = null,
  mode: ExtractionMode = DEFAULT_EXTRACTION_MODE
): Promise<ExtractionResponse> {
  const response = await requestExtraction(
    buildUserPrompt(
      `Document: ${documentName}\n${chunkProvenanceHeader(chunk)}\n\n${chunk.text}`,
      mode,
      intervieweeRole
    ),
    mode
  );
  return stampChunkProvenance(response, chunk);
}

/**
 * Extract a chunk, falling back to per-page extraction if a grouped call
 * truncates or returns malformed JSON. A 3-page group is normally fine, but a
 * dense group can produce a response too large to fit; rather than fail the
 * whole document, we retry each page on its own. Returns one draft per
 * successful unit (one for a single-page chunk, several when we fell back).
 */
export async function extractInterviewChunkWithFallback(
  chunk: ExtractionChunk,
  documentName: string,
  intervieweeRole: IntervieweeRole | null = null,
  mode: ExtractionMode = DEFAULT_EXTRACTION_MODE
): Promise<ExtractionResponse[]> {
  try {
    return [
      await extractInterviewChunk(chunk, documentName, intervieweeRole, mode),
    ];
  } catch (error) {
    const singlePages = splitChunkIntoSinglePages(chunk);
    if (!isRecoverableExtractionError(error) || singlePages.length < 2) {
      throw error;
    }

    return Promise.all(
      singlePages.map((page) =>
        extractInterviewChunk(page, documentName, intervieweeRole, mode)
      )
    );
  }
}

function buildUserPrompt(
  transcript: string,
  mode: ExtractionMode,
  intervieweeRole: IntervieweeRole | null = null
): string {
  const prompt = mode === "full" ? FULL_USER_PROMPT : LEAN_USER_PROMPT;
  return prompt
    .replace("{{INTERVIEWEE_ROLE_GUIDANCE}}", intervieweeRoleGuidance(intervieweeRole))
    .replace("{{TRANSCRIPT}}", transcript);
}

/**
 * An authoritative statement of who this interviewee is in the dispute, so the
 * model attributes the claimant/accused scope from a known fact instead of
 * guessing it per page (the guess that previously put a witness's interview's
 * subject in the wrong scope bucket). Returns "" when the role is unknown, in
 * which case the model falls back to inferring it as before. `interviewPosition`
 * stays inferred either way: a witness can still "Support accused".
 */
function intervieweeRoleGuidance(role: IntervieweeRole | null): string {
  if (!role) return "";

  const shared =
    "Treat this as an authoritative given — do not infer, second-guess, or contradict it. This fixes who the parties are; interviewPosition is separate and may still differ (a reference person can support either side).";

  if (role === "claimant") {
    return `\nKNOWN INTERVIEWEE ROLE: this transcript is the CLAIMANT (plaignant) — the person who brought the complaint. In investigationScope, list this interviewee under primaryClaimants and never under primaryAccused; the person(s) they accuse are the primaryAccused. ${shared}\n`;
  }

  if (role === "accused") {
    return `\nKNOWN INTERVIEWEE ROLE: this transcript is the ACCUSED (personne mise en cause) — the person the complaint is against. In investigationScope, list this interviewee under primaryAccused and never under primaryClaimants; the person(s) bringing the complaint are the primaryClaimants. ${shared}\n`;
  }

  return `\nKNOWN INTERVIEWEE ROLE: this transcript is a REFERENCE PERSON / WITNESS (personne de référence / témoin) — neither the claimant nor the accused. Do NOT list this interviewee under primaryClaimants or primaryAccused; identify the actual claimant and accused from the people they describe. ${shared}\n`;
}

/**
 * Provenance instructions prepended to a chunk so the model cites the right
 * source location. A multi-page chunk keeps per-page "--- Page N ---" markers
 * in its body, so we tell the model to cite the specific page each item came
 * from rather than the whole range.
 */
function chunkProvenanceHeader(chunk: ExtractionChunk): string {
  const isMultiPage =
    chunk.pageStart != null &&
    chunk.pageEnd != null &&
    chunk.pageEnd > chunk.pageStart;

  if (isMultiPage) {
    return [
      `Source pages: ${chunk.label}`,
      'This source unit spans multiple document pages, each delimited by a "--- Page N ---" marker.',
      'Set every item\'s sourcePages to the specific page label(s) where that information appears (for example "Page 5"), never the whole range or a marker line.',
    ].join("\n");
  }

  return `Source page: ${chunk.label}`;
}

/**
 * Deterministic page provenance. The model fills the scalar
 * `pageFindings[].sourcePage` reliably but leaves item `sourcePages` arrays
 * empty, and the consolidation pass drops arrays altogether. So we attach page
 * provenance ourselves: every chunk maps to a known page range, and the per-page
 * `pageFindings` buckets tell us the exact page of each item. A `text -> pages`
 * index built from the drafts then survives consolidation.
 */
type PageIndex = Map<string, Set<string>>;

/** The individual page labels ("Page 4", "Page 5") a chunk spans. */
function pageLabelsForChunk(chunk: ExtractionChunk): string[] {
  if (chunk.pageStart == null) return [];
  const end = chunk.pageEnd ?? chunk.pageStart;
  const labels: string[] = [];
  for (let page = chunk.pageStart; page <= end; page += 1) {
    labels.push(`Page ${page}`);
  }
  return labels;
}

function addToPageIndex(
  index: PageIndex,
  text: string | null | undefined,
  page: string
): void {
  const key = normalizeForComparison(text ?? "");
  if (!key || !page) return;
  let pages = index.get(key);
  if (!pages) {
    pages = new Set();
    index.set(key, pages);
  }
  pages.add(page);
}

/**
 * Index a single draft's items by text -> page using its `pageFindings` buckets,
 * whose `sourcePage` scalar the model fills reliably. This is the exact per-item
 * page mapping within a chunk.
 */
function buildDraftPageIndex(draft: ExtractionResponse): PageIndex {
  const index: PageIndex = new Map();

  for (const finding of draft.pageFindings) {
    const page = normalizeSourcePage(finding.sourcePage);
    if (!page) continue;

    const evidence = [
      ...finding.allegations.map((item) => item.allegation || item.description),
      ...finding.factualStatements.map((item) => item.description),
      ...finding.opinions.map((item) => item.description),
      ...finding.assumptions.map((item) => item.description),
      ...finding.hearsay.map((item) => item.description),
      ...finding.observations.map((item) => item.description),
      ...finding.supportingEvidence.map((item) => item.description),
      ...finding.contradictoryEvidence.map((item) => item.description),
      ...finding.relevantEvents.map((item) => item.description),
      ...finding.notableQuotes.map((item) => item.text),
      ...finding.potentialWitnesses.map((item) => item.name),
    ];

    for (const text of evidence) addToPageIndex(index, text, page);
  }

  return index;
}

/**
 * Index every draft by text -> page(s), drawing on both the page-stamped item
 * arrays and the per-page `pageFindings` buckets. Used to backfill the
 * consolidated result.
 */
function buildPageIndex(drafts: ExtractionResponse[]): PageIndex {
  const index: PageIndex = new Map();

  for (const draft of drafts) {
    // Harvest the pages already on each item (drafts are stamped at extraction).
    applySourcePages(draft, (text, current) => {
      for (const page of current) addToPageIndex(index, text, page);
      return current;
    });

    // Fold in the per-page bucket mapping as a fallback for any unstamped item.
    for (const [key, pages] of buildDraftPageIndex(draft)) {
      let merged = index.get(key);
      if (!merged) {
        merged = new Set();
        index.set(key, merged);
      }
      for (const page of pages) merged.add(page);
    }
  }

  return index;
}

function lookupPages(index: PageIndex, text: string | null | undefined): string[] {
  const key = normalizeForComparison(text ?? "");
  if (!key) return [];
  const pages = index.get(key);
  if (!pages) return [];
  return [...pages].sort(comparePageLabels);
}

function comparePageLabels(left: string, right: string): number {
  const leftNumber = Number(left.match(/\d+/)?.[0] ?? 0);
  const rightNumber = Number(right.match(/\d+/)?.[0] ?? 0);
  return leftNumber - rightNumber;
}

/**
 * Fill in each item's `sourcePages` from the chunk's pages: prefer the exact
 * page from the draft's `pageFindings`, otherwise fall back to the chunk's whole
 * page span. Items the model already cited are left untouched.
 */
function stampChunkProvenance(
  response: ExtractionResponse,
  chunk: ExtractionChunk
): ExtractionResponse {
  const fallback = pageLabelsForChunk(chunk);
  // No real pagination (legacy/unpaginated source): leave sourcePages empty.
  if (fallback.length === 0) return response;

  const index = buildDraftPageIndex(response);
  return applySourcePages(response, (text, current) => {
    if (current.length > 0) return current;
    const matched = lookupPages(index, text);
    return matched.length > 0 ? matched : fallback;
  });
}

/**
 * Index the verbatim quotes the per-page drafts attached to each fact, witness,
 * and allegation, keyed by the item's text. The consolidation model routinely
 * drops these nested quote arrays when merging drafts (the same way it drops
 * sourcePages), so we restore them deterministically afterwards rather than
 * trusting the merge to carry them through.
 */
type SupportingQuoteIndex = {
  facts: Map<string, QuoteItem[]>;
  events: Map<string, QuoteItem[]>;
  witnesses: Map<string, QuoteItem[]>;
  allegations: Map<string, QuoteItem[]>;
};

/** The text key an allegation is indexed/looked up by (matches the UI title). */
function allegationQuoteKey(allegation: AllegationItem): string {
  return allegation.allegation || allegation.description;
}

function addSupportingQuotes(
  index: Map<string, QuoteItem[]>,
  text: string,
  quotes: QuoteItem[]
): void {
  const key = normalizeForComparison(text);
  if (!key || quotes.length === 0) return;
  const existing = index.get(key) ?? [];
  index.set(
    key,
    normalizeQuoteItems([...existing, ...quotes], SUPPORTING_QUOTE_MIN_LENGTH)
  );
}

function buildSupportingQuoteIndex(
  drafts: ExtractionResponse[]
): SupportingQuoteIndex {
  const facts = new Map<string, QuoteItem[]>();
  const events = new Map<string, QuoteItem[]>();
  const witnesses = new Map<string, QuoteItem[]>();
  const allegations = new Map<string, QuoteItem[]>();

  for (const draft of drafts) {
    for (const fact of draft.factualStatements) {
      addSupportingQuotes(facts, fact.description, fact.supportingQuotes);
    }
    for (const event of draft.keyEvents) {
      addSupportingQuotes(events, event.description, event.supportingQuotes);
    }
    for (const witness of draft.potentialWitnesses) {
      addSupportingQuotes(witnesses, witness.name, witness.supportingQuotes);
    }
    for (const allegation of draft.allegations) {
      addSupportingQuotes(
        allegations,
        allegationQuoteKey(allegation),
        allegation.relevantQuotes
      );
      // Witnesses also surface attached to specific allegations; index those too.
      for (const witness of allegation.witnesses) {
        addSupportingQuotes(witnesses, witness.name, witness.supportingQuotes);
      }
    }
  }

  return { facts, events, witnesses, allegations };
}

/**
 * Restore each fact's, witness's, and allegation's quotes from the drafts when
 * consolidation returned none. Items consolidation reworded past recognition
 * keep whatever the model returned (usually empty), mirroring how
 * `backfillSourcePages` leaves unrecognized items uncited rather than guessing.
 */
function backfillSupportingQuotes(
  response: ExtractionResponse,
  index: SupportingQuoteIndex
): ExtractionResponse {
  return {
    ...response,
    factualStatements: response.factualStatements.map((fact) => ({
      ...fact,
      supportingQuotes:
        fact.supportingQuotes.length > 0
          ? fact.supportingQuotes
          : index.facts.get(normalizeForComparison(fact.description)) ?? [],
    })),
    keyEvents: response.keyEvents.map((event) => ({
      ...event,
      supportingQuotes:
        event.supportingQuotes.length > 0
          ? event.supportingQuotes
          : index.events.get(normalizeForComparison(event.description)) ?? [],
    })),
    potentialWitnesses: response.potentialWitnesses.map((witness) => ({
      ...witness,
      supportingQuotes:
        witness.supportingQuotes.length > 0
          ? witness.supportingQuotes
          : index.witnesses.get(normalizeForComparison(witness.name)) ?? [],
    })),
    allegations: response.allegations.map((allegation) => ({
      ...allegation,
      relevantQuotes:
        allegation.relevantQuotes.length > 0
          ? allegation.relevantQuotes
          : index.allegations.get(
              normalizeForComparison(allegationQuoteKey(allegation))
            ) ?? [],
    })),
  };
}

/**
 * Restore page citations dropped during consolidation by matching each
 * uncited item back to the drafts' `text -> pages` index. Items consolidation
 * reworded past recognition simply stay uncited rather than get a wrong page.
 */
function backfillSourcePages(
  response: ExtractionResponse,
  index: PageIndex
): ExtractionResponse {
  return applySourcePages(response, (text, current) =>
    current.length > 0 ? current : lookupPages(index, text)
  );
}

/**
 * Walk every `sourcePages`-bearing item in an extraction response, replacing
 * each with `resolve(textKey, currentPages)`. Centralizes the schema traversal
 * so stamping, backfilling, and indexing all share one definition of "every
 * item that carries a source page".
 */
type PageResolver = (text: string, current: string[]) => string[];

function applySourcePages(
  response: ExtractionResponse,
  resolve: PageResolver
): ExtractionResponse {
  type Evidence = { description: string; sourcePages: string[] };
  type Quote = { text: string; sourcePages: string[] };
  type Fact = Evidence & { supportingQuotes: Quote[] };
  type Witness = { name: string; supportingQuotes: Quote[]; sourcePages: string[] };
  type Event = { description: string; supportingQuotes: Quote[]; sourcePages: string[] };

  const evidence = <T extends Evidence>(items: T[]): T[] =>
    items.map((item) => ({
      ...item,
      sourcePages: resolve(item.description, item.sourcePages),
    }));
  const quotes = <T extends Quote>(items: T[]): T[] =>
    items.map((item) => ({
      ...item,
      sourcePages: resolve(item.text, item.sourcePages),
    }));
  // Facts and witnesses each carry the verbatim supportingQuotes they were drawn
  // from; stamp/backfill those nested quotes' pages alongside the item itself.
  const facts = <T extends Fact>(items: T[]): T[] =>
    items.map((item) => ({
      ...item,
      supportingQuotes: quotes(item.supportingQuotes),
      sourcePages: resolve(item.description, item.sourcePages),
    }));
  const witnesses = <T extends Witness>(items: T[]): T[] =>
    items.map((item) => ({
      ...item,
      supportingQuotes: quotes(item.supportingQuotes),
      sourcePages: resolve(item.name, item.sourcePages),
    }));
  const events = <T extends Event>(items: T[]): T[] =>
    items.map((item) => ({
      ...item,
      supportingQuotes: quotes(item.supportingQuotes),
      sourcePages: resolve(item.description, item.sourcePages),
    }));
  const allegations = <T extends AllegationItem>(items: T[]): T[] =>
    items.map((item) => ({
      ...item,
      supportingEvidence: evidence(item.supportingEvidence),
      contradictoryEvidence: evidence(item.contradictoryEvidence),
      relevantQuotes: quotes(item.relevantQuotes),
      witnesses: witnesses(item.witnesses),
      sourcePages: resolve(item.allegation || item.description, item.sourcePages),
    }));

  return {
    ...response,
    investigationScope: {
      ...response.investigationScope,
      sourcePages: resolve(
        response.investigationScope.scopeSummary,
        response.investigationScope.sourcePages
      ),
    },
    allegations: allegations(response.allegations),
    canonicalIdentities: response.canonicalIdentities.map((item) => ({
      ...item,
      sourcePages: resolve(item.canonicalName, item.sourcePages),
    })),
    keyEvents: events(response.keyEvents),
    notableQuotes: quotes(response.notableQuotes),
    factualStatements: facts(response.factualStatements),
    opinions: evidence(response.opinions),
    assumptions: evidence(response.assumptions),
    hearsay: evidence(response.hearsay),
    observations: evidence(response.observations),
    potentialWitnesses: witnesses(response.potentialWitnesses),
    consolidatedWitnesses: response.consolidatedWitnesses.map((item) => ({
      ...item,
      sourcePages: resolve(item.name, item.sourcePages),
    })),
    missingInformation: evidence(response.missingInformation),
    followUpQuestions: evidence(response.followUpQuestions),
    recommendedNextInterviews: evidence(response.recommendedNextInterviews),
    riskAreas: evidence(response.riskAreas),
    findingReadiness: {
      supportableFindings: evidence(response.findingReadiness.supportableFindings),
      unprovenFindings: evidence(response.findingReadiness.unprovenFindings),
      evidenceToCollect: evidence(response.findingReadiness.evidenceToCollect),
    },
    interviewPosition: {
      ...response.interviewPosition,
      sourcePages: resolve(
        response.interviewPosition.rationale,
        response.interviewPosition.sourcePages
      ),
    },
    evidenceAssessment: response.evidenceAssessment.map((item) => ({
      ...item,
      sourcePages: resolve(item.allegation, item.sourcePages),
    })),
    pageFindings: response.pageFindings.map((finding) => ({
      ...finding,
      allegations: allegations(finding.allegations),
      factualStatements: evidence(finding.factualStatements),
      opinions: evidence(finding.opinions),
      assumptions: evidence(finding.assumptions),
      hearsay: evidence(finding.hearsay),
      observations: evidence(finding.observations),
      notableQuotes: quotes(finding.notableQuotes),
      supportingEvidence: evidence(finding.supportingEvidence),
      contradictoryEvidence: evidence(finding.contradictoryEvidence),
      potentialWitnesses: witnesses(finding.potentialWitnesses),
      relevantEvents: events(finding.relevantEvents),
    })),
  };
}

/**
 * Re-validate the drafts persisted from an earlier run before reusing them on
 * resume. Stored drafts come back from the database as plain JSON, and the
 * extraction schema may have changed since they were written. If any draft in
 * the group fails validation we return null so the caller re-extracts that
 * chunk from scratch rather than feeding stale data into consolidation.
 */
export function parseStoredDrafts(drafts: unknown[]): ExtractionResponse[] | null {
  const parsed: ExtractionResponse[] = [];

  for (const draft of drafts) {
    const result = extractionResponseSchema.safeParse(draft);
    if (!result.success) return null;
    parsed.push(result.data);
  }

  return parsed;
}

export async function verifyInterviewExtraction(
  extractions: ExtractionResponse[]
): Promise<ExtractionResponse> {
  return requestExtraction(
    VERIFICATION_PROMPT.replace("{{DRAFTS}}", JSON.stringify(extractions))
  );
}

/**
 * How many page drafts (or batch summaries) are consolidated in a single model
 * call. Kept small so we never ask the model to emit one huge JSON object from
 * the entire document at once — the failure mode that truncates responses.
 */
const CONSOLIDATION_BATCH_SIZE = env.extractionConsolidationBatchSize;

export interface ConsolidationOptions {
  mode?: ExtractionMode;
  /**
   * Reports human-readable consolidation progress. Callers also use this to
   * check for cancellation between batches by throwing from the callback.
   */
  onStep?: (message: string) => Promise<void> | void;
}

/**
 * Consolidate per-page extraction drafts into one final result without ever
 * sending the whole document to the model in a single prompt.
 *
 * Page drafts stay the source of truth. Drafts are merged in batches of
 * {@link CONSOLIDATION_BATCH_SIZE}; the resulting batch summaries are then
 * merged again, recursively, until a single result remains. Each call only ever
 * sees a handful of items, so the consolidation prompt stays small regardless
 * of document size. Source page references are preserved by the verification
 * prompt and `normalizeExtractionResponse` at every level.
 */
export async function consolidateExtractions(
  drafts: ExtractionResponse[],
  options: ConsolidationOptions = {}
): Promise<ExtractionResponse> {
  if (drafts.length === 0) {
    throw new ExtractionError(
      "No page extractions were produced, so there is nothing to consolidate."
    );
  }

  await options.onStep?.("Consolidating drafts");
  const pageIndex = buildPageIndex(drafts);
  const quoteIndex = buildSupportingQuoteIndex(drafts);
  const consolidated = mergeDraftsDeterministically(drafts);
  const withQuotes = backfillSupportingQuotes(consolidated, quoteIndex);
  const withPages = backfillSourcePages(withQuotes, pageIndex);
  return (options.mode ?? DEFAULT_EXTRACTION_MODE) === "lean"
    ? applyLeanExtractionMode(withPages)
    : withPages;
}

function mergeDraftsDeterministically(
  drafts: ExtractionResponse[]
): ExtractionResponse {
  const firstMetadataValue = (
    select: (draft: ExtractionResponse) => string | null
  ) => drafts.map(select).find((value) => value && value.trim()) ?? null;

  const investigationScopes = drafts.map((draft) => draft.investigationScope);
  const interviewPositions = drafts.map((draft) => draft.interviewPosition);
  const findingReadinessItems = drafts.map((draft) => draft.findingReadiness);

  return normalizeExtractionResponse({
    intervieweeName: firstMetadataValue((draft) => draft.intervieweeName),
    interviewDate: firstMetadataValue((draft) => draft.interviewDate),
    role: firstMetadataValue((draft) => draft.role),
    interviewerNames: drafts.flatMap((draft) => draft.interviewerNames),
    extractionWarnings: [
      ...drafts.flatMap((draft) => draft.extractionWarnings),
      "Document-level result was consolidated deterministically to avoid long-running AI consolidation.",
    ],
    summary: joinDistinct(drafts.map((draft) => draft.summary)),
    investigationScope: {
      primaryClaimants: investigationScopes.flatMap(
        (scope) => scope.primaryClaimants
      ),
      primaryAccused: investigationScopes.flatMap((scope) => scope.primaryAccused),
      scopeSummary: joinDistinct(
        investigationScopes.map((scope) => scope.scopeSummary)
      ),
      primaryAllegations: investigationScopes.flatMap(
        (scope) => scope.primaryAllegations
      ),
      secondaryObservations: investigationScopes.flatMap(
        (scope) => scope.secondaryObservations
      ),
      sourcePages: investigationScopes.flatMap((scope) => scope.sourcePages),
    },
    allegations: drafts.flatMap((draft) => draft.allegations),
    peopleMentioned: drafts.flatMap((draft) => draft.peopleMentioned),
    canonicalIdentities: drafts.flatMap((draft) => draft.canonicalIdentities),
    keyEvents: drafts.flatMap((draft) => draft.keyEvents),
    notableQuotes: drafts.flatMap((draft) => draft.notableQuotes),
    factualStatements: drafts.flatMap((draft) => draft.factualStatements),
    opinions: drafts.flatMap((draft) => draft.opinions),
    assumptions: drafts.flatMap((draft) => draft.assumptions),
    hearsay: drafts.flatMap((draft) => draft.hearsay),
    observations: drafts.flatMap((draft) => draft.observations),
    potentialWitnesses: drafts.flatMap((draft) => draft.potentialWitnesses),
    consolidatedWitnesses: drafts.flatMap(
      (draft) => draft.consolidatedWitnesses
    ),
    missingInformation: drafts.flatMap((draft) => draft.missingInformation),
    followUpQuestions: drafts.flatMap((draft) => draft.followUpQuestions),
    recommendedNextInterviews: drafts.flatMap(
      (draft) => draft.recommendedNextInterviews
    ),
    riskAreas: drafts.flatMap((draft) => draft.riskAreas),
    findingReadiness: {
      supportableFindings: findingReadinessItems.flatMap(
        (readiness) => readiness.supportableFindings
      ),
      unprovenFindings: findingReadinessItems.flatMap(
        (readiness) => readiness.unprovenFindings
      ),
      evidenceToCollect: findingReadinessItems.flatMap(
        (readiness) => readiness.evidenceToCollect
      ),
    },
    investigationImpact: joinDistinct(
      drafts.map((draft) => draft.investigationImpact)
    ),
    interviewPosition: {
      classification: mostSpecificInterviewPosition(interviewPositions),
      rationale: joinDistinct(
        interviewPositions.map((position) => position.rationale)
      ),
      sourcePages: interviewPositions.flatMap((position) => position.sourcePages),
    },
    evidenceAssessment: drafts.flatMap((draft) => draft.evidenceAssessment),
    pageFindings: drafts.flatMap((draft) => draft.pageFindings),
    suggestedCaseType:
      drafts.map((draft) => draft.suggestedCaseType).find(Boolean) ?? null,
  });
}

function joinDistinct(values: string[]): string {
  return uniqueTrimmed(values)
    .filter((value) => value.length > 0)
    .join("\n\n");
}

function mostSpecificInterviewPosition(
  positions: ExtractionResponse["interviewPosition"][]
): ExtractionResponse["interviewPosition"]["classification"] {
  const classifications = positions.map((position) => position.classification);
  const priority: ExtractionResponse["interviewPosition"]["classification"][] = [
    "Mixed / nuanced",
    "Supports claimant",
    "Supports accused",
    "Neutral witness",
    "Unknown",
  ];
  return (
    priority.find((classification) => classifications.includes(classification)) ??
    "Unknown"
  );
}

async function reduceDrafts(
  drafts: ExtractionResponse[],
  options: ConsolidationOptions
): Promise<ExtractionResponse> {
  // Small enough to merge in a single pass.
  if (drafts.length <= CONSOLIDATION_BATCH_SIZE) {
    return mergeBatch(drafts, options);
  }

  // Otherwise consolidate batch-by-batch, then merge the batch summaries.
  const batches = chunkArray(drafts, CONSOLIDATION_BATCH_SIZE);
  const summaries: ExtractionResponse[] = [];

  for (const [index, batch] of batches.entries()) {
    await options.onStep?.(
      `Consolidating batch ${index + 1} of ${batches.length}`
    );
    summaries.push(await mergeBatch(batch, options));
  }

  await options.onStep?.(`Merging ${summaries.length} batch summaries`);
  return reduceDrafts(summaries, options);
}

/**
 * Merge a single small batch. If the model truncates or returns malformed JSON
 * we retry once over smaller halves, which keeps each prompt even shorter.
 */
async function mergeBatch(
  drafts: ExtractionResponse[],
  options: ConsolidationOptions
): Promise<ExtractionResponse> {
  try {
    return await verifyInterviewExtraction(drafts);
  } catch (error) {
    if (!isRecoverableExtractionError(error) || drafts.length < 2) {
      throw error;
    }

    await options.onStep?.("Retrying consolidation with smaller batches");
    const mid = Math.ceil(drafts.length / 2);
    const firstHalf = await mergeBatch(drafts.slice(0, mid), options);
    const secondHalf = await mergeBatch(drafts.slice(mid), options);
    return verifyInterviewExtraction([firstHalf, secondHalf]);
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function requestExtraction(
  prompt: string,
  mode: ExtractionMode = DEFAULT_EXTRACTION_MODE
): Promise<ExtractionResponse> {
  const { content, truncated } = await getExtractionProvider().complete({
    system: SYSTEM_PROMPT,
    user: prompt,
  });

  if (!content) {
    throw new ExtractionError("The AI returned an empty response.", {
      recoverable: true,
    });
  }

  // The model hit its output token ceiling, so the JSON is almost certainly cut
  // off mid-structure. Recoverable: the caller retries over smaller units.
  if (truncated) {
    throw new ExtractionError(
      "The AI response was cut off before it finished. Try again.",
      { recoverable: true, detail: `truncated=true, chars=${content.length}` }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new ExtractionError(
      "The AI returned a response that was not valid JSON (it may have been truncated).",
      { recoverable: true, cause: error, detail: content.slice(0, 1000) }
    );
  }

  let validated: ExtractionResponse;
  try {
    validated = extractionResponseSchema.parse(parsed);
  } catch (error) {
    const fields = summarizeZodFields(error);
    throw new ExtractionError(
      fields
        ? `The AI response was missing or had the wrong type for: ${fields}.`
        : "The AI response did not match the expected format.",
      {
        recoverable: true,
        cause: error,
        detail: error instanceof Error ? error.message : String(error),
      }
    );
  }

  const normalized = normalizeExtractionResponse(validated);
  return mode === "lean" ? applyLeanExtractionMode(normalized) : normalized;
}

/**
 * Turn a ZodError into a short, human-readable list of the dotted field paths
 * that failed (e.g. "summary, allegations[0].description"), so a validation
 * failure tells the investigator *which* fields were wrong rather than just
 * "did not match the expected format". Returns null for non-Zod errors.
 */
function summarizeZodFields(error: unknown): string | null {
  if (!(error instanceof ZodError) || error.issues.length === 0) return null;

  const paths = new Set<string>();
  for (const issue of error.issues) {
    const path = issue.path
      .map((segment) =>
        typeof segment === "number"
          ? `[${segment}]`
          : `.${String(segment)}`
      )
      .join("")
      .replace(/^\./, "");
    paths.add(path || "(root)");
  }

  const fields = [...paths];
  const shown = fields.slice(0, 5).join(", ");
  return fields.length > 5 ? `${shown} (+${fields.length - 5} more)` : shown;
}

function normalizeExtractionResponse(
  extraction: ExtractionResponse
): ExtractionResponse {
  const peopleMentioned = normalizePersonList(extraction.peopleMentioned);
  const canonicalIdentities = normalizeIdentityItems(
    extraction.canonicalIdentities
  );
  const interviewerNames = normalizePersonList(extraction.interviewerNames);
  const allegations = normalizeAllegations(extraction.allegations);
  const keyEvents = normalizeEvents(extraction.keyEvents);
  const notableQuotes = normalizeQuoteItems(extraction.notableQuotes);
  const factualStatements = normalizeFactItems(extraction.factualStatements);
  const opinions = normalizeEvidenceItems(extraction.opinions);
  const assumptions = normalizeEvidenceItems(extraction.assumptions);
  const hearsay = normalizeEvidenceItems(extraction.hearsay);
  const observations = normalizeEvidenceItems(extraction.observations);
  const potentialWitnesses = normalizeWitnessItems(extraction.potentialWitnesses);
  const consolidatedWitnesses = normalizeConsolidatedWitnessItems(
    extraction.consolidatedWitnesses
  );
  const missingInformation = normalizeEvidenceItems(extraction.missingInformation);
  const followUpQuestions = normalizeEvidenceItems(extraction.followUpQuestions);
  const recommendedNextInterviews = normalizeEvidenceItems(
    extraction.recommendedNextInterviews
  );
  const riskAreas = normalizeEvidenceItems(extraction.riskAreas);

  const normalized: ExtractionResponse = {
    ...extraction,
    intervieweeName: normalizeMetadataName(extraction.intervieweeName),
    interviewerNames,
    extractionWarnings: uniqueTrimmed(extraction.extractionWarnings),
    investigationScope: normalizeInvestigationScope(
      extraction.investigationScope
    ),
    allegations,
    peopleMentioned,
    canonicalIdentities,
    keyEvents,
    notableQuotes,
    factualStatements,
    opinions,
    assumptions,
    hearsay,
    observations,
    potentialWitnesses,
    consolidatedWitnesses,
    missingInformation,
    followUpQuestions,
    recommendedNextInterviews,
    riskAreas,
    findingReadiness: normalizeFindingReadiness(extraction.findingReadiness),
    investigationImpact: extraction.investigationImpact.trim(),
    interviewPosition: {
      ...extraction.interviewPosition,
      rationale: extraction.interviewPosition.rationale.trim(),
      sourcePages: normalizeSourcePages(extraction.interviewPosition.sourcePages),
    },
    evidenceAssessment: dedupeByKey(
      extraction.evidenceAssessment
        .map((assessment) => ({
          allegation: assessment.allegation.trim(),
          strengthOfSupportingEvidence:
            assessment.strengthOfSupportingEvidence.trim(),
          strengthOfContradictoryEvidence:
            assessment.strengthOfContradictoryEvidence.trim(),
          confidenceLevel: assessment.confidenceLevel.trim(),
          supportableFindings: uniqueTrimmed(assessment.supportableFindings),
          unprovenFindings: uniqueTrimmed(assessment.unprovenFindings),
          evidenceToCollect: uniqueTrimmed(assessment.evidenceToCollect),
          missingInformation: uniqueTrimmed(assessment.missingInformation),
          recommendedActions: uniqueTrimmed(assessment.recommendedActions),
          sourcePages: normalizeSourcePages(assessment.sourcePages),
        }))
        .filter((assessment) => assessment.allegation.length > 0),
      (assessment) =>
        [
          normalizeForComparison(assessment.allegation),
          assessment.sourcePages.join(","),
        ].join("|")
    ),
    pageFindings: extraction.pageFindings
      .map((page) => ({
        sourcePage: normalizeSourcePage(page.sourcePage),
        allegations: normalizeAllegations(page.allegations),
        factualStatements: normalizeEvidenceItems(page.factualStatements),
        opinions: normalizeEvidenceItems(page.opinions),
        assumptions: normalizeEvidenceItems(page.assumptions),
        hearsay: normalizeEvidenceItems(page.hearsay),
        observations: normalizeEvidenceItems(page.observations),
        notableQuotes: normalizeQuoteItems(page.notableQuotes),
        supportingEvidence: normalizeEvidenceItems(page.supportingEvidence),
        contradictoryEvidence: normalizeEvidenceItems(page.contradictoryEvidence),
        potentialWitnesses: normalizeWitnessItems(page.potentialWitnesses),
        relevantEvents: normalizeEvents(page.relevantEvents),
      }))
      .filter((page) => page.sourcePage.length > 0),
  };

  return applyCanonicalIdentities(normalized);
}

/**
 * Collapse the spelling variants the model already grouped under
 * `canonicalIdentities` everywhere else a person name is used as data:
 * investigation scope, allegation claimant/subject, witnesses, and event
 * participants. The model reliably records that "Caroline Meneor", "Menet", and
 * "Aumieux" are one person in canonicalIdentities, but leaves the raw variants
 * scattered across the scope arrays, where the fuzzy person matcher cannot merge
 * them (different surnames score below its similarity threshold). Left
 * unresolved, one person surfaces as several distinct claimants/accused, which
 * inverts roles downstream. Rewriting every person field through the identity
 * map — then re-deduping — makes the scope arrays agree with the identities.
 */
function applyCanonicalIdentities(
  extraction: ExtractionResponse
): ExtractionResponse {
  const resolve = buildCanonicalResolver(extraction.canonicalIdentities);

  const renameWitnesses = <T extends { name: string }>(items: T[]): T[] =>
    items.map((item) => ({ ...item, name: resolve(item.name) }));
  const renameAllegations = (items: AllegationItem[]): AllegationItem[] =>
    items.map((item) => ({
      ...item,
      claimant: item.claimant === null ? null : resolve(item.claimant),
      subject: item.subject === null ? null : resolve(item.subject),
      witnesses: renameWitnesses(item.witnesses),
    }));
  const renameEvents = (items: EventItem[]): EventItem[] =>
    items.map((item) => ({
      ...item,
      participants: item.participants.map(resolve),
    }));

  return {
    ...extraction,
    investigationScope: {
      ...extraction.investigationScope,
      primaryClaimants: normalizePersonList(
        extraction.investigationScope.primaryClaimants.map(resolve)
      ),
      primaryAccused: normalizePersonList(
        extraction.investigationScope.primaryAccused.map(resolve)
      ),
    },
    allegations: normalizeAllegations(renameAllegations(extraction.allegations)),
    peopleMentioned: normalizePersonList(extraction.peopleMentioned.map(resolve)),
    keyEvents: normalizeEvents(renameEvents(extraction.keyEvents)),
    potentialWitnesses: normalizeWitnessItems(
      renameWitnesses(extraction.potentialWitnesses)
    ),
    consolidatedWitnesses: normalizeConsolidatedWitnessItems(
      renameWitnesses(extraction.consolidatedWitnesses)
    ),
    pageFindings: extraction.pageFindings.map((finding) => ({
      ...finding,
      allegations: normalizeAllegations(renameAllegations(finding.allegations)),
      potentialWitnesses: normalizeWitnessItems(
        renameWitnesses(finding.potentialWitnesses)
      ),
      relevantEvents: normalizeEvents(renameEvents(finding.relevantEvents)),
    })),
  };
}

/**
 * Build a `variant spelling -> canonical name` resolver from the consolidated
 * identities. Every spelling the model attached to an identity (the canonical
 * name and each variant) maps to that identity's canonical name; unknown names
 * pass through unchanged. Matching is done on the normalized comparison key so
 * accents, casing, and punctuation differences still resolve.
 */
function buildCanonicalResolver(
  identities: IdentityItem[]
): (name: string) => string {
  const byVariant = new Map<string, string>();
  for (const identity of identities) {
    for (const name of [identity.canonicalName, ...identity.variants]) {
      const key = normalizeForComparison(name);
      if (key) byVariant.set(key, identity.canonicalName);
    }
  }
  return (name) => byVariant.get(normalizeForComparison(name)) ?? name;
}

type EvidenceItem = ExtractionResponse["opinions"][number];
type FactItem = ExtractionResponse["factualStatements"][number];
type QuoteItem = ExtractionResponse["notableQuotes"][number];
type WitnessItem = ExtractionResponse["potentialWitnesses"][number];
type ConsolidatedWitnessItem =
  ExtractionResponse["consolidatedWitnesses"][number];
type EventItem = ExtractionResponse["keyEvents"][number];
type AllegationItem = ExtractionResponse["allegations"][number];
type IdentityItem = ExtractionResponse["canonicalIdentities"][number];
type InvestigationScope = ExtractionResponse["investigationScope"];
type FindingReadiness = ExtractionResponse["findingReadiness"];

const LEAN_FACT_LIMIT = 30;
const LEAN_EVENT_LIMIT = 30;
const LEAN_WARNING_LIMIT = 10;
const LEAN_ROLE_LENGTH = 80;
const LEAN_RELEVANCE_LENGTH = 180;

function applyLeanExtractionMode(
  extraction: ExtractionResponse
): ExtractionResponse {
  return {
    ...extraction,
    extractionWarnings: selectLeanWarnings(extraction.extractionWarnings),
    allegations: extraction.allegations.map((allegation) => ({
      ...allegation,
      followUpQuestions: [],
      riskAreas: allegation.riskAreas.slice(0, 3),
      witnesses: allegation.witnesses.map((witness) => ({
        ...witness,
        relevance: truncateText(witness.relevance, LEAN_RELEVANCE_LENGTH),
      })),
    })),
    canonicalIdentities: extraction.canonicalIdentities.map((identity) => ({
      ...identity,
      role: identity.role ? truncateText(identity.role, LEAN_ROLE_LENGTH) : null,
    })),
    keyEvents: extraction.keyEvents.slice(0, LEAN_EVENT_LIMIT),
    notableQuotes: [],
    factualStatements: extraction.factualStatements.slice(0, LEAN_FACT_LIMIT),
    potentialWitnesses: extraction.potentialWitnesses.map((witness) => ({
      ...witness,
      relevance: truncateText(witness.relevance, LEAN_RELEVANCE_LENGTH),
    })),
    consolidatedWitnesses: extraction.consolidatedWitnesses.map((witness) => ({
      ...witness,
      whyTheyMatter: truncateText(witness.whyTheyMatter, LEAN_RELEVANCE_LENGTH),
    })),
    followUpQuestions: [],
    recommendedNextInterviews: [],
    evidenceAssessment: [],
    pageFindings: extraction.pageFindings.map((finding) => ({
      ...finding,
      notableQuotes: [],
      relevantEvents: finding.relevantEvents.slice(0, LEAN_EVENT_LIMIT),
    })),
  };
}

function selectLeanWarnings(warnings: string[]): string[] {
  const actionable = uniqueTrimmed(warnings).filter(isActionableWarning);
  return actionable.slice(0, LEAN_WARNING_LIMIT);
}

function isActionableWarning(warning: string): boolean {
  return /speaker|attribution|pagination|page|interviewee|identity|incomplete|poor|quality|unavailable|unclear|uncertain|ambiguous|missing|unreliable|conflict/i.test(
    warning
  );
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeAllegations(allegations: AllegationItem[]): AllegationItem[] {
  return dedupeByKey(
    allegations
      .map((allegation) => {
        const description = allegation.description.trim();
        const allegationText = (
          allegation.allegation?.trim() || description
        ).trim();

        return {
          ...allegation,
          date: normalizeNullableText(allegation.date),
          claimant: normalizeMetadataName(allegation.claimant),
          subject: normalizeMetadataName(allegation.subject),
          classification: allegation.classification,
          allegation: allegationText,
          description,
          supportingEvidence: normalizeEvidenceItems(
            allegation.supportingEvidence
          ),
          contradictoryEvidence: normalizeEvidenceItems(
            allegation.contradictoryEvidence
          ),
          missingEvidence: uniqueTrimmed(allegation.missingEvidence),
          relevantQuotes: normalizeQuoteItems(
            allegation.relevantQuotes,
            SUPPORTING_QUOTE_MIN_LENGTH
          ),
          witnesses: normalizeWitnessItems(allegation.witnesses),
          followUpQuestions: uniqueTrimmed(allegation.followUpQuestions),
          riskAreas: uniqueTrimmed(allegation.riskAreas),
          sourcePages: normalizeSourcePages(allegation.sourcePages),
        };
      })
      .filter((allegation) => allegation.description.length > 0),
    (allegation) =>
      [
        allegation.date ?? "",
        allegation.claimant ?? "",
        allegation.subject ?? "",
        normalizeForComparison(allegation.description),
        allegation.sourcePages.join(","),
      ].join("|")
  );
}

function normalizeInvestigationScope(
  scope: InvestigationScope
): InvestigationScope {
  return {
    primaryClaimants: normalizePersonList(scope.primaryClaimants),
    primaryAccused: normalizePersonList(scope.primaryAccused),
    scopeSummary: scope.scopeSummary.trim(),
    primaryAllegations: uniqueTrimmed(scope.primaryAllegations),
    secondaryObservations: uniqueTrimmed(scope.secondaryObservations),
    sourcePages: normalizeSourcePages(scope.sourcePages),
  };
}

function normalizeFindingReadiness(
  findingReadiness: FindingReadiness
): FindingReadiness {
  return {
    supportableFindings: normalizeEvidenceItems(
      findingReadiness.supportableFindings
    ),
    unprovenFindings: normalizeEvidenceItems(
      findingReadiness.unprovenFindings
    ),
    evidenceToCollect: normalizeEvidenceItems(
      findingReadiness.evidenceToCollect
    ),
  };
}

function normalizeEvents(events: EventItem[]): EventItem[] {
  return dedupeByKey(
    events
      .map((event) => ({
        date: normalizeNullableText(event.date),
        description: event.description.trim(),
        participants: normalizePersonList(event.participants),
        supportingQuotes: normalizeQuoteItems(
          event.supportingQuotes,
          SUPPORTING_QUOTE_MIN_LENGTH
        ),
        sourcePages: normalizeSourcePages(event.sourcePages),
      }))
      .filter((event) => event.description.length > 0),
    (event) =>
      [
        event.date ?? "",
        normalizeForComparison(event.description),
        event.participants.map(normalizeForComparison).join(","),
        event.sourcePages.join(","),
      ].join("|")
  );
}

function normalizeEvidenceItems(items: EvidenceItem[]): EvidenceItem[] {
  return dedupeByKey(
    items
      .map((item) => ({
        description: item.description.trim(),
        sourcePages: normalizeSourcePages(item.sourcePages),
      }))
      .filter((item) => item.description.length > 0),
    (item) =>
      [normalizeForComparison(item.description), item.sourcePages.join(",")].join(
        "|"
      )
  );
}

function normalizeFactItems(items: FactItem[]): FactItem[] {
  return dedupeByKey(
    items
      .map((item) => ({
        description: item.description.trim(),
        supportingQuotes: normalizeQuoteItems(
          item.supportingQuotes,
          SUPPORTING_QUOTE_MIN_LENGTH
        ),
        sourcePages: normalizeSourcePages(item.sourcePages),
      }))
      .filter((item) => item.description.length > 0),
    (item) =>
      [normalizeForComparison(item.description), item.sourcePages.join(",")].join(
        "|"
      )
  );
}

function normalizeWitnessItems(items: WitnessItem[]): WitnessItem[] {
  return dedupeByKey(
    items
      .map((item) => ({
        name: normalizeMetadataName(item.name) ?? item.name.trim(),
        relevance: item.relevance.trim(),
        supportingQuotes: normalizeQuoteItems(
          item.supportingQuotes,
          SUPPORTING_QUOTE_MIN_LENGTH
        ),
        sourcePages: normalizeSourcePages(item.sourcePages),
      }))
      .filter((item) => item.name.length > 0 && item.relevance.length > 0),
    (item) =>
      [
        normalizeForComparison(item.name),
        normalizeForComparison(item.relevance),
        item.sourcePages.join(","),
      ].join("|")
  );
}

function normalizeConsolidatedWitnessItems(
  items: ConsolidatedWitnessItem[]
): ConsolidatedWitnessItem[] {
  return dedupeByKey(
    items
      .map((item) => ({
        name: normalizeMetadataName(item.name) ?? item.name.trim(),
        whyTheyMatter: item.whyTheyMatter.trim(),
        relatedAllegations: uniqueTrimmed(item.relatedAllegations),
        mentionedInInterviews: uniqueTrimmed(item.mentionedInInterviews),
        priorityScore: Math.max(0, Math.min(100, item.priorityScore)),
        sourcePages: normalizeSourcePages(item.sourcePages),
      }))
      .filter((item) => item.name.length > 0 && item.whyTheyMatter.length > 0)
      .sort((left, right) => right.priorityScore - left.priorityScore),
    (item) =>
      [
        normalizeForComparison(item.name),
        normalizeForComparison(item.whyTheyMatter),
        item.sourcePages.join(","),
      ].join("|")
  );
}

function normalizeIdentityItems(items: IdentityItem[]): IdentityItem[] {
  const cleaned = items
    .map((item) => ({
      canonicalName:
        normalizeMetadataName(item.canonicalName) ?? item.canonicalName.trim(),
      variants: normalizePersonList(item.variants),
      role: normalizeNullableText(item.role),
      sourcePages: normalizeSourcePages(item.sourcePages),
    }))
    .filter((item) => item.canonicalName.length > 0);

  return mergeIdentities(cleaned);
}

/**
 * Merge identity entries that describe the same person. The model emits one
 * identity per page draft, so the same person can arrive as several entries with
 * different chosen canonical spellings (e.g. "Caroline Menet" on one page,
 * "Caroline Aumieux" on another) that only overlap through their variant lists.
 * Deduping by canonical name alone would keep those entries apart and leave each
 * with a partial variant list, so the resolver above could not collapse every
 * spelling. We instead connect entries transitively through every spelling the
 * model grouped together and collapse each connected group to one canonical name
 * with the union of its variants, role, and source pages. This only ever merges
 * spellings the model itself already asserted belong to one person — it never
 * infers a new merge.
 */
function mergeIdentities(items: IdentityItem[]): IdentityItem[] {
  type Group = {
    displays: Map<string, string>;
    canonicalKeys: string[];
    roles: string[];
    sourcePages: string[];
  };
  const groups: Group[] = [];

  for (const item of items) {
    const entries = [item.canonicalName, ...item.variants]
      .map((name) => ({ key: normalizeForComparison(name), display: name }))
      .filter((entry) => entry.key.length > 0);
    if (entries.length === 0) continue;

    const matched = groups.filter((group) =>
      entries.some((entry) => group.displays.has(entry.key))
    );
    const group: Group = matched[0] ?? {
      displays: new Map(),
      canonicalKeys: [],
      roles: [],
      sourcePages: [],
    };
    if (matched.length === 0) groups.push(group);

    // This entry can bridge several existing groups; fold the extras into the
    // first match and drop them.
    for (const other of matched.slice(1)) {
      for (const [key, display] of other.displays) {
        if (!group.displays.has(key)) group.displays.set(key, display);
      }
      group.canonicalKeys.push(...other.canonicalKeys);
      group.roles.push(...other.roles);
      group.sourcePages.push(...other.sourcePages);
      groups.splice(groups.indexOf(other), 1);
    }

    for (const entry of entries) {
      if (!group.displays.has(entry.key)) {
        group.displays.set(entry.key, entry.display);
      }
    }
    group.canonicalKeys.push(normalizeForComparison(item.canonicalName));
    if (item.role) group.roles.push(item.role);
    group.sourcePages.push(...item.sourcePages);
  }

  return groups.map((group) => {
    const canonicalName = selectCanonicalName(
      group.canonicalKeys
        .map((key) => group.displays.get(key))
        .filter((name): name is string => Boolean(name))
    );
    const canonicalKey = normalizeForComparison(canonicalName);
    return {
      canonicalName,
      variants: uniqueTrimmed(
        [...group.displays]
          .filter(([key]) => key !== canonicalKey)
          .map(([, display]) => display)
      ),
      role: group.roles[0] ?? null,
      sourcePages: normalizeSourcePages(group.sourcePages),
    };
  });
}

/**
 * `notableQuotes` are free-standing context quotes, so we reject short fragments
 * to keep the list meaningful. Supporting/relevant quotes are evidence
 * deliberately tied to a specific fact, witness, or allegation and are often
 * short on purpose (e.g. "C'est humiliant."), so they use a much lower floor —
 * only empty/near-empty strings are dropped.
 */
const NOTABLE_QUOTE_MIN_LENGTH = 20;
const SUPPORTING_QUOTE_MIN_LENGTH = 2;

function normalizeQuoteItems(
  quotes: QuoteItem[],
  minLength: number = NOTABLE_QUOTE_MIN_LENGTH
): QuoteItem[] {
  return dedupeByKey(
    quotes
      .map((quote) => ({
        speaker: normalizeMetadataName(quote.speaker),
        text: quote.text.trim().replace(/\s+/g, " "),
        sourcePages: normalizeSourcePages(quote.sourcePages),
      }))
      .filter((quote) => quote.text.length >= minLength),
    (quote) =>
      [
        quote.speaker ?? "",
        normalizeForComparison(quote.text),
        quote.sourcePages.join(","),
      ].join("|")
  );
}

function normalizeSourcePages(sourcePages: string[]): string[] {
  return uniqueTrimmed(sourcePages)
    .map(normalizeSourcePage)
    .filter(Boolean);
}

function normalizeSourcePage(sourcePage: string): string {
  const normalized = sourcePage.replace(/\s+/g, " ").trim();
  if (/^chunks?\b/i.test(normalized)) return "";
  if (/^internal segments?\b/i.test(normalized)) return "";
  if (/pagination unavailable|source location unavailable/i.test(normalized)) {
    return "";
  }

  const pageRange = normalized.match(/^pages?\s+(\d+)(?:\s*[-–]\s*(\d+))?$/i);
  if (!pageRange) return normalized;

  const start = pageRange[1];
  const end = pageRange[2];
  return end ? `Pages ${start}-${end}` : `Page ${start}`;
}

function normalizeMetadataName(name: string | null): string | null {
  if (!name) return null;

  return normalizePersonList([name])[0] ?? null;
}

function normalizeNullableText(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePersonList(names: string[]): string[] {
  const candidates = names
    .map(cleanPersonCandidate)
    .filter((name): name is string => Boolean(name));
  const occurrenceCounts = countBy(candidates.map(normalizeForComparison));
  const accepted = candidates.filter((candidate) =>
    shouldKeepPersonCandidate(
      candidate,
      occurrenceCounts.get(normalizeForComparison(candidate)) ?? 0
    )
  );
  const groups: string[][] = [];

  for (const candidate of accepted) {
    const group = groups.find((existing) =>
      existing.some((name) => areLikelySamePerson(name, candidate))
    );

    if (group) {
      group.push(candidate);
    } else {
      groups.push([candidate]);
    }
  }

  return groups.map(selectCanonicalName);
}

function cleanPersonCandidate(value: string): string | null {
  const cleaned = value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(?:speaker|interviewer|unknown speaker|participant)\s*\d*\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");

  return cleaned.length > 0 ? cleaned : null;
}

function shouldKeepPersonCandidate(candidate: string, occurrenceCount: number) {
  const comparison = normalizeForComparison(candidate);
  const words = comparison.split(" ").filter(Boolean);

  if (GENERIC_PERSON_LABELS.has(comparison)) return false;
  if (words.length === 0) return false;
  if (words.every((word) => word.length === 1)) return false;
  if (/[0-9]|\uFFFD/.test(candidate) && occurrenceCount < 2) return false;

  const letters = Array.from(candidate.matchAll(/\p{L}/gu)).length;
  const nonSpaceChars = candidate.replace(/\s/g, "").length;
  if (nonSpaceChars > 0 && letters / nonSpaceChars < 0.65 && occurrenceCount < 2) {
    return false;
  }

  return true;
}

function areLikelySamePerson(left: string, right: string) {
  const leftKey = normalizeForComparison(left);
  const rightKey = normalizeForComparison(right);

  if (leftKey === rightKey) return true;
  if (sortedNameKey(leftKey) === sortedNameKey(rightKey)) return true;

  const leftWords = leftKey.split(" ").filter(Boolean);
  const rightWords = rightKey.split(" ").filter(Boolean);

  if (leftWords.length === 1 && rightWords.length === 1) {
    return levenshteinSimilarity(leftKey, rightKey) >= 0.88;
  }

  const sharedWords = leftWords.filter((word) => rightWords.includes(word));
  if (sharedWords.length > 0 && levenshteinSimilarity(leftKey, rightKey) >= 0.78) {
    return true;
  }

  return false;
}

function selectCanonicalName(names: string[]) {
  return [...names].sort((left, right) => {
    const leftWords = normalizeForComparison(left).split(" ").length;
    const rightWords = normalizeForComparison(right).split(" ").length;

    if (rightWords !== leftWords) return rightWords - leftWords;
    return right.length - left.length;
  })[0];
}

function sortedNameKey(value: string) {
  return value.split(" ").filter(Boolean).sort().join(" ");
}

function normalizeQuotes(quotes: string[]): string[] {
  return dedupeByKey(
    quotes
      .map((quote) => quote.trim().replace(/\s+/g, " "))
      .filter((quote) => quote.length >= 35)
      .filter((quote) => /[.!?]"?$/.test(quote)),
    normalizeForComparison
  );
}

function uniqueTrimmed(values: string[]) {
  return dedupeByKey(
    values.map((value) => value.trim()).filter(Boolean),
    normalizeForComparison
  );
}

function dedupeByKey<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function normalizeForComparison(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\s'-]/gu, " ")
    .replace(/\b(?:mr|mrs|ms|mme|mlle|m|monsieur|madame|dr)\b\.?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinSimilarity(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;

  return 1 - levenshteinDistance(left, right) / maxLength;
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;

    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

const GENERIC_PERSON_LABELS = new Set([
  "employee",
  "interviewee",
  "interviewer",
  "manager",
  "participant",
  "person concerned",
  "personne mise en cause",
  "speaker",
  "unknown",
  "unknown speaker",
  "witness",
]);
