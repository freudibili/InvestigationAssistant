import "server-only";

import { env } from "@/lib/env";
import { anthropicProvider } from "./anthropic-provider";
import { openaiProvider } from "./openai-provider";
import type { ExtractionProvider } from "./types";

/**
 * Resolve the active extraction backend from `EXTRACTION_PROVIDER`. Read fresh
 * on every call (not memoized) so a benchmark can flip the env var between runs
 * in one process. Anything other than "anthropic" falls back to OpenAI, which
 * keeps the default behavior unchanged when the var is unset.
 */
export function getExtractionProvider(): ExtractionProvider {
  return env.extractionProvider === "anthropic"
    ? anthropicProvider
    : openaiProvider;
}

export type {
  ExtractionProvider,
  ExtractionCompletion,
  ExtractionProviderName,
} from "./types";
