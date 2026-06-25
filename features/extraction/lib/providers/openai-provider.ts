import "server-only";

import OpenAI from "openai";
import { env } from "@/lib/env";
import type { ExtractionProvider } from "./types";

let client: OpenAI | null = null;

function getClient() {
  if (!client) client = new OpenAI({ apiKey: env.openaiApiKey });
  return client;
}

/**
 * OpenAI extraction backend — the original implementation, unchanged in
 * behavior. JSON-object response format guarantees the content parses, and a
 * `length` finish reason flags a truncated response so the pipeline can fall
 * back to smaller units.
 */
export const openaiProvider: ExtractionProvider = {
  name: "openai",
  async complete({ system, user }) {
    const completion = await getClient().chat.completions.create({
      model: env.openaiModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const choice = completion.choices[0];
    return {
      content: choice?.message?.content ?? "",
      truncated: choice?.finish_reason === "length",
    };
  },
};
