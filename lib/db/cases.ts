import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCase } from "@/lib/db/mappers";
import { env } from "@/lib/env";
import type { Case, CaseType } from "@/lib/types";
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
  // A type chosen at creation is a deliberate decision, so mark it confirmed.
  const caseType = input.caseType ?? null;
  const { data, error } = await supabase
    .from("cases")
    .insert({
      title: input.title,
      company_name: input.companyName,
      case_type: caseType,
      case_type_source: caseType ? "confirmed" : null,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapCase(data);
}

export async function deleteCase(caseId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: documents, error: documentsError } = await supabase
    .from("documents")
    .select("file_url")
    .eq("case_id", caseId);

  if (documentsError) throw new Error(documentsError.message);

  const { data, error } = await supabase
    .from("cases")
    .delete()
    .eq("id", caseId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Case not found.");

  const objectPaths = documents.map((document) => document.file_url);
  if (objectPaths.length > 0) {
    await supabase.storage.from(env.storageBucket).remove(objectPaths);
  }
}

/**
 * Record an AI-suggested case type, but only for a case that is still
 * unclassified — never overwrite a type the investigator already set.
 * Returns the (possibly unchanged) case.
 */
export async function suggestCaseType(
  caseId: string,
  caseType: CaseType
): Promise<Case | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cases")
    .update({ case_type: caseType, case_type_source: "suggested" })
    .eq("id", caseId)
    .is("case_type", null)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapCase(data) : null;
}

/**
 * Set the case type explicitly (the investigator confirming a suggestion or
 * overriding it). Passing `null` clears it back to unclassified.
 */
export async function setCaseType(
  caseId: string,
  caseType: CaseType | null
): Promise<Case> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cases")
    .update({
      case_type: caseType,
      case_type_source: caseType ? "confirmed" : null,
    })
    .eq("id", caseId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapCase(data);
}
