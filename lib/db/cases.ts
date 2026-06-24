import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCase } from "@/lib/db/mappers";
import type { Case } from "@/lib/types";
import type { CreateCaseInput } from "@/lib/validation";

export async function listCases(): Promise<Case[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cases")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data.map(mapCase);
}

export async function getCase(id: string): Promise<Case | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cases")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapCase(data) : null;
}

export async function createCase(input: CreateCaseInput): Promise<Case> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cases")
    .insert({
      title: input.title,
      company_name: input.companyName,
      case_type: input.caseType,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapCase(data);
}
