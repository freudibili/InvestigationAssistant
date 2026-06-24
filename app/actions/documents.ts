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
  getDocument,
  saveExtractionResult,
  setExtractionProgress,
  setDocumentStatus,
} from "@/lib/db/documents";
import type { CaseDocument } from "@/lib/types";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

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

  await setDocumentStatus(documentId, "extracting");
  revalidatePath(`/cases/${document.caseId}`);

  try {
    const chunks = createExtractionChunks(document.rawText);
    const totalSteps = chunks.length + 1;
    const drafts = [];

    await setExtractionProgress({
      id: documentId,
      currentStep: 0,
      totalSteps,
      step: `Prepared ${chunks.length} section${chunks.length === 1 ? "" : "s"}`,
    });

    for (const [index, chunk] of chunks.entries()) {
      await setExtractionProgress({
        id: documentId,
        currentStep: index,
        totalSteps,
        step: `Extracting ${chunk.label}`,
      });
      drafts.push(await extractInterviewChunk(chunk));
      await setExtractionProgress({
        id: documentId,
        currentStep: index + 1,
        totalSteps,
        step: `Finished ${chunk.label}`,
      });
    }

    await setExtractionProgress({
      id: documentId,
      currentStep: chunks.length,
      totalSteps,
      step: "Verifying final extraction",
    });

    const { suggestedCaseType, ...extracted } =
      await verifyInterviewExtraction(drafts);
    const updated = await saveExtractionResult(documentId, extracted, {
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
    await setDocumentStatus(documentId, "failed");
    revalidatePath(`/cases/${document.caseId}`);
    const message =
      error instanceof Error ? error.message : "Extraction failed.";
    throw new Error(message);
  }
}
