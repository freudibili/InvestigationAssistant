import "server-only";

import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Server-only Supabase client using the service-role key.
 *
 * The MVP has no authentication yet, so all database and storage access flows
 * through this single trusted server-side client. It must NEVER be imported
 * into a client component — the `server-only` guard enforces that at build time.
 */
let cached: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabaseAdmin() {
  if (cached) return cached;
  cached = createClient<Database>(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
  return cached;
}
