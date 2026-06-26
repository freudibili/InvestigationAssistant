import type { Database } from "@/lib/supabase/database.types";
import type { Case, CaseDocument } from "@/lib/types";

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
  return {
    id: row.id,
    caseId: row.case_id,
    fileName: row.file_name,
    fileUrl: row.file_url,
    status: row.status,
    intervieweeRole: row.interviewee_role,
    rawText: row.raw_text,
    extractedData: row.extracted_data,
    extractionCurrentStep: row.extraction_current_step,
    extractionTotalSteps: row.extraction_total_steps,
    extractionStep: row.extraction_step,
    hasResumableDrafts:
      Array.isArray(row.extraction_drafts) && row.extraction_drafts.length > 0,
    createdAt: row.created_at,
    extractedAt: row.extracted_at,
  };
}
