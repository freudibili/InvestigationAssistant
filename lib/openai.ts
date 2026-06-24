import "server-only";

import OpenAI from "openai";
import { env } from "@/lib/env";
import { extractionResponseSchema } from "@/lib/validation";
import { CASE_TYPES } from "@/lib/types";
import type { ExtractionResponse } from "@/lib/validation";
import type { ExtractionChunk } from "@/lib/extraction-chunks";

let client: OpenAI | null = null;

function getClient() {
  if (!client) client = new OpenAI({ apiKey: env.openaiApiKey });
  return client;
}

const SYSTEM_PROMPT = `You are an investigation analysis assistant for workplace investigators.
Your job is not to summarize interviews. Your job is to extract traceable investigative material that helps investigators build findings, assess allegations, test evidence, identify contradictions, plan follow-up questions, and prepare conclusions.
Use only information explicitly present in the transcript. Clearly separate facts, allegations, opinions, assumptions, hearsay, observations, evidence, and contradictions.
Never infer guilt, never draw legal conclusions, and never invent facts.
Every allegation, event, finding, quote, witness reference, assessment, and action recommendation must include sourcePages back to the original document page labels provided by the user.
Never expose, cite, or mention internal processing chunks. Investigators work with documents and pages only.
If a field is not present, return null for metadata or an empty array for lists.
Names attached to recording/transcription metadata, meeting ownership, or a speaker asking consent/context questions are not interviewee names.
Return ONLY valid JSON matching the requested schema — no markdown, no commentary.`;

const CASE_TYPE_LIST = CASE_TYPES.join('", "');

const USER_PROMPT = `Analyze this workplace investigation interview transcript page.

Optimize for investigation, evidence analysis, traceability, and report preparation. Do not optimize for summarization.

For the provided source label, extract:

1. Interview metadata: interviewee name, interview date, interviewee role, and interviewer names.
2. Extraction warnings: uncertainty, unreliable speaker labels, ambiguous interviewee identity, missing answer attribution, poor source quality, or places where a page is too thin to assess.
3. Investigation scope: primary claimant(s), primary accused person(s), the actual issue under investigation, primary allegations, and secondary observations.
4. Allegations: claims, accusations, complaints, or alleged misconduct. For each, identify who is making the allegation, who is the subject, what exactly is alleged, whether it is primary or secondary, supporting evidence, contradictory evidence, missing evidence, relevant quotes, witnesses, follow-up questions, risk areas, and sourcePages.
5. Factual statements: concrete claims of fact, dates, procedural steps, actions taken, communications, decisions, or things the interviewee says occurred. Do not mix these with opinions.
6. Opinions: subjective evaluations, beliefs, judgments, impressions, interpretations, characterizations, or motive attributions.
7. Assumptions: statements that are speculative, inferred, uncertain, or not based on direct knowledge.
8. Hearsay: statements relaying what someone else allegedly said, saw, believed, reported, or experienced.
9. Observations: direct sensory or firsthand observations by the speaker, separate from interpretations of motive or character.
10. Notable quotes: complete, contextual sentences useful for findings, contradictions, credibility, motive, knowledge, or chronology.
11. Supporting evidence: statements or documents mentioned that support an allegation or relevant finding.
12. Contradictory evidence: statements or documents mentioned that refute, weaken, conflict with, or complicate an allegation or relevant finding.
13. Potential witnesses: people who may confirm, refute, contextualize, or add evidence.
14. Recommended next interviews: people or roles to interview next and why.
15. Relevant events: dated or sequenceable happenings, procedural steps, meetings, reports, decisions, or incidents.
16. People mentioned and canonical identities: deduplicated canonical people only, with likely transcription variants merged.
17. Finding readiness: what findings can be supported, what remains unproven, and what evidence still needs collection.
18. A short investigation-focused summary of this page.
19. Suggested case type, chosen from "${CASE_TYPE_LIST}", only if clearly supported.

Rules:
- Every item must include sourcePages with the exact page label provided in the transcript header, such as "Page 4" or "Pages 17-18".
- Do not use chunk labels. If internal chunking is mentioned or implied, convert the reference to the page label from the transcript header.
- Keep allegations separate from facts and events. An allegation is a claim to be tested; it is not a proven fact.
- Do not classify opinions, interpretations, assumptions, hearsay, or direct observations as allegations unless they also assert specific alleged misconduct or a complaint to be investigated.
- Example: "Philippe has difficulty accepting Caroline as his superior" is an opinion or interpretation attributed to the speaker. It is not an allegation unless the transcript connects it to specific alleged misconduct.
- Clearly distinguish direct observations from hearsay, opinions, assumptions, and factual statements.
- Use null rather than guessing a date, claimant, subject, role, speaker, or metadata value.
- Supporting evidence and contradictory evidence must be tied to what appears on this source page.
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
      "sourcePages": string[]
    }
  ],
  "notableQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }],
  "factualStatements": [{ "description": string, "sourcePages": string[] }],
  "opinions": [{ "description": string, "sourcePages": string[] }],
  "assumptions": [{ "description": string, "sourcePages": string[] }],
  "hearsay": [{ "description": string, "sourcePages": string[] }],
  "observations": [{ "description": string, "sourcePages": string[] }],
  "potentialWitnesses": [{ "name": string, "relevance": string, "sourcePages": string[] }],
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
      "relevantEvents": [{ "date": string | null, "description": string, "participants": string[], "sourcePages": string[] }]
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
- Preserve all sourcePages. When merging items, combine their sourcePages.
- Never expose, preserve, or create chunk references. If a draft contains a chunk reference, replace it with the nearest available page reference or omit the source reference and add an extraction warning.
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
- Preserve pageFindings from the page drafts. If true page references are unavailable, use the best available page label and warn that exact source pagination could not be verified.
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
      "sourcePages": string[]
    }
  ],
  "notableQuotes": [{ "speaker": string | null, "text": string, "sourcePages": string[] }],
  "factualStatements": [{ "description": string, "sourcePages": string[] }],
  "opinions": [{ "description": string, "sourcePages": string[] }],
  "assumptions": [{ "description": string, "sourcePages": string[] }],
  "hearsay": [{ "description": string, "sourcePages": string[] }],
  "observations": [{ "description": string, "sourcePages": string[] }],
  "potentialWitnesses": [{ "name": string, "relevance": string, "sourcePages": string[] }],
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
      "relevantEvents": [{ "date": string | null, "description": string, "participants": string[], "sourcePages": string[] }]
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
  transcript: string
): Promise<ExtractionResponse> {
  return requestExtraction(USER_PROMPT.replace("{{TRANSCRIPT}}", transcript));
}

export async function extractInterviewChunk(
  chunk: ExtractionChunk,
  documentName: string
): Promise<ExtractionResponse> {
  return requestExtraction(
    USER_PROMPT.replace(
      "{{TRANSCRIPT}}",
      `Document: ${documentName}\nSource page: ${chunk.label}\n\n${chunk.text}`
    )
  );
}

export async function verifyInterviewExtraction(
  extractions: ExtractionResponse[]
): Promise<ExtractionResponse> {
  return requestExtraction(
    VERIFICATION_PROMPT.replace("{{DRAFTS}}", JSON.stringify(extractions))
  );
}

async function requestExtraction(prompt: string): Promise<ExtractionResponse> {
  const completion = await getClient().chat.completions.create({
    model: env.openaiModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("The model returned an empty response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("The model did not return valid JSON.");
  }

  return normalizeExtractionResponse(extractionResponseSchema.parse(parsed));
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
  const factualStatements = normalizeEvidenceItems(extraction.factualStatements);
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

  return {
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
}

type EvidenceItem = ExtractionResponse["factualStatements"][number];
type QuoteItem = ExtractionResponse["notableQuotes"][number];
type WitnessItem = ExtractionResponse["potentialWitnesses"][number];
type ConsolidatedWitnessItem =
  ExtractionResponse["consolidatedWitnesses"][number];
type EventItem = ExtractionResponse["keyEvents"][number];
type AllegationItem = ExtractionResponse["allegations"][number];
type IdentityItem = ExtractionResponse["canonicalIdentities"][number];
type InvestigationScope = ExtractionResponse["investigationScope"];
type FindingReadiness = ExtractionResponse["findingReadiness"];

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
          relevantQuotes: normalizeQuoteItems(allegation.relevantQuotes),
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

function normalizeWitnessItems(items: WitnessItem[]): WitnessItem[] {
  return dedupeByKey(
    items
      .map((item) => ({
        name: normalizeMetadataName(item.name) ?? item.name.trim(),
        relevance: item.relevance.trim(),
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
  return dedupeByKey(
    items
      .map((item) => {
        const canonicalName =
          normalizeMetadataName(item.canonicalName) ??
          item.canonicalName.trim();
        const canonicalKey = normalizeForComparison(canonicalName);
        const variants = normalizePersonList(item.variants).filter(
          (variant) => normalizeForComparison(variant) !== canonicalKey
        );

        return {
          canonicalName,
          variants: uniqueTrimmed(variants),
          role: normalizeNullableText(item.role),
          sourcePages: normalizeSourcePages(item.sourcePages),
        };
      })
      .filter((item) => item.canonicalName.length > 0),
    (item) => normalizeForComparison(item.canonicalName)
  );
}

function normalizeQuoteItems(quotes: QuoteItem[]): QuoteItem[] {
  return dedupeByKey(
    quotes
      .map((quote) => ({
        speaker: normalizeMetadataName(quote.speaker),
        text: quote.text.trim().replace(/\s+/g, " "),
        sourcePages: normalizeSourcePages(quote.sourcePages),
      }))
      .filter((quote) => quote.text.length >= 20),
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
