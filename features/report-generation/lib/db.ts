import "server-only";

import { getCaseAnalysis } from "@/features/investigation-analysis/lib/db";
import { investigationAnalysisSchema } from "@/features/investigation-analysis/validation";
import type { InvestigationAnalysis } from "@/features/investigation-analysis/types";
import {
  REPORT_GENERATION_STEPS,
  renderReportSections,
} from "@/features/report-generation/lib/report";
import {
  reportGenerationStateSchema,
  reportDraftSchema,
  reportSectionSchema,
  type ReportDraft,
  type ReportGenerationState,
  type ReportSection,
} from "@/features/report-generation/validation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function saveReportDraft(
  caseId: string,
  runId: string,
  reportDraft: ReportDraft
): Promise<InvestigationAnalysis> {
  const current = await getCaseAnalysis(caseId);

  const currentAnalysis = requireActiveReportGeneration(current.analysis, runId);

  const parsedReportDraft = reportDraftSchema.parse(reportDraft);
  const mergedSections = currentAnalysis.reportDraft
    ? mergeReportSections(
        currentAnalysis.reportDraft.sections,
        parsedReportDraft.sections
      )
    : parsedReportDraft.sections;
  const nextReportDraft = reportDraftSchema.parse({
    ...parsedReportDraft,
    sections: mergedSections,
    editedContent: hasReportSectionEdits(mergedSections)
      ? renderReportSections(mergedSections)
      : null,
  });

  const nextAnalysis = investigationAnalysisSchema.parse({
    ...currentAnalysis,
    reportDraft: nextReportDraft,
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
  const { data, error } = await supabase
    .from("cases")
    .update({
      investigation_analysis: nextAnalysis,
      investigation_analysis_at: new Date().toISOString(),
    })
    .eq("id", caseId)
    .eq("investigation_analysis->reportGeneration->>runId", runId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Report generation was superseded.");

  return nextAnalysis;
}

export async function saveEditedReportDraft(
  caseId: string,
  editedDraft: string | ReportSection[]
): Promise<InvestigationAnalysis> {
  const current = await getCaseAnalysis(caseId);

  if (!current.analysis?.reportDraft) {
    throw new Error("No generated report draft found for this case.");
  }

  const parsedSections =
    typeof editedDraft === "string"
      ? null
      : reportSectionSchema.array().parse(editedDraft);
  const nextDraft =
    parsedSections === null
      ? {
          ...current.analysis.reportDraft,
          editedContent: editedDraft,
        }
      : {
          ...current.analysis.reportDraft,
          sections: parsedSections,
          editedContent: renderReportSections(parsedSections),
        };

  const nextAnalysis = investigationAnalysisSchema.parse({
    ...current.analysis,
    reportDraft: reportDraftSchema.parse(nextDraft),
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
      sections: resetReportSectionEdits(current.analysis.reportDraft.sections),
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

function resetReportSectionEdits(sections: ReportSection[]): ReportSection[] {
  return sections.map((section) => {
    const { editedContent, ...rest } = section;

    return {
      ...rest,
      children: resetReportSectionEdits(
        (section.children ?? []).filter((child) => child.type !== "custom")
      ),
    };
  });
}

function mergeReportSections(
  currentSections: ReportSection[],
  generatedSections: ReportSection[]
): ReportSection[] {
  return mergeReportSectionChildren("", currentSections, generatedSections);
}

function mergeReportSectionChildren(
  parentNumber: string,
  currentChildren: ReportSection[],
  generatedChildren: ReportSection[]
): ReportSection[] {
  const mergedChildren = generatedChildren.map((child) => {
    const currentChild = currentChildren.find(
      (candidate) =>
        candidate.type !== "custom" && candidate.number === child.number
    );

    return {
      ...child,
      editedContent:
        child.type === "manual" ? currentChild?.editedContent : undefined,
      children: mergeReportSectionChildren(
        child.number,
        currentChild?.children ?? [],
        child.children ?? []
      ),
    };
  });
  const customChildren = currentChildren.filter((child) => child.type === "custom");
  const generatedNumbers = new Set(generatedChildren.map((child) => child.number));
  const orphanedCustomChildren = currentChildren
    .filter(
      (child) => child.type !== "custom" && !generatedNumbers.has(child.number)
    )
    .flatMap((child) => collectCustomSections(child.children ?? []));

  return renumberCustomSections(parentNumber, [
    ...mergedChildren,
    ...customChildren,
    ...orphanedCustomChildren,
  ]);
}

function collectCustomSections(sections: ReportSection[]): ReportSection[] {
  return sections.flatMap((section) =>
    section.type === "custom"
      ? [section]
      : collectCustomSections(section.children ?? [])
  );
}

function renumberCustomSections(
  parentNumber: string,
  sections: ReportSection[]
): ReportSection[] {
  return sections.map((section, index) => {
    const number =
      section.type === "custom"
        ? [parentNumber, index + 1].filter(Boolean).join(".")
        : section.number;

    return {
      ...section,
      number,
      children: renumberCustomSections(number, section.children ?? []),
    };
  });
}

function hasReportSectionEdits(sections: ReportSection[]): boolean {
  return sections.some(
    (section) =>
      section.type === "custom" ||
      typeof section.editedContent === "string" ||
      hasReportSectionEdits(section.children ?? [])
  );
}

export async function saveReportGenerationState(
  caseId: string,
  state: ReportGenerationState,
  activeRunId?: string
): Promise<InvestigationAnalysis> {
  const current = await getCaseAnalysis(caseId);

  if (!current.analysis) {
    throw new Error("No saved analysis found for this case.");
  }
  if (activeRunId && current.analysis.reportGeneration.runId !== activeRunId) {
    throw new Error("Report generation was superseded.");
  }

  const nextAnalysis = investigationAnalysisSchema.parse({
    ...current.analysis,
    reportGeneration: reportGenerationStateSchema.parse(state),
  });

  const supabase = getSupabaseAdmin();
  let updateQuery = supabase
    .from("cases")
    .update({
      investigation_analysis: nextAnalysis,
      investigation_analysis_at: new Date().toISOString(),
    })
    .eq("id", caseId);

  if (activeRunId) {
    updateQuery = updateQuery.eq(
      "investigation_analysis->reportGeneration->>runId",
      activeRunId
    );
  }

  const { data, error } = await updateQuery.select("id").maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Report generation was superseded.");

  return nextAnalysis;
}

function requireActiveReportGeneration(
  analysis: InvestigationAnalysis | null,
  runId: string
): InvestigationAnalysis {
  if (!analysis) {
    throw new Error("No saved analysis found for this case.");
  }
  if (analysis.reportGeneration.runId !== runId) {
    throw new Error("Report generation was superseded.");
  }

  return analysis;
}
