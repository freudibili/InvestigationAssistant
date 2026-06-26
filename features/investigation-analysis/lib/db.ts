import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  investigationAnalysisSchema,
  type InvestigationAnalysis,
} from "@/features/investigation-analysis/validation";
import type { AnalysisStatus } from "@/lib/types";

export interface AnalysisState {
  status: AnalysisStatus;
  analysisRunId: string | null;
  generatedAt: string | null;
}

export interface CaseAnalysis {
  status: AnalysisStatus;
  generatedAt: string | null;
  /** Validated analysis, or null when none exists or the stored shape is stale. */
  analysis: InvestigationAnalysis | null;
}

/** Lightweight status read used to guard writes and to poll for completion. */
export async function getCaseAnalysisState(
  caseId: string
): Promise<AnalysisState> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cases")
    .select(
      "investigation_analysis_status, investigation_analysis_run_id, investigation_analysis_at"
    )
    .eq("id", caseId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Case not found.");

  return {
    status: data.investigation_analysis_status ?? "idle",
    analysisRunId: data.investigation_analysis_run_id,
    generatedAt: data.investigation_analysis_at,
  };
}

/** Full read: status plus the validated analysis result (if any). */
export async function getCaseAnalysis(caseId: string): Promise<CaseAnalysis> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cases")
    .select(
      "investigation_analysis, investigation_analysis_status, investigation_analysis_at"
    )
    .eq("id", caseId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Case not found.");

  // A schema change since the analysis was written shouldn't crash the page —
  // treat an unparseable stored blob as "no analysis yet" so it can be re-run.
  const parsed = data.investigation_analysis
    ? investigationAnalysisSchema.safeParse(data.investigation_analysis)
    : null;

  return {
    status: data.investigation_analysis_status ?? "idle",
    generatedAt: data.investigation_analysis_at,
    analysis: parsed?.success ? parsed.data : null,
  };
}

/** Mark the analysis as running and stamp the active run id. */
export async function startAnalysis(
  caseId: string,
  runId: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("cases")
    .update({
      investigation_analysis_status: "analyzing",
      investigation_analysis_run_id: runId,
    })
    .eq("id", caseId);

  if (error) throw new Error(error.message);
}

export async function cancelAnalysis(caseId: string): Promise<AnalysisState> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cases")
    .update({ investigation_analysis_status: "canceled" })
    .eq("id", caseId)
    .eq("investigation_analysis_status", "analyzing")
    .select(
      "investigation_analysis_status, investigation_analysis_run_id, investigation_analysis_at"
    )
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data) {
    return {
      status: data.investigation_analysis_status ?? "idle",
      analysisRunId: data.investigation_analysis_run_id,
      generatedAt: data.investigation_analysis_at,
    };
  }

  return getCaseAnalysisState(caseId);
}

export async function assertAnalysisIsActive(
  caseId: string,
  runId: string
): Promise<void> {
  const state = await getCaseAnalysisState(caseId);
  if (state.status === "canceled") {
    throw new Error("Analysis canceled.");
  }
  if (state.status !== "analyzing" || state.analysisRunId !== runId) {
    throw new Error("Analysis was superseded.");
  }
}

/**
 * Persist a finished analysis. Guarded on the live run so a superseded run can't
 * clobber a newer one, mirroring the extraction write guards.
 */
export async function saveAnalysis(
  caseId: string,
  runId: string,
  analysis: InvestigationAnalysis
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cases")
    .update({
      investigation_analysis: analysis,
      investigation_analysis_status: "ready",
      investigation_analysis_at: new Date().toISOString(),
    })
    .eq("id", caseId)
    .eq("investigation_analysis_run_id", runId)
    .eq("investigation_analysis_status", "analyzing")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Analysis is no longer active.");
}

/** Mark the active run as failed (guarded so it never overrides a newer run). */
export async function setAnalysisFailed(
  caseId: string,
  runId: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("cases")
    .update({ investigation_analysis_status: "failed" })
    .eq("id", caseId)
    .eq("investigation_analysis_run_id", runId)
    .eq("investigation_analysis_status", "analyzing");

  if (error) throw new Error(error.message);
}
