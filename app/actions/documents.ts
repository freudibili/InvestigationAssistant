"use server";

import { revalidatePath } from "next/cache";
import { extractPdfText } from "@/lib/pdf";
import { extractInterviewData } from "@/lib/openai";
import {
  createDocumentFromUpload,
  getDocument,
  saveExtractionResult,
  setDocumentStatus,
} from "@/lib/db/documents";
import type { CaseDocument } from "@/lib/types";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Upload a single PDF to a case. The PDF text is extracted immediately and
 * stored in `rawText`; AI extraction is deliberately NOT run here.
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
  if (file.type !== "application/pdf") {
    throw new Error("Only PDF files are supported.");
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
    rawText = await extractPdfText(bytes);
  } catch {
    throw new Error("Could not read text from this PDF.");
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
    const extracted = await extractInterviewData(document.rawText);
    const updated = await saveExtractionResult(documentId, extracted);
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
