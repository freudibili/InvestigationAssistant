"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { getCaseAnalysis } from "@/features/investigation-analysis/lib/db";
import { getCase } from "@/lib/db/cases";
import { listDocumentSummariesForCase } from "@/lib/db/documents";
import type { InvestigationAnalysis } from "@/features/investigation-analysis/types";
import {
  generateReportDraft,
  REPORT_GENERATION_STEPS,
  ReportGenerationError,
} from "@/features/report-generation/lib/report";
import {
  deleteEditedReportDraft,
  saveEditedReportDraft,
  saveReportDraft,
  saveReportGenerationState,
} from "@/features/report-generation/lib/db";
import type {
  ReportDraft,
  ReportLanguage,
  ReportSection,
  reportCoherenceIssueSchema,
} from "@/features/report-generation/validation";

export type GenerateReportResult =
  | { ok: true; reportDraft: ReportDraft; analysis: InvestigationAnalysis }
  | {
      ok: false;
      message: string;
      issues: z.infer<typeof reportCoherenceIssueSchema>[];
    };

export type SaveEditedReportResult =
  | { ok: true; analysis: InvestigationAnalysis }
  | { ok: false; message: string };

export async function generateReportDraftAction(
  caseId: string,
  language: ReportLanguage = "en"
): Promise<GenerateReportResult> {
  const runId = crypto.randomUUID();

  try {
    const [investigationCase, documents, { analysis }] = await Promise.all([
      getCase(caseId),
      listDocumentSummariesForCase(caseId),
      getCaseAnalysis(caseId),
    ]);
    if (!investigationCase) {
      return {
        ok: false,
        message: "Case not found.",
        issues: [],
      };
    }
    if (!analysis) {
      return {
        ok: false,
        message: "No approved analysis found for this case.",
        issues: [],
      };
    }

    await saveReportGenerationState(caseId, {
      status: "generating",
      runId,
      currentStep: REPORT_GENERATION_STEPS[0]?.label ?? "Build framework sections",
      currentStepIndex: 0,
      totalSteps: REPORT_GENERATION_STEPS.length,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    });

    const reportDraft = await generateReportDraft(
      { investigationCase, documents, analysis },
      {
        language,
        onStep: async (step) => {
          await saveReportGenerationState(caseId, {
            status: "generating",
            runId,
            currentStep: step.label,
            currentStepIndex: step.index,
            totalSteps: REPORT_GENERATION_STEPS.length,
            errorMessage: null,
            updatedAt: new Date().toISOString(),
          });
        },
      }
    );

    const saveStep = REPORT_GENERATION_STEPS[REPORT_GENERATION_STEPS.length - 1];
    await saveReportGenerationState(caseId, {
      status: "generating",
      runId,
      currentStep: saveStep?.label ?? "Save draft",
      currentStepIndex: saveStep?.index ?? REPORT_GENERATION_STEPS.length - 1,
      totalSteps: REPORT_GENERATION_STEPS.length,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    });

    const savedAnalysis = await saveReportDraft(caseId, reportDraft);
    revalidatePath(`/cases/${caseId}/report`);
    return { ok: true, reportDraft, analysis: savedAnalysis };
  } catch (error) {
    logReportGenerationFailure({ caseId, error });
    await saveFailedReportGenerationState(caseId, runId, error);
    return {
      ok: false,
      message: toReportGenerationUserMessage(error),
      issues: reportIssuesFromError(error),
    };
  }
}

export async function saveEditedReportDraftAction(
  caseId: string,
  editedDraft: string | ReportSection[]
): Promise<SaveEditedReportResult> {
  try {
    const analysis = await saveEditedReportDraft(caseId, editedDraft);
    revalidatePath(`/cases/${caseId}/report`);
    return { ok: true, analysis };
  } catch (error) {
    console.error("[report-generation] failed to save edited draft:", error);
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not save edited report draft.",
    };
  }
}

export async function deleteEditedReportDraftAction(
  caseId: string
): Promise<SaveEditedReportResult> {
  try {
    const analysis = await deleteEditedReportDraft(caseId);
    revalidatePath(`/cases/${caseId}/report`);
    return { ok: true, analysis };
  } catch (error) {
    console.error("[report-generation] failed to delete edited draft:", error);
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Could not delete edited report draft.",
    };
  }
}

async function saveFailedReportGenerationState(
  caseId: string,
  runId: string,
  error: unknown
): Promise<void> {
  try {
    await saveReportGenerationState(caseId, {
      status: "failed",
      runId,
      currentStep: "Report generation failed",
      currentStepIndex: 0,
      totalSteps: REPORT_GENERATION_STEPS.length,
      errorMessage: toReportGenerationUserMessage(error),
      updatedAt: new Date().toISOString(),
    });
  } catch (saveError) {
    console.error("[report-generation] failed to save failure state:", saveError);
  }
}

function toReportGenerationUserMessage(error: unknown): string {
  if (error instanceof ReportGenerationError) return error.userMessage;
  return "Report generation failed. Please try again.";
}

function reportIssuesFromError(
  error: unknown
): z.infer<typeof reportCoherenceIssueSchema>[] {
  if (!(error instanceof ReportGenerationError) || !error.detail) return [];

  try {
    const parsed = JSON.parse(error.detail);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function logReportGenerationFailure(params: {
  caseId: string;
  error: unknown;
}): void {
  const { caseId, error } = params;
  const prefix = `[report-generation] failed caseId=${caseId}`;

  if (error instanceof ReportGenerationError) {
    console.error(
      `${prefix} type=ReportGenerationError message="${error.message}"` +
        (error.detail ? ` detail=${error.detail}` : "")
    );
    if (error.cause) console.error(`${prefix} cause:`, error.cause);
    return;
  }
  if (error instanceof Error) {
    console.error(`${prefix} type=${error.name} message="${error.message}"`, error);
    return;
  }
  console.error(`${prefix} non-error thrown:`, error);
}
