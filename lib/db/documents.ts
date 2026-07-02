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
  ContentVersion,
  DocumentStatus,
  ExtractedData,
  ExtractionDraftGroup,
  IntervieweeRole,
} from "@/lib/types";
import { extractedDataSchema } from "@/lib/validation";

export async function listDocumentsForCase(
  caseId: string,
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

export async function listDocumentSummariesForCase(
  caseId: string,
): Promise<CaseDocument[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, case_id, file_name, file_url, original_file_url, corrected_file_url, ai_file_url, approved_file_url, status, interviewee_role, extraction_review_status, extraction_edited_at, extraction_approved_at, extraction_revision, corrected_source_revision, extraction_current_step, extraction_total_steps, extraction_step, created_at, extracted_at",
    )
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return data.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    fileName: row.file_name,
    fileUrl: row.file_url,
    originalFileUrl: row.original_file_url,
    correctedFileUrl: row.corrected_file_url,
    aiFileUrl: row.ai_file_url,
    approvedFileUrl: row.approved_file_url,
    status: row.status,
    intervieweeRole: row.interviewee_role,
    rawText: null,
    originalRawText: null,
    correctedRawText: null,
    correctedSourceRevision: row.corrected_source_revision,
    aiRawText: null,
    approvedRawText: null,
    extractedData: null,
    aiExtractedData: null,
    investigatorExtractedData: null,
    approvedExtractedData: null,
    extractionReviewStatus: row.extraction_review_status,
    extractionEditedAt: row.extraction_edited_at,
    extractionApprovedAt: row.extraction_approved_at,
    extractionRevision: row.extraction_revision,
    extractionCurrentStep: row.extraction_current_step,
    extractionTotalSteps: row.extraction_total_steps,
    extractionStep: row.extraction_step,
    hasResumableDrafts: false,
    createdAt: row.created_at,
    extractedAt: row.extracted_at,
  }));
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
  intervieweeRole: IntervieweeRole | null;
}): Promise<CaseDocument> {
  const supabase = getSupabaseAdmin();
  const ext = getSupportedExtension(params.fileName) ?? ".pdf";
  const originalObjectPath = `${params.caseId}/original/${crypto.randomUUID()}${ext}`;

  const { error: originalUploadError } = await supabase.storage
    .from(env.storageBucket)
    .upload(originalObjectPath, params.fileBytes, {
      contentType: CONTENT_TYPE_BY_EXTENSION[ext],
      upsert: false,
    });

  if (originalUploadError) throw new Error(originalUploadError.message);

  const { data, error } = await supabase
    .from("documents")
    .insert({
      case_id: params.caseId,
      file_name: params.fileName,
      file_url: originalObjectPath,
      original_file_url: originalObjectPath,
      corrected_file_url: originalObjectPath,
      ai_file_url: ext === ".pdf" ? originalObjectPath : null,
      status: "uploaded",
      interviewee_role: params.intervieweeRole,
      raw_text: params.rawText,
      original_raw_text: params.rawText,
      corrected_raw_text: params.rawText,
      ai_raw_text: ext === ".pdf" ? params.rawText : null,
    })
    .select("*")
    .single();

  if (error) {
    // Best-effort cleanup so we don't leave an orphaned object behind.
    await supabase.storage.from(env.storageBucket).remove([originalObjectPath]);
    throw new Error(error.message);
  }

  return mapDocument(data);
}

/**
 * Replace a document's stored source with a converted PDF. Used when a non-PDF
 * upload is turned into a paginated PDF at extraction time: the new PDF is
 * uploaded and the row points at it with page-markered `raw_text`.
 */
export async function replaceDocumentWithPdf(params: {
  id: string;
  runId: string;
  caseId: string;
  pdfBytes: Uint8Array;
  rawText: string;
}): Promise<string> {
  const supabase = getSupabaseAdmin();
  const objectPath = `${params.caseId}/corrected/${crypto.randomUUID()}.pdf`;

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
    .update({
      file_url: objectPath,
      corrected_file_url: objectPath,
      ai_file_url: objectPath,
      raw_text: params.rawText,
      corrected_raw_text: params.rawText,
      ai_raw_text: params.rawText,
    })
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

  return objectPath;
}

/**
 * Update the investigator-assigned party role for a document. Called from the
 * document row when the role is set or corrected before extraction.
 */
export async function setIntervieweeRole(
  id: string,
  intervieweeRole: IntervieweeRole,
): Promise<CaseDocument> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("documents")
    .update({ interviewee_role: intervieweeRole })
    .eq("id", id)
    .not("status", "in", "(extracting,extracted)")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return mapDocument(data);

  const current = await getDocument(id);
  if (!current) throw new Error("Document not found.");
  if (current.status === "extracting") {
    throw new Error("Cannot change the role while extraction is running.");
  }
  if (current.status === "extracted") {
    throw new Error(
      "Cannot change the role after extraction. Re-upload or re-extract from a corrected pre-extraction state.",
    );
  }
  throw new Error("Could not update the interviewee role.");
}

export async function setDocumentStatus(
  id: string,
  status: DocumentStatus,
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
  runId: string,
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
  id: string,
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
  id: string,
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
  id: string,
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
  drafts: ExtractionDraftGroup[],
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
  },
): Promise<CaseDocument> {
  const supabase = getSupabaseAdmin();
  const current = await getDocument(id);
  if (!current) throw new Error("Document not found.");
  const hasProtectedInvestigatorContent = Boolean(
    current.investigatorExtractedData || current.approvedExtractedData,
  );
  const { data, error } = await supabase
    .from("documents")
    .update({
      status: "extracted",
      extracted_data: extractedData,
      ai_extracted_data: extractedData,
      ai_file_url: current.fileUrl,
      ai_raw_text: current.rawText,
      extraction_review_status: hasProtectedInvestigatorContent
        ? "needs_review"
        : "ai_generated",
      extraction_current_step: progress.currentStep,
      extraction_total_steps: progress.totalSteps,
      extraction_step: progress.step,
      extraction_run_id: runId,
      extraction_revision: current.extractionRevision + 1,
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

export async function saveInvestigatorExtraction(params: {
  documentId: string;
  extractedData: ExtractedData;
  intervieweeRole: IntervieweeRole;
  sourceVersion: ContentVersion;
  reason?: string;
  expectedRevision: number;
  correctedSource?: {
    rawText: string;
    fileUrl?: string;
    pdfBytes?: Uint8Array;
  };
}): Promise<CaseDocument> {
  const extractedData = extractedDataSchema.parse(params.extractedData);
  const supabase = getSupabaseAdmin();
  const uploadedFileUrl = params.correctedSource?.pdfBytes
    ? `${params.documentId}/${crypto.randomUUID()}.pdf`
    : null;
  const correctedFileUrl =
    uploadedFileUrl ?? params.correctedSource?.fileUrl ?? null;
  if (uploadedFileUrl && params.correctedSource?.pdfBytes) {
    const { error } = await supabase.storage
      .from(env.storageBucket)
      .upload(uploadedFileUrl, params.correctedSource.pdfBytes, {
        contentType: CONTENT_TYPE_BY_EXTENSION[".pdf"],
        upsert: false,
      });
    if (error) throw new Error(error.message);
  }
  const { data, error } = await supabase.rpc("apply_extraction_review", {
    p_document_id: params.documentId,
    p_decision: "edit",
    p_source_version: params.sourceVersion,
    p_edited_data: extractedData,
    p_interviewee_role: params.intervieweeRole,
    p_reason: params.reason ?? null,
    p_corrected_file_url: correctedFileUrl,
    p_corrected_raw_text: params.correctedSource?.rawText ?? null,
    p_expected_revision: params.expectedRevision,
  });

  if (error) {
    if (uploadedFileUrl) {
      await supabase.storage.from(env.storageBucket).remove([uploadedFileUrl]);
    }
    throw new Error(error.message);
  }
  const document = data[0];
  if (!document) {
    if (uploadedFileUrl) {
      await supabase.storage.from(env.storageBucket).remove([uploadedFileUrl]);
    }
    throw new Error("Document not found.");
  }
  return mapDocument(document);
}

export async function reviewExtraction(params: {
  documentId: string;
  decision: "approve" | "exclude";
  sourceVersion: ContentVersion;
  reason?: string;
  expectedRevision: number;
}): Promise<CaseDocument> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("apply_extraction_review", {
    p_document_id: params.documentId,
    p_decision: params.decision,
    p_source_version: params.sourceVersion,
    p_edited_data: null,
    p_interviewee_role: null,
    p_reason: params.reason ?? null,
    p_corrected_file_url: null,
    p_corrected_raw_text: null,
    p_expected_revision: params.expectedRevision,
  });

  if (error) throw new Error(error.message);
  const document = data[0];
  if (!document) throw new Error("Document not found.");
  return mapDocument(document);
}

/**
 * Permanently delete a document: remove its stored file (best-effort) and its
 * database row. Returns the case id so callers can revalidate the case view.
 */
export async function deleteDocument(id: string): Promise<{ caseId: string }> {
  const supabase = getSupabaseAdmin();

  const { data, error: fetchError } = await supabase
    .from("documents")
    .select(
      "case_id, file_url, original_file_url, corrected_file_url, ai_file_url, approved_file_url",
    )
    .eq("id", id)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!data) throw new Error("Document not found.");

  const { data: auditEntries, error: auditError } = await supabase
    .from("investigator_change_audit")
    .select(
      "original_source_file_url, edited_source_file_url, approved_source_file_url",
    )
    .eq("document_id", id);

  if (auditError) throw new Error(auditError.message);

  const objectPaths = Array.from(
    new Set(
      [
        data.file_url,
        data.original_file_url,
        data.corrected_file_url,
        data.ai_file_url,
        data.approved_file_url,
        ...auditEntries.flatMap((entry) => [
          entry.original_source_file_url,
          entry.edited_source_file_url,
          entry.approved_source_file_url,
        ]),
      ].filter((path): path is string => Boolean(path)),
    ),
  );
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw new Error(error.message);

  if (objectPaths.length > 0) {
    await supabase.storage.from(env.storageBucket).remove(objectPaths);
  }

  return { caseId: data.case_id };
}

/** Create a short-lived signed URL so the original document can be viewed. */
export async function createSignedUrl(
  objectPath: string,
  expiresInSeconds = 60 * 10,
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(env.storageBucket)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error) return null;
  return data.signedUrl;
}

export type DocumentSourceVersion = ContentVersion | "original";

export function getDocumentSourceUrl(
  document: CaseDocument,
  version?: DocumentSourceVersion,
): string {
  if (version === "original") return document.originalFileUrl;
  if (version === "ai") return document.aiFileUrl ?? document.correctedFileUrl;
  if (version === "edited") return document.correctedFileUrl;
  return document.approvedFileUrl ?? document.correctedFileUrl;
}

export function getDocumentExtractionVersion(
  document: CaseDocument,
  version?: ContentVersion,
): ExtractedData | null {
  if (version === "ai") return document.aiExtractedData;
  if (version === "edited") return document.investigatorExtractedData;
  if (version === "approved") return document.approvedExtractedData;
  return document.approvedExtractedData ?? document.extractedData;
}
