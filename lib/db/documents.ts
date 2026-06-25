import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapDocument } from "@/lib/db/mappers";
import { env } from "@/lib/env";
import {
  CONTENT_TYPE_BY_EXTENSION,
  getSupportedExtension,
} from "@/lib/documents";
import type {
  CaseDocument,
  DocumentStatus,
  ExtractedData,
  ExtractionDraftGroup,
} from "@/lib/types";

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
 * Upload a document to Storage, extract its text, and create the document
 * record. The text extraction is done eagerly on upload; the AI extraction is
 * not. The stored object keeps the original file's extension and content type.
 */
export async function createDocumentFromUpload(params: {
  caseId: string;
  fileName: string;
  fileBytes: ArrayBuffer;
  rawText: string;
}): Promise<CaseDocument> {
  const supabase = getSupabaseAdmin();
  const ext = getSupportedExtension(params.fileName) ?? ".pdf";
  const objectPath = `${params.caseId}/${crypto.randomUUID()}${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(env.storageBucket)
    .upload(objectPath, params.fileBytes, {
      contentType: CONTENT_TYPE_BY_EXTENSION[ext],
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

/**
 * Replace a document's stored source with a converted PDF. Used when a non-PDF
 * upload is turned into a paginated PDF at extraction time: the new PDF is
 * uploaded, the row points at it with page-markered `raw_text`, and the old
 * object is removed (best-effort). Returns the new storage object path.
 */
export async function replaceDocumentWithPdf(params: {
  id: string;
  runId: string;
  caseId: string;
  oldObjectPath: string;
  pdfBytes: Uint8Array;
  rawText: string;
}): Promise<string> {
  const supabase = getSupabaseAdmin();
  const objectPath = `${params.caseId}/${crypto.randomUUID()}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(env.storageBucket)
    .upload(objectPath, params.pdfBytes, {
      contentType: CONTENT_TYPE_BY_EXTENSION[".pdf"],
      upsert: false,
    });

  if (uploadError) throw new Error(uploadError.message);

  // Guard on the live run, like every other write in the extraction flow: a
  // canceled or superseded run must not overwrite the stored source.
  const { data, error } = await supabase
    .from("documents")
    .update({ file_url: objectPath, raw_text: params.rawText })
    .eq("id", params.id)
    .eq("status", "extracting")
    .eq("extraction_run_id", params.runId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    // Roll back the just-uploaded object so we don't orphan it in storage.
    await supabase.storage.from(env.storageBucket).remove([objectPath]);
    throw new Error(error?.message ?? "Extraction is no longer active.");
  }

  // Best-effort cleanup of the original (non-PDF) object.
  if (params.oldObjectPath && params.oldObjectPath !== objectPath) {
    await supabase.storage
      .from(env.storageBucket)
      .remove([params.oldObjectPath]);
  }

  return objectPath;
}

export async function setDocumentStatus(
  id: string,
  status: DocumentStatus
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("documents")
    .update({
      status,
      ...(status === "extracting"
        ? {
            extraction_current_step: 0,
            extraction_total_steps: 0,
            extraction_step: "Preparing document",
          }
        : {}),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function startDocumentExtraction(
  id: string,
  runId: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("documents")
    .update({
      status: "extracting",
      extraction_current_step: 0,
      extraction_total_steps: 0,
      extraction_step: "Preparing document",
      extraction_run_id: runId,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function cancelDocumentExtraction(
  id: string
): Promise<CaseDocument> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("documents")
    .update({
      status: "canceled",
      extraction_step: "Extraction canceled",
    })
    .eq("id", id)
    .eq("status", "extracting")
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data) return mapDocument(data);

  const current = await getDocument(id);
  if (!current) throw new Error("Document not found.");
  return current;
}

export async function getDocumentExtractionRunState(
  id: string
): Promise<Pick<CaseDocument, "status"> & { extractionRunId: string | null }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("documents")
    .select("status, extraction_run_id")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Document not found.");

  return {
    status: data.status,
    extractionRunId: data.extraction_run_id,
  };
}

/**
 * Load the page drafts persisted by a previous extraction run so a failed or
 * canceled extraction can resume without re-extracting completed chunks.
 * Returns an empty array when nothing was saved (a fresh document).
 */
export async function getDocumentExtractionDrafts(
  id: string
): Promise<ExtractionDraftGroup[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("documents")
    .select("extraction_drafts")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Array.isArray(data?.extraction_drafts) ? data.extraction_drafts : [];
}

/**
 * Persist the page drafts produced so far in the active run. Written after each
 * batch so that if the run later fails or is canceled, the next extraction can
 * pick up from the last saved chunk. Guarded on the live run like every other
 * extraction write, so a canceled or superseded run can't clobber the drafts.
 */
export async function saveExtractionDrafts(
  id: string,
  runId: string,
  drafts: ExtractionDraftGroup[]
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("documents")
    .update({ extraction_drafts: drafts })
    .eq("id", id)
    .eq("status", "extracting")
    .eq("extraction_run_id", runId);

  if (error) throw new Error(error.message);
}

export async function setExtractionProgress(params: {
  id: string;
  runId: string;
  currentStep: number;
  totalSteps: number;
  step: string;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("documents")
    .update({
      extraction_current_step: params.currentStep,
      extraction_total_steps: params.totalSteps,
      extraction_step: params.step,
    })
    .eq("id", params.id)
    .eq("status", "extracting")
    .eq("extraction_run_id", params.runId);

  if (error) throw new Error(error.message);
}

export async function saveExtractionResult(
  id: string,
  runId: string,
  extractedData: ExtractedData,
  progress: {
    currentStep: number;
    totalSteps: number;
    step: string;
  } = {
    currentStep: 1,
    totalSteps: 1,
    step: "Verified extraction",
  }
): Promise<CaseDocument> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("documents")
    .update({
      status: "extracted",
      extracted_data: extractedData,
      extraction_current_step: progress.currentStep,
      extraction_total_steps: progress.totalSteps,
      extraction_step: progress.step,
      extraction_run_id: runId,
      // Drop the resumable drafts: the document is fully extracted, so a future
      // re-extraction should start fresh rather than reuse stale page drafts.
      extraction_drafts: null,
      extracted_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "extracting")
    .eq("extraction_run_id", runId)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Extraction is no longer active.");
  return mapDocument(data);
}

/**
 * Permanently delete a document: remove its stored file (best-effort) and its
 * database row. Returns the case id so callers can revalidate the case view.
 */
export async function deleteDocument(id: string): Promise<{ caseId: string }> {
  const supabase = getSupabaseAdmin();

  const { data, error: fetchError } = await supabase
    .from("documents")
    .select("case_id, file_url")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!data) throw new Error("Document not found.");

  // Best-effort storage cleanup; a missing object shouldn't block deletion.
  if (data.file_url) {
    await supabase.storage.from(env.storageBucket).remove([data.file_url]);
  }

  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw new Error(error.message);

  return { caseId: data.case_id };
}

/** Create a short-lived signed URL so the original document can be viewed. */
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
