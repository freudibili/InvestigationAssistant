/**
 * Centralized, validated access to environment variables.
 * Server-only secrets are read lazily so the client bundle never touches them.
 */

function looksLikePlaceholder(value: string): boolean {
  return /your_|YOUR_|anon-key|service-role-key|sk-\.\.\./i.test(value);
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable "${name}". Add it to your .env.local (see .env.example).`
    );
  }
  if (looksLikePlaceholder(value)) {
    throw new Error(
      `Environment variable "${name}" still contains a placeholder value. Add the real value to your .env.local (see .env.example).`
    );
  }
  return value;
}

function positiveInteger(name: string, value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Environment variable "${name}" must be a positive integer.`);
  }
  return parsed;
}

function booleanFlag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export const env = {
  get supabaseUrl() {
    return required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL
    );
  },
  get supabaseServiceRoleKey() {
    return required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  },
  get openaiApiKey() {
    return required("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
  },
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);
  },
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "case-documents",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.5",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  // Sonnet 4.6 caps output at 64K; a generous default avoids spurious
  // truncation on dense pages or large consolidation batches.
  anthropicMaxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS ?? 32000),
  get anthropicThinkingEnabled() {
    return booleanFlag(process.env.ANTHROPIC_THINKING_ENABLED);
  },
  get extractionPagesPerChunk() {
    return positiveInteger(
      "EXTRACTION_PAGES_PER_CHUNK",
      process.env.EXTRACTION_PAGES_PER_CHUNK,
      4
    );
  },
  get extractionConsolidationBatchSize() {
    return positiveInteger(
      "EXTRACTION_CONSOLIDATION_BATCH_SIZE",
      process.env.EXTRACTION_CONSOLIDATION_BATCH_SIZE,
      8
    );
  },
  // Read as a getter (not a captured constant) so a benchmark can switch
  // providers mid-process by reassigning process.env.EXTRACTION_PROVIDER.
  get extractionProvider(): "openai" | "anthropic" {
    return process.env.EXTRACTION_PROVIDER === "anthropic"
      ? "anthropic"
      : "openai";
  },
  get analysisProvider(): "openai" | "anthropic" {
    return process.env.ANALYSIS_PROVIDER === "anthropic"
      ? "anthropic"
      : "openai";
  },
};

export function getDatabaseEnvironmentIssues(): string[] {
  const requiredVariables: Array<[string, string | undefined]> = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY],
  ];

  return requiredVariables.flatMap(([name, value]) => {
    try {
      required(name, value);
      return [];
    } catch (error) {
      return [error instanceof Error ? error.message : String(error)];
    }
  });
}
