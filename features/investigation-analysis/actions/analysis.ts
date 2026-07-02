"use server";

import { revalidatePath } from "next/cache";

import { listDocumentsForCase } from "@/lib/db/documents";
import {
  assertAnalysisIsActive,
  cancelAnalysis,
  getCaseAnalysis,
  getCaseAnalysisState,
  saveAnalysis,
  saveConductAssessment,
  saveOverallConductAssessment,
  setAnalysisFailed,
  startAnalysis,
} from "@/features/investigation-analysis/lib/db";
import {
  AnalysisError,
  generateCaseAnalysis,
} from "@/features/investigation-analysis/lib/analyze";
import {
  assessGlobalConduct,
  assessReprocheConduct,
  ConductAssessmentError,
} from "@/features/investigation-analysis/lib/conduct-assessment";
import type {
  ConductAssessment,
  InvestigationAnalysis,
} from "@/features/investigation-analysis/validation";
import type { CaseDocument } from "@/lib/types";

/**
 * Result of an analysis run. Like extraction, we *return* failures instead of
 * throwing so the real message survives a production build (Next.js strips
 * messages off errors thrown by Server Actions).
 */
export type AnalyzeCaseResult =
  | { ok: true; analysis: InvestigationAnalysis }
  | { ok: false; canceled: boolean; message: string };

export type AssessConductResult =
  | { ok: true; assessment: ConductAssessment; analysis: InvestigationAnalysis }
  | { ok: false; message: string };

export async function cancelAnalysisAction(caseId: string) {
  const state = await cancelAnalysis(caseId);
  revalidatePath(`/cases/${caseId}/analysis`);
  return state;
}

/**
 * Run the cross-interview Investigation Analysis for a case. Triggered manually
 * by the investigator. Guarded on a fresh run id so a superseded run can't
 * clobber a newer one; on any failure the run is marked failed and a safe
 * message is returned.
 */
export async function analyzeCaseAction(
  caseId: string,
): Promise<AnalyzeCaseResult> {
  const state = await getCaseAnalysisState(caseId);
  if (state.status === "analyzing") {
    return {
      ok: false,
      canceled: false,
      message: "An analysis is already running for this case.",
    };
  }

  const runId = crypto.randomUUID();
  await startAnalysis(caseId, runId);
  revalidatePath(`/cases/${caseId}/analysis`);

  try {
    const documents = getApprovedDocuments(await listDocumentsForCase(caseId));
    if (documents.length === 0) {
      throw new AnalysisError(
        "Approve at least one extraction before running analysis.",
      );
    }
    await assertAnalysisIsActive(caseId, runId);
    const analysis = await generateCaseAnalysis(documents);
    await assertAnalysisIsActive(caseId, runId);
    await saveAnalysis(caseId, runId, analysis);
    revalidatePath(`/cases/${caseId}/analysis`);
    return { ok: true, analysis };
  } catch (error) {
    if (isCanceledAnalysis(error)) {
      revalidatePath(`/cases/${caseId}/analysis`);
      return { ok: false, canceled: true, message: error.message };
    }

    logAnalysisFailure({ caseId, runId, error });
    await setAnalysisFailed(caseId, runId);
    revalidatePath(`/cases/${caseId}/analysis`);
    return { ok: false, canceled: false, message: toUserMessage(error) };
  }
}

export async function assessConductAction(
  caseId: string,
  reprocheId: string,
): Promise<AssessConductResult> {
  try {
    const { analysis: currentAnalysis } = await getCaseAnalysis(caseId);
    const reproche = currentAnalysis?.reproches.find(
      (item) => item.id === reprocheId,
    );
    if (!reproche) {
      return { ok: false, message: "Grievance not found in saved analysis." };
    }

    const assessment = await assessReprocheConduct(reproche);
    const analysis = await saveConductAssessment(
      caseId,
      reprocheId,
      assessment,
    );
    revalidatePath(`/cases/${caseId}/analysis`);
    return { ok: true, assessment, analysis };
  } catch (error) {
    logConductAssessmentFailure({ reprocheId, error });
    return { ok: false, message: toConductAssessmentUserMessage(error) };
  }
}

export async function assessOverallConductAction(
  caseId: string,
): Promise<AssessConductResult> {
  try {
    const { analysis } = await getCaseAnalysis(caseId);
    if (!analysis) {
      return { ok: false, message: "No saved analysis found for this case." };
    }
    if (analysis.reproches.some((reproche) => !reproche.conductAssessment)) {
      return {
        ok: false,
        message:
          "Run the conduct assessment for every grievance before calculating the global result.",
      };
    }

    const assessment = await assessGlobalConduct(analysis);
    const savedAnalysis = await saveOverallConductAssessment(
      caseId,
      assessment,
    );
    revalidatePath(`/cases/${caseId}/analysis`);
    return { ok: true, assessment, analysis: savedAnalysis };
  } catch (error) {
    logConductAssessmentFailure({ reprocheId: "overall", error });
    return { ok: false, message: toConductAssessmentUserMessage(error) };
  }
}

export async function assessAllConductAction(
  caseId: string,
): Promise<AssessConductResult> {
  try {
    const { analysis } = await getCaseAnalysis(caseId);
    if (!analysis) {
      return { ok: false, message: "No saved analysis found for this case." };
    }
    if (analysis.reproches.length === 0) {
      return { ok: false, message: "No grievances available to calculate." };
    }

    let currentAnalysis = analysis;
    for (const reproche of analysis.reproches) {
      if (reproche.conductAssessment) continue;

      const assessment = await assessReprocheConduct(reproche);
      currentAnalysis = await saveConductAssessment(
        caseId,
        reproche.id,
        assessment,
      );
    }

    const overallAssessment = await assessGlobalConduct(currentAnalysis);
    const savedAnalysis = await saveOverallConductAssessment(
      caseId,
      overallAssessment,
    );
    revalidatePath(`/cases/${caseId}/analysis`);
    return { ok: true, assessment: overallAssessment, analysis: savedAnalysis };
  } catch (error) {
    logConductAssessmentFailure({ reprocheId: "all", error });
    return { ok: false, message: toConductAssessmentUserMessage(error) };
  }
}

function getApprovedDocuments(documents: CaseDocument[]): CaseDocument[] {
  return documents
    .filter(
      (document) =>
        document.extractionReviewStatus === "approved" &&
        document.approvedExtractedData,
    )
    .map((document) => ({
      ...document,
      extractedData: document.approvedExtractedData,
      fileUrl: document.approvedFileUrl ?? document.fileUrl,
      rawText: document.approvedRawText ?? document.rawText,
    }));
}

function isCanceledAnalysis(error: unknown): error is Error {
  return error instanceof Error && /canceled|superseded/i.test(error.message);
}

function toUserMessage(error: unknown): string {
  if (error instanceof AnalysisError) return error.userMessage;
  return "Analysis failed. Please try again.";
}

function logAnalysisFailure(params: {
  caseId: string;
  runId: string;
  error: unknown;
}): void {
  const { caseId, runId, error } = params;
  const prefix = `[analysis] failed caseId=${caseId} runId=${runId}`;

  if (error instanceof AnalysisError) {
    console.error(
      `${prefix} type=AnalysisError message="${error.message}"` +
        (error.detail ? ` detail=${error.detail}` : ""),
    );
    if (error.cause) console.error(`${prefix} cause:`, error.cause);
    return;
  }
  if (error instanceof Error) {
    console.error(
      `${prefix} type=${error.name} message="${error.message}"`,
      error,
    );
    return;
  }
  console.error(`${prefix} non-error thrown:`, error);
}

function toConductAssessmentUserMessage(error: unknown): string {
  if (error instanceof ConductAssessmentError) return error.userMessage;
  return "Conduct assessment failed. Please try again.";
}

function logConductAssessmentFailure(params: {
  reprocheId: string;
  error: unknown;
}): void {
  const { reprocheId, error } = params;
  const prefix = `[conduct-assessment] failed reprocheId=${reprocheId}`;

  if (error instanceof ConductAssessmentError) {
    console.error(
      `${prefix} type=ConductAssessmentError message="${error.message}"` +
        (error.detail ? ` detail=${error.detail}` : ""),
    );
    if (error.cause) console.error(`${prefix} cause:`, error.cause);
    return;
  }
  if (error instanceof Error) {
    console.error(
      `${prefix} type=${error.name} message="${error.message}"`,
      error,
    );
    return;
  }
  console.error(`${prefix} non-error thrown:`, error);
}
