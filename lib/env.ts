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
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "case-documents",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
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
