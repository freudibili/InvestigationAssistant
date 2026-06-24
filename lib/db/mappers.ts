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
    rawText: row.raw_text,
    extractedData: row.extracted_data,
    createdAt: row.created_at,
    extractedAt: row.extracted_at,
  };
}
