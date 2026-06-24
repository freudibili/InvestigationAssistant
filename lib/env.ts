/**
 * Centralized, validated access to environment variables.
 * Server-only secrets are read lazily so the client bundle never touches them.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable "${name}". Add it to your .env.local (see .env.example).`
    );
  }
  return value;
}

export const env = {
  supabaseUrl: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL
  ),
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
