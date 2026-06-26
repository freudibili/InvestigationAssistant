import "server-only";

import { getCaseAnalysis } from "@/features/investigation-analysis/lib/db";
import { investigationAnalysisSchema } from "@/features/investigation-analysis/validation";
import type { InvestigationAnalysis } from "@/features/investigation-analysis/types";
import { REPORT_GENERATION_STEPS } from "@/features/report-generation/lib/report";
import {
  reportGenerationStateSchema,
  reportDraftSchema,
  type ReportDraft,
  type ReportGenerationState,
} from "@/features/report-generation/validation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function saveReportDraft(
  caseId: string,
  reportDraft: ReportDraft
): Promise<InvestigationAnalysis> {
  const current = await getCaseAnalysis(caseId);

  if (!current.analysis) {
    throw new Error("No saved analysis found for this case.");
  }

  const nextAnalysis = investigationAnalysisSchema.parse({
    ...current.analysis,
    reportDraft: reportDraftSchema.parse({
      ...reportDraft,
      editedContent:
        current.analysis.reportDraft?.editedContent ?? reportDraft.editedContent,
    }),
    reportGeneration: reportGenerationStateSchema.parse({
      status: "complete",
      runId: null,
      currentStep: "Report draft ready",
      currentStepIndex: REPORT_GENERATION_STEPS.length - 1,
      totalSteps: REPORT_GENERATION_STEPS.length,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    }),
  });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("cases")
    .update({
      investigation_analysis: nextAnalysis,
      investigation_analysis_at: new Date().toISOString(),
    })
    .eq("id", caseId);

  if (error) throw new Error(error.message);

  return nextAnalysis;
}

export async function saveEditedReportDraft(
  caseId: string,
  editedContent: string
): Promise<InvestigationAnalysis> {
  const current = await getCaseAnalysis(caseId);

  if (!current.analysis?.reportDraft) {
    throw new Error("No generated report draft found for this case.");
  }

  const nextAnalysis = investigationAnalysisSchema.parse({
    ...current.analysis,
    reportDraft: reportDraftSchema.parse({
      ...current.analysis.reportDraft,
      editedContent,
    }),
  });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("cases")
    .update({
      investigation_analysis: nextAnalysis,
      investigation_analysis_at: new Date().toISOString(),
    })
    .eq("id", caseId);

  if (error) throw new Error(error.message);

  return nextAnalysis;
}

export async function deleteEditedReportDraft(
  caseId: string
): Promise<InvestigationAnalysis> {
  const current = await getCaseAnalysis(caseId);

  if (!current.analysis?.reportDraft) {
    throw new Error("No generated report draft found for this case.");
  }

  const nextAnalysis = investigationAnalysisSchema.parse({
    ...current.analysis,
    reportDraft: reportDraftSchema.parse({
      ...current.analysis.reportDraft,
      editedContent: null,
    }),
  });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("cases")
    .update({
      investigation_analysis: nextAnalysis,
      investigation_analysis_at: new Date().toISOString(),
    })
    .eq("id", caseId);

  if (error) throw new Error(error.message);

  return nextAnalysis;
}

export async function saveReportGenerationState(
  caseId: string,
  state: ReportGenerationState
): Promise<InvestigationAnalysis> {
  const current = await getCaseAnalysis(caseId);

  if (!current.analysis) {
    throw new Error("No saved analysis found for this case.");
  }

  const nextAnalysis = investigationAnalysisSchema.parse({
    ...current.analysis,
    reportGeneration: reportGenerationStateSchema.parse(state),
  });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("cases")
    .update({
      investigation_analysis: nextAnalysis,
      investigation_analysis_at: new Date().toISOString(),
    })
    .eq("id", caseId);

  if (error) throw new Error(error.message);

  return nextAnalysis;
}
