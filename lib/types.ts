import type { z } from "zod";
import type { extractedDataSchema } from "@/lib/validation";

export const CASE_TYPES = [
  "mobbing",
  "harassment",
  "discrimination",
  "racism",
  "retaliation",
] as const;

export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  mobbing: "Mobbing",
  harassment: "Harassment",
  discrimination: "Discrimination",
  racism: "Racism",
  retaliation: "Retaliation",
};

export const DOCUMENT_STATUSES = [
  "uploaded",
  "extracting",
  "extracted",
  "failed",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Structured data returned by the AI extraction step. */
export type ExtractedData = z.infer<typeof extractedDataSchema>;

export interface Case {
  id: string;
  title: string;
  companyName: string;
  caseType: CaseType;
  createdAt: string;
}

export interface CaseDocument {
  id: string;
  caseId: string;
  fileName: string;
  fileUrl: string;
  status: DocumentStatus;
  rawText: string | null;
  extractedData: ExtractedData | null;
  createdAt: string;
  extractedAt: string | null;
}
