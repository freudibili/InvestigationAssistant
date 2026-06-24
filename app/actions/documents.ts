"use server";

import { revalidatePath } from "next/cache";
import { extractDocumentText } from "@/lib/extract-text";
import { createExtractionChunks } from "@/lib/extraction-chunks";
import { isSupportedDocument, SUPPORTED_LABEL } from "@/lib/documents";
import {
  extractInterviewChunk,
  verifyInterviewExtraction,
} from "@/lib/openai";
import { suggestCaseType } from "@/lib/db/cases";
import {
  createDocumentFromUpload,
  cancelDocumentExtraction,
  deleteDocument,
  getDocument,
  getDocumentExtractionRunState,
  saveExtractionResult,
  setExtractionProgress,
  setDocumentStatus,
  startDocumentExtraction,
} from "@/lib/db/documents";
import type { CaseDocument } from "@/lib/types";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

class ExtractionCanceledError extends Error {
  constructor(message = "Extraction canceled.") {
    super(message);
    this.name = "ExtractionCanceledError";
  }
}

/**
 * Upload a single document (PDF, TXT, DOC, or DOCX) to a case. Its text is
 * extracted immediately and stored in `rawText`; AI extraction is deliberately
 * NOT run here.
 */
export async function uploadDocumentAction(
  formData: FormData
): Promise<CaseDocument> {
  const caseId = formData.get("caseId");
  const file = formData.get("file");

  if (typeof caseId !== "string" || !caseId) {
    throw new Error("Missing case id.");
  }
  if (!(file instanceof File)) {
    throw new Error("No file provided.");
  }
  if (!isSupportedDocument(file.name)) {
    throw new Error(`Unsupported file type. Allowed: ${SUPPORTED_LABEL}.`);
  }
  if (file.size === 0) {
    throw new Error("The uploaded file is empty.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("File is too large (max 20 MB).");
  }

  const bytes = await file.arrayBuffer();

  let rawText = "";
  try {
    rawText = await extractDocumentText(file.name, bytes);
  } catch {
    throw new Error("Could not read text from this document.");
  }

  const document = await createDocumentFromUpload({
    caseId,
    fileName: file.name,
    fileBytes: bytes,
    rawText,
  });

  revalidatePath(`/cases/${caseId}`);
  return document;
}

/**
 * Permanently delete a document and its stored file. Triggered by the
 * investigator from the document list.
 */
export async function deleteDocumentAction(documentId: string): Promise<void> {
  const { caseId } = await deleteDocument(documentId);
  revalidatePath(`/cases/${caseId}`);
}

export async function cancelExtractionAction(
  documentId: string
): Promise<CaseDocument> {
  const document = await cancelDocumentExtraction(documentId);
  revalidatePath(`/cases/${document.caseId}`);
  revalidatePath(`/cases/${document.caseId}/documents/${documentId}`);
  return document;
}

/**
 * Run AI extraction for a document. Triggered manually by the investigator.
 * On any failure the document is marked `failed` and the error is surfaced.
 */
export async function extractDocumentAction(
  documentId: string
): Promise<CaseDocument> {
  const document = await getDocument(documentId);
  if (!document) throw new Error("Document not found.");

  if (!document.rawText || document.rawText.trim().length === 0) {
    await setDocumentStatus(documentId, "failed");
    revalidatePath(`/cases/${document.caseId}`);
    throw new Error("This document has no extracted text to analyze.");
  }

  const runId = crypto.randomUUID();
  await startDocumentExtraction(documentId, runId);
  revalidatePath(`/cases/${document.caseId}`);

  try {
    const chunks = createExtractionChunks(document.rawText);
    const totalSteps = chunks.length + 1;
    const drafts = [];

    await setExtractionProgress({
      id: documentId,
      runId,
      currentStep: 0,
      totalSteps,
      step: `Prepared ${chunks.length} page${chunks.length === 1 ? "" : "s"}`,
    });
    await assertExtractionIsActive(documentId, runId);

    for (const [index, chunk] of chunks.entries()) {
      await setExtractionProgress({
        id: documentId,
        runId,
        currentStep: index,
        totalSteps,
        step: `Extracting ${chunk.label}`,
      });
      await assertExtractionIsActive(documentId, runId);
      drafts.push(await extractInterviewChunk(chunk, document.fileName));
      await setExtractionProgress({
        id: documentId,
        runId,
        currentStep: index + 1,
        totalSteps,
        step: `Finished ${chunk.label}`,
      });
      await assertExtractionIsActive(documentId, runId);
    }

    await setExtractionProgress({
      id: documentId,
      runId,
      currentStep: chunks.length,
      totalSteps,
      step: "Verifying final extraction",
    });
    await assertExtractionIsActive(documentId, runId);

    const { suggestedCaseType, ...extracted } =
      await verifyInterviewExtraction(drafts);
    await assertExtractionIsActive(documentId, runId);

    const updated = await saveExtractionResult(documentId, runId, extracted, {
      currentStep: totalSteps,
      totalSteps,
      step: "Verified extraction",
    });

    // Apply the AI's suggested type, but only if the case is still
    // unclassified — `suggestCaseType` is a no-op once a type exists.
    if (suggestedCaseType) {
      await suggestCaseType(document.caseId, suggestedCaseType);
    }

    revalidatePath(`/cases/${document.caseId}`);
    revalidatePath(`/cases/${document.caseId}/documents/${documentId}`);
    return updated;
  } catch (error) {
    if (error instanceof ExtractionCanceledError) {
      revalidatePath(`/cases/${document.caseId}`);
      revalidatePath(`/cases/${document.caseId}/documents/${documentId}`);
      throw error;
    }

    const state = await getDocumentExtractionRunState(documentId);
    if (state.status === "canceled" || state.extractionRunId !== runId) {
      revalidatePath(`/cases/${document.caseId}`);
      revalidatePath(`/cases/${document.caseId}/documents/${documentId}`);
      throw new ExtractionCanceledError();
    }

    await setDocumentStatus(documentId, "failed");
    revalidatePath(`/cases/${document.caseId}`);
    const message =
      error instanceof Error ? error.message : "Extraction failed.";
    throw new Error(message);
  }
}

async function assertExtractionIsActive(
  documentId: string,
  runId: string
): Promise<void> {
  const state = await getDocumentExtractionRunState(documentId);

  if (state.status === "canceled") {
    throw new ExtractionCanceledError();
  }

  if (state.status !== "extracting" || state.extractionRunId !== runId) {
    throw new ExtractionCanceledError("Extraction was superseded.");
  }
}
