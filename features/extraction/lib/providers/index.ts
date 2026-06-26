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

/**
 * Resolve the backend for the cross-interview Investigation Analysis from
 * `ANALYSIS_PROVIDER`. The provider contract ("send a system + user prompt,
 * return JSON text and whether it was truncated") is the same as extraction, so
 * the two flows share the same provider implementations — only the default
 * differs: analysis defaults to Anthropic, extraction to OpenAI.
 */
export function getAnalysisProvider(): ExtractionProvider {
  return env.analysisProvider === "openai" ? openaiProvider : anthropicProvider;
}

export type {
  ExtractionProvider,
  ExtractionCompletion,
  ExtractionProviderName,
} from "./types";
