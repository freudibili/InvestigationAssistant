import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapDocument } from "@/lib/db/mappers";
import { env } from "@/lib/env";
import type { CaseDocument, DocumentStatus, ExtractedData } from "@/lib/types";

export async function listDocumentsForCase(
  caseId: string
): Promise<CaseDocument[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data.map(mapDocument);
}

export async function getDocument(id: string): Promise<CaseDocument | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapDocument(data) : null;
}

/**
 * Upload a PDF to Storage, extract its text, and create the document record.
 * The text extraction is done eagerly on upload; the AI extraction is not.
 */
export async function createDocumentFromUpload(params: {
  caseId: string;
  fileName: string;
  fileBytes: ArrayBuffer;
  rawText: string;
}): Promise<CaseDocument> {
  const supabase = getSupabaseAdmin();
  const objectPath = `${params.caseId}/${crypto.randomUUID()}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(env.storageBucket)
    .upload(objectPath, params.fileBytes, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await supabase
    .from("documents")
    .insert({
      case_id: params.caseId,
      file_name: params.fileName,
      file_url: objectPath,
      status: "uploaded",
      raw_text: params.rawText,
    })
    .select("*")
    .single();

  if (error) {
    // Best-effort cleanup so we don't leave an orphaned object behind.
    await supabase.storage.from(env.storageBucket).remove([objectPath]);
    throw new Error(error.message);
  }

  return mapDocument(data);
}

export async function setDocumentStatus(
  id: string,
  status: DocumentStatus
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("documents")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function saveExtractionResult(
  id: string,
  extractedData: ExtractedData
): Promise<CaseDocument> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("documents")
    .update({
      status: "extracted",
      extracted_data: extractedData,
      extracted_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapDocument(data);
}

/** Create a short-lived signed URL so the original PDF can be viewed. */
export async function createSignedUrl(
  objectPath: string,
  expiresInSeconds = 60 * 10
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(env.storageBucket)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error) return null;
  return data.signedUrl;
}
