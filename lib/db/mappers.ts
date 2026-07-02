import type { Database } from "@/lib/supabase/database.types";
import type { Case, CaseDocument } from "@/lib/types";
import { extractedDataSchema } from "@/lib/validation";

type CaseRow = Database["public"]["Tables"]["cases"]["Row"];
type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];

export function mapCase(row: CaseRow): Case {
  return {
    id: row.id,
    title: row.title,
    companyName: row.company_name,
    caseType: row.case_type,
    caseTypeSource: row.case_type_source,
    investigationAnalysisStatus: row.investigation_analysis_status ?? "idle",
    investigationAnalysisAt: row.investigation_analysis_at,
    createdAt: row.created_at,
  };
}

export function mapDocument(row: DocumentRow): CaseDocument {
  const legacyExtraction = parseExtractedData(row.extracted_data);
  const aiExtraction =
    parseExtractedData(row.ai_extracted_data) ?? legacyExtraction;
  const investigatorExtraction = parseExtractedData(
    row.investigator_extracted_data,
  );
  const approvedExtraction = parseExtractedData(row.approved_extracted_data);

  return {
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
    rawText: row.raw_text,
    originalRawText: row.original_raw_text,
    correctedRawText: row.corrected_raw_text,
    correctedSourceRevision: row.corrected_source_revision,
    aiRawText: row.ai_raw_text,
    approvedRawText: row.approved_raw_text,
    extractedData: investigatorExtraction ?? aiExtraction,
    aiExtractedData: aiExtraction,
    investigatorExtractedData: investigatorExtraction,
    approvedExtractedData: approvedExtraction,
    extractionReviewStatus: row.extraction_review_status,
    extractionEditedAt: row.extraction_edited_at,
    extractionApprovedAt: row.extraction_approved_at,
    extractionRevision: row.extraction_revision,
    extractionCurrentStep: row.extraction_current_step,
    extractionTotalSteps: row.extraction_total_steps,
    extractionStep: row.extraction_step,
    hasResumableDrafts:
      Array.isArray(row.extraction_drafts) && row.extraction_drafts.length > 0,
    createdAt: row.created_at,
    extractedAt: row.extracted_at,
  };
}

function parseExtractedData(value: unknown) {
  if (!value) return null;
  const parsed = extractedDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
