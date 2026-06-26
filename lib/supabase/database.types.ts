import type {
  AnalysisStatus,
  CaseType,
  CaseTypeSource,
  DocumentStatus,
  ExtractedData,
  ExtractionDraftGroup,
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
          status: DocumentStatus;
          interviewee_role: IntervieweeRole | null;
          raw_text: string | null;
          extracted_data: ExtractedData | null;
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
          status?: DocumentStatus;
          interviewee_role?: IntervieweeRole | null;
          raw_text?: string | null;
          extracted_data?: ExtractedData | null;
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
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      case_type: CaseType;
      case_type_source: CaseTypeSource;
      document_status: DocumentStatus;
      interviewee_role: IntervieweeRole;
    };
    CompositeTypes: Record<never, never>;
  };
};
