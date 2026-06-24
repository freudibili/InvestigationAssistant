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

const SYSTEM_PROMPT = `You are an assistant that helps workplace investigators organize interview transcripts.
You only extract and organize information that is explicitly present in the transcript.
You never infer guilt, never draw legal conclusions, and never invent facts.
If a field is not present in the transcript, return null (for metadata) or an empty array (for lists).
Names attached to recording/transcription metadata, meeting ownership, or a speaker asking consent/context questions are not interviewee names.
Return ONLY valid JSON matching the requested schema — no markdown, no commentary.`;

const CASE_TYPE_LIST = CASE_TYPES.join('", "');

const USER_PROMPT = `Analyze this workplace investigation interview transcript section.

Extract:

1. Interviewee name — the person being questioned or answering the substantive
   questions. Do NOT use the recorder name, transcription starter, meeting
   organizer, or a speaker who asks consent/background questions. If the
   interviewee cannot be identified with confidence, return null and explain why
   in extractionWarnings.
2. Interview date
3. Interviewee role
4. Interviewer names — people asking questions, giving the legal/context
   introduction, or managing the interview.
5. Extraction warnings — only for uncertainty, unreliable speaker labels,
   ambiguous interviewee identity, missing answer attribution, or poor source
   quality.
6. People mentioned
7. Key events
8. Notable quotes
9. Short summary
10. Suggested case type — the single category that best fits what this
   transcript describes, chosen from: "${CASE_TYPE_LIST}". This is only a
   suggestion to help the investigator triage; if the transcript does not
   clearly point to one of these categories, return null. Do not guess.

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

Return ONLY valid JSON.

Expected schema:

{
  "intervieweeName": string | null,
  "interviewDate": string | null,
  "role": string | null,
  "interviewerNames": string[],
  "extractionWarnings": string[],
  "summary": string,
  "peopleMentioned": string[],
  "keyEvents": { "description": string }[],
  "notableQuotes": string[],
  "suggestedCaseType": "${CASE_TYPE_LIST}" | null
}

Transcript:
"""
{{TRANSCRIPT}}
"""`;

const VERIFICATION_PROMPT = `You are performing the final verification pass for a workplace investigation extraction.

You will receive JSON extraction drafts from separate document sections. Consolidate them into one final result:

- Deduplicate people, events, and quotes.
- Keep only information explicitly present in the drafts.
- Prefer the most specific non-null metadata values.
- Reject interviewee names that are only supported by transcription-started,
  recorder, meeting-owner, or interviewer-question evidence.
- Preserve extractionWarnings when drafts show unreliable speaker attribution or
  conflicting interviewee evidence.
- Produce a concise summary of the whole document.
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
  "peopleMentioned": string[],
  "keyEvents": { "description": string }[],
  "notableQuotes": string[],
  "suggestedCaseType": "${CASE_TYPE_LIST}" | null
}

Section drafts:
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
  chunk: ExtractionChunk
): Promise<ExtractionResponse> {
  return requestExtraction(
    USER_PROMPT.replace(
      "{{TRANSCRIPT}}",
      `[${chunk.label}]\n\n${chunk.text}`
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

  return extractionResponseSchema.parse(parsed);
}
