import "server-only";

import OpenAI from "openai";
import { env } from "@/lib/env";
import { extractedDataSchema } from "@/lib/validation";
import type { ExtractedData } from "@/lib/types";

let client: OpenAI | null = null;

function getClient() {
  if (!client) client = new OpenAI({ apiKey: env.openaiApiKey });
  return client;
}

const SYSTEM_PROMPT = `You are an assistant that helps workplace investigators organize interview transcripts.
You only extract and organize information that is explicitly present in the transcript.
You never infer guilt, never draw legal conclusions, and never invent facts.
If a field is not present in the transcript, return null (for metadata) or an empty array (for lists).
Return ONLY valid JSON matching the requested schema — no markdown, no commentary.`;

const USER_PROMPT = `Analyze this workplace investigation interview transcript.

Extract:

1. Interviewee name
2. Interview date
3. Interviewee role
4. People mentioned
5. Key events
6. Notable quotes
7. Short summary

Return ONLY valid JSON.

Expected schema:

{
  "intervieweeName": string | null,
  "interviewDate": string | null,
  "role": string | null,
  "summary": string,
  "peopleMentioned": string[],
  "keyEvents": { "description": string }[],
  "notableQuotes": string[]
}

Transcript:
"""
{{TRANSCRIPT}}
"""`;

/**
 * Send a transcript to the LLM and return validated structured data.
 * Throws if the model returns malformed output or output that fails Zod
 * validation — callers translate that into a `failed` document status.
 */
export async function extractInterviewData(
  transcript: string
): Promise<ExtractedData> {
  const completion = await getClient().chat.completions.create({
    model: env.openaiModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT.replace("{{TRANSCRIPT}}", transcript) },
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

  return extractedDataSchema.parse(parsed);
}
