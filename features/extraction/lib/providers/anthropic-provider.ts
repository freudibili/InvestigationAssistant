import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import type { ExtractionProvider } from "./types";

let client: Anthropic | null = null;

function getClient() {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

/**
 * Anthropic (Claude Sonnet 4.6) extraction backend.
 *
 * Optional adaptive thinking can be enabled for extraction-reasoning quality,
 * but it is off by default because it increases latency and cost. We stream and
 * read the final message because the extraction schema is large; a non-streaming
 * call at this `max_tokens` risks an HTTP timeout.
 *
 * Unlike OpenAI's `json_object` mode, Claude has no hard JSON-only switch here,
 * so we lean on the strict "Return ONLY valid JSON" system prompt plus the
 * shared Zod layer, and strip a markdown code fence if the model adds one — that
 * keeps the downstream `JSON.parse` byte-identical to the OpenAI path.
 */
export const anthropicProvider: ExtractionProvider = {
  name: "anthropic",
  async complete({ system, user }) {
    const stream = getClient().messages.stream({
      model: env.anthropicModel,
      max_tokens: env.anthropicMaxTokens,
      ...(env.anthropicThinkingEnabled
        ? { thinking: { type: "adaptive" as const } }
        : {}),
      system,
      messages: [{ role: "user", content: user }],
    });

    const message = await stream.finalMessage();

    const content = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      content: stripJsonFence(content),
      // `max_tokens` is Claude's equivalent of OpenAI's `length` finish reason:
      // the model ran out of output budget and the JSON is likely cut off.
      truncated: message.stop_reason === "max_tokens",
    };
  },
};

/**
 * Unwrap a fenced ```json … ``` block if the model wrapped its JSON in one.
 * No-op for already-bare JSON, so the OpenAI path (which never fences) is
 * unaffected and both providers feed the same shared parser.
 */
function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}
