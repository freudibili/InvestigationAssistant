"use server";

import { revalidatePath } from "next/cache";

import { listDocumentsForCase } from "@/lib/db/documents";
import {
  getCaseAnalysisState,
  saveAnalysis,
  setAnalysisFailed,
  startAnalysis,
} from "@/features/investigation-analysis/lib/db";
import {
  AnalysisError,
  generateCaseAnalysis,
} from "@/features/investigation-analysis/lib/analyze";
import type { InvestigationAnalysis } from "@/features/investigation-analysis/validation";

/**
 * Result of an analysis run. Like extraction, we *return* failures instead of
 * throwing so the real message survives a production build (Next.js strips
 * messages off errors thrown by Server Actions).
 */
export type AnalyzeCaseResult =
  | { ok: true; analysis: InvestigationAnalysis }
  | { ok: false; message: string };

/**
 * Run the cross-interview Investigation Analysis for a case. Triggered manually
 * by the investigator. Guarded on a fresh run id so a superseded run can't
 * clobber a newer one; on any failure the run is marked failed and a safe
 * message is returned.
 */
export async function analyzeCaseAction(
  caseId: string
): Promise<AnalyzeCaseResult> {
  const state = await getCaseAnalysisState(caseId);
  if (state.status === "analyzing") {
    return { ok: false, message: "An analysis is already running for this case." };
  }

  const runId = crypto.randomUUID();
  await startAnalysis(caseId, runId);
  revalidatePath(`/cases/${caseId}/analysis`);

  try {
    const documents = await listDocumentsForCase(caseId);
    const analysis = await generateCaseAnalysis(documents);
    await saveAnalysis(caseId, runId, analysis);
    revalidatePath(`/cases/${caseId}/analysis`);
    return { ok: true, analysis };
  } catch (error) {
    logAnalysisFailure({ caseId, runId, error });
    await setAnalysisFailed(caseId, runId);
    revalidatePath(`/cases/${caseId}/analysis`);
    return { ok: false, message: toUserMessage(error) };
  }
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
