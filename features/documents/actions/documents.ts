"use server";

import { revalidatePath } from "next/cache";
import { extractDocumentText } from "@/lib/extract-text";
import { isSupportedDocument, SUPPORTED_LABEL } from "@/lib/documents";
import {
  createDocumentFromUpload,
  deleteDocument,
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
 * Permanently delete a document and its stored file. Triggered by the
 * investigator from the Documents tab.
 */
export async function deleteDocumentAction(documentId: string): Promise<void> {
  const { caseId } = await deleteDocument(documentId);
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/extraction`);
}
