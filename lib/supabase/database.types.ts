import type {
  AnalysisStatus,
  CaseType,
  CaseTypeSource,
  DocumentStatus,
  ExtractedData,
  ExtractionDraftGroup,
  ExtractionReviewStatus,
  IntervieweeRole,
} from "@/lib/types";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Hand-maintained typing for the Supabase schema. When the project grows you
 * can replace this with `supabase gen types typescript` output.
 */
export type Database = {
  public: {
    Tables: {
      cases: {
        Row: {
          id: string;
          title: string;
          company_name: string;
          case_type: CaseType | null;
          case_type_source: CaseTypeSource | null;
          investigation_analysis: Json | null;
          investigation_analysis_status: AnalysisStatus | null;
          investigation_analysis_run_id: string | null;
          investigation_analysis_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          company_name: string;
          case_type?: CaseType | null;
          case_type_source?: CaseTypeSource | null;
          investigation_analysis?: Json | null;
          investigation_analysis_status?: AnalysisStatus | null;
          investigation_analysis_run_id?: string | null;
          investigation_analysis_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["cases"]["Insert"]>;
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          case_id: string;
          file_name: string;
          file_url: string;
          original_file_url: string;
          corrected_file_url: string;
          ai_file_url: string | null;
          approved_file_url: string | null;
          status: DocumentStatus;
          interviewee_role: IntervieweeRole | null;
          raw_text: string | null;
          original_raw_text: string | null;
          corrected_raw_text: string | null;
          corrected_source_revision: number;
          ai_raw_text: string | null;
          approved_raw_text: string | null;
          extracted_data: ExtractedData | null;
          ai_extracted_data: ExtractedData | null;
          investigator_extracted_data: ExtractedData | null;
          approved_extracted_data: ExtractedData | null;
          extraction_review_status: ExtractionReviewStatus;
          extraction_edited_at: string | null;
          extraction_approved_at: string | null;
          extraction_revision: number;
          extraction_current_step: number;
          extraction_total_steps: number;
          extraction_step: string | null;
          extraction_run_id: string | null;
          extraction_drafts: ExtractionDraftGroup[] | null;
          created_at: string;
          extracted_at: string | null;
        };
        Insert: {
          id?: string;
          case_id: string;
          file_name: string;
          file_url: string;
          original_file_url: string;
          corrected_file_url: string;
          ai_file_url?: string | null;
          approved_file_url?: string | null;
          status?: DocumentStatus;
          interviewee_role?: IntervieweeRole | null;
          raw_text?: string | null;
          original_raw_text?: string | null;
          corrected_raw_text?: string | null;
          corrected_source_revision?: number;
          ai_raw_text?: string | null;
          approved_raw_text?: string | null;
          extracted_data?: ExtractedData | null;
          ai_extracted_data?: ExtractedData | null;
          investigator_extracted_data?: ExtractedData | null;
          approved_extracted_data?: ExtractedData | null;
          extraction_review_status?: ExtractionReviewStatus;
          extraction_edited_at?: string | null;
          extraction_approved_at?: string | null;
          extraction_revision?: number;
          extraction_current_step?: number;
          extraction_total_steps?: number;
          extraction_step?: string | null;
          extraction_run_id?: string | null;
          extraction_drafts?: ExtractionDraftGroup[] | null;
          created_at?: string;
          extracted_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["documents"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "documents_case_id_fkey";
            columns: ["case_id"];
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
        ];
      };
      investigator_change_audit: {
        Row: {
          id: string;
          case_id: string;
          document_id: string | null;
          subject_type: "extraction" | "analysis";
          subject_id: string;
          action: "edit" | "approve" | "reject" | "exclude" | "merge";
          original_ai_value: Json | null;
          edited_value: Json | null;
          approved_value: Json | null;
          original_source_file_url: string | null;
          edited_source_file_url: string | null;
          approved_source_file_url: string | null;
          modification_reason: string | null;
          affects_downstream_analysis: boolean;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["investigator_change_audit"]["Row"],
          "id" | "created_at"
        > & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["investigator_change_audit"]["Insert"]
        >;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      apply_extraction_review: {
        Args: {
          p_document_id: string;
          p_decision: string;
          p_source_version: string;
          p_edited_data: Json | null;
          p_interviewee_role: string | null;
          p_reason: string | null;
          p_corrected_file_url: string | null;
          p_corrected_raw_text: string | null;
          p_expected_revision: number;
        };
        Returns: Database["public"]["Tables"]["documents"]["Row"][];
      };
    };
    Enums: {
      case_type: CaseType;
      case_type_source: CaseTypeSource;
      document_status: DocumentStatus;
      interviewee_role: IntervieweeRole;
    };
    CompositeTypes: Record<never, never>;
  };
};
