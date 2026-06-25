import "server-only";

export type ExtractionProviderName = "openai" | "anthropic";

/**
 * The raw model output for one extraction call, before any JSON parsing or Zod
 * validation. Parsing, validation, normalization, and recoverable-error
 * classification all live in the shared pipeline (`pipeline.ts`) so every
 * provider is compared on identical downstream handling — an apples-to-apples
 * test of model quality, not of glue code.
 */
export interface ExtractionCompletion {
  /** Model text, expected to be a single JSON object matching the schema. */
  content: string;
  /**
   * True when the model stopped because it hit its output-token ceiling, so the
   * JSON is almost certainly cut off mid-structure. The pipeline turns this into
   * a recoverable error that triggers the per-page / smaller-batch fallback.
   */
  truncated: boolean;
}

/**
 * A swappable extraction backend. The only provider-specific concern is "send a
 * system + user prompt, return JSON text and whether it was truncated"; the
 * prompts, chunking, consolidation, and validation are provider-agnostic.
 */
export interface ExtractionProvider {
  readonly name: ExtractionProviderName;
  complete(params: { system: string; user: string }): Promise<ExtractionCompletion>;
}
