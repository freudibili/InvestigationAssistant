"use server";

import { revalidatePath } from "next/cache";
import { extractDocumentText } from "@/lib/extract-text";
import { isSupportedDocument, SUPPORTED_LABEL } from "@/lib/documents";
import {
  createDocumentFromUpload,
  deleteDocument,
  setIntervieweeRole,
} from "@/lib/db/documents";
import { INTERVIEWEE_ROLES, type CaseDocument, type IntervieweeRole } from "@/lib/types";

/** Narrow an untrusted form value to a valid interviewee role, or null. */
function parseIntervieweeRole(value: FormDataEntryValue | null): IntervieweeRole | null {
  return INTERVIEWEE_ROLES.includes(value as IntervieweeRole)
    ? (value as IntervieweeRole)
    : null;
}

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
  const intervieweeRole = parseIntervieweeRole(formData.get("intervieweeRole"));

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
    intervieweeRole,
  });

  revalidatePath(`/cases/${caseId}`);
  return document;
}

/**
 * Set or correct a document's interviewee party role (claimant / accused /
 * witness). Allowed any time before extraction so the investigator can fix a
 * role chosen at upload, or tag a document uploaded before roles existed.
 */
export async function setIntervieweeRoleAction(
  documentId: string,
  intervieweeRole: IntervieweeRole
): Promise<CaseDocument> {
  if (!INTERVIEWEE_ROLES.includes(intervieweeRole)) {
    throw new Error("Invalid interviewee role.");
  }

  const document = await setIntervieweeRole(documentId, intervieweeRole);
  revalidatePath(`/cases/${document.caseId}`);
  revalidatePath(`/cases/${document.caseId}/extraction`);
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
