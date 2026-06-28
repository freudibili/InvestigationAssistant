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
  reportDraft: ReportDraft
): Promise<InvestigationAnalysis> {
  const current = await getCaseAnalysis(caseId);

  if (!current.analysis) {
    throw new Error("No saved analysis found for this case.");
  }

  const parsedReportDraft = reportDraftSchema.parse(reportDraft);
  const mergedSections = current.analysis.reportDraft
    ? mergeManualReportSections(
        current.analysis.reportDraft.sections,
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
    ...current.analysis,
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

function mergeManualReportSections(
  currentSections: ReportSection[],
  generatedSections: ReportSection[]
): ReportSection[] {
  return generatedSections.map((section) => {
    if (section.type !== "manual") return section;

    const currentSection = currentSections.find(
      (candidate) => candidate.number === section.number
    );

    if (!currentSection) return section;

    return {
      ...section,
      editedContent: currentSection.editedContent,
      children: mergeManualSectionChildren(
        currentSection.children ?? [],
        section.children ?? []
      ),
    };
  });
}

function mergeManualSectionChildren(
  currentChildren: ReportSection[],
  generatedChildren: ReportSection[]
): ReportSection[] {
  const mergedChildren = generatedChildren.map((child) => {
    if (child.type !== "manual") return child;

    const currentChild = currentChildren.find(
      (candidate) => candidate.number === child.number
    );

    if (!currentChild) return child;

    return {
      ...child,
      editedContent: currentChild.editedContent,
      children: mergeManualSectionChildren(
        currentChild.children ?? [],
        child.children ?? []
      ),
    };
  });
  const customChildren = currentChildren.filter((child) => child.type === "custom");

  return [...mergedChildren, ...customChildren];
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
