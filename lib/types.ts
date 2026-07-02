import type { z } from "zod";
import type {
  extractedDataSchema,
  extractionResponseSchema,
} from "@/lib/validation";

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

/** Where a case's current type came from. Null when the case is unclassified. */
export type CaseTypeSource = "suggested" | "confirmed";

/** Shown when a case has no type yet. */
export const UNCLASSIFIED_LABEL = "Unclassified";

/**
 * The party role the interviewee plays in the investigation. Chosen by the
 * investigator at upload (and editable before extraction) rather than inferred
 * by the model: knowing up front whether a transcript is the claimant, the
 * accused, or a reference person keeps the extractor from guessing — and
 * mis-assigning — who the claimant and accused are (e.g. listing a witness as
 * the accused). Distinct from `ExtractedData.role` (the interviewee's job
 * title) and from `interviewPosition` (whose narrative the testimony supports).
 */
export const INTERVIEWEE_ROLES = ["claimant", "accused", "witness"] as const;

export type IntervieweeRole = (typeof INTERVIEWEE_ROLES)[number];

export const INTERVIEWEE_ROLE_LABELS: Record<IntervieweeRole, string> = {
  claimant: "Claimant",
  accused: "Accused",
  witness: "Reference person",
};

/** Localized (French) sublabel shown alongside the English one for clarity. */
export const INTERVIEWEE_ROLE_SUBLABELS: Record<IntervieweeRole, string> = {
  claimant: "plaignant",
  accused: "personne mise en cause",
  witness: "personne de référence / témoin",
};

export const DOCUMENT_STATUSES = [
  "uploaded",
  "extracting",
  "extracted",
  "canceled",
  "failed",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const ANALYSIS_STATUSES = [
  "idle",
  "analyzing",
  "ready",
  "canceled",
  "failed",
] as const;

/** Lifecycle of a case's cross-interview Investigation Analysis. */
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const EXTRACTION_REVIEW_STATUSES = [
  "ai_generated",
  "edited",
  "needs_review",
  "approved",
  "excluded",
] as const;

export type ExtractionReviewStatus =
  (typeof EXTRACTION_REVIEW_STATUSES)[number];

export const CONTENT_VERSIONS = ["ai", "edited", "approved"] as const;

export type ContentVersion = (typeof CONTENT_VERSIONS)[number];

/** Structured data returned by the AI extraction step. */
export type ExtractedData = z.infer<typeof extractedDataSchema>;

/** The full per-call AI response (extracted data plus a suggested case type). */
export type ExtractionResponse = z.infer<typeof extractionResponseSchema>;

/**
 * The drafts produced from a single extraction chunk, persisted mid-run so a
 * failed or canceled extraction can resume without re-extracting that chunk.
 * `chunkLabel` is the chunk's stable label (e.g. "Pages 1-3"); one chunk yields
 * several drafts when a dense group is retried page-by-page.
 */
export interface ExtractionDraftGroup {
  chunkLabel: string;
  drafts: ExtractionResponse[];
}

export interface Case {
  id: string;
  title: string;
  companyName: string;
  caseType: CaseType | null;
  caseTypeSource: CaseTypeSource | null;
  /** Status of the case's cross-interview analysis. The heavy result JSON is
   * loaded separately (it isn't carried on the lightweight case object). */
  investigationAnalysisStatus: AnalysisStatus;
  investigationAnalysisAt: string | null;
  createdAt: string;
}

export interface CaseDocument {
  id: string;
  caseId: string;
  fileName: string;
  fileUrl: string;
  originalFileUrl: string;
  correctedFileUrl: string;
  aiFileUrl: string | null;
  approvedFileUrl: string | null;
  status: DocumentStatus;
  /**
   * The investigator-assigned party role for this interviewee, or null when not
   * yet chosen. Extraction is blocked until it is set, so the model never has to
   * infer who the claimant and accused are.
   */
  intervieweeRole: IntervieweeRole | null;
  rawText: string | null;
  originalRawText: string | null;
  correctedRawText: string | null;
  correctedSourceRevision: number;
  aiRawText: string | null;
  approvedRawText: string | null;
  extractedData: ExtractedData | null;
  aiExtractedData: ExtractedData | null;
  investigatorExtractedData: ExtractedData | null;
  approvedExtractedData: ExtractedData | null;
  extractionReviewStatus: ExtractionReviewStatus;
  extractionEditedAt: string | null;
  extractionApprovedAt: string | null;
  extractionRevision: number;
  extractionCurrentStep: number;
  extractionTotalSteps: number;
  extractionStep: string | null;
  /**
   * Whether a previous (failed or canceled) run left page drafts that the next
   * extraction can resume from. The drafts themselves stay server-side; only
   * this flag is sent to the client so the UI can offer "Resume" over "Retry".
   */
  hasResumableDrafts: boolean;
  createdAt: string;
  extractedAt: string | null;
}
