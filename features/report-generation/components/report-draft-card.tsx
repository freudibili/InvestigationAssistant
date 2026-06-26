"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  FileText,
  Loader2,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  useCaseAnalysis,
  type CaseAnalysisResponse,
} from "@/features/investigation-analysis/hooks/use-analysis";
import type { InvestigationAnalysis } from "@/features/investigation-analysis/types";
import {
  deleteEditedReportDraftAction,
  generateReportDraftAction,
  saveEditedReportDraftAction,
} from "@/features/report-generation/actions/report";
import type {
  ReportLanguage,
  ReportDraft,
  reportCoherenceIssueSchema,
} from "@/features/report-generation/validation";

const reportGenerationSteps = [
  {
    title: "Build framework sections",
    description: "Create sections 1 to 4 from case metadata, documents, and reusable text.",
  },
  {
    title: "Format allegations",
    description: "Place approved dashboard allegations into section 5 without rewriting them.",
  },
  {
    title: "Format global assessment",
    description: "Place the approved global assessment into section 6.",
  },
  {
    title: "Remove dashboard-only content",
    description: "Strip badges, percentages, calculator labels, and UI-only text.",
  },
  {
    title: "Check draft",
    description: "Verify no dashboard-only content remains before saving.",
  },
  {
    title: "Save draft",
    description: "Store the editable draft on the case.",
  },
];

const reportGenerationStaleAfterMs = 10 * 60 * 1000;

type ReportDraftMode = "generated" | "edited";

export function ReportDraftCard({
  caseId,
  analysis,
}: {
  caseId: string;
  analysis: InvestigationAnalysis;
}) {
  const [draftMode, setDraftMode] = useState<ReportDraftMode>(
    analysis.reportDraft?.editedContent ? "edited" : "generated"
  );
  const [editedDraftText, setEditedDraftText] = useState(
    analysis.reportDraft?.editedContent ??
      analysis.reportDraft?.generatedContent ??
      ""
  );
  const [issues, setIssues] = useState<
    z.infer<typeof reportCoherenceIssueSchema>[]
  >([]);
  const [reportLanguage, setReportLanguage] = useState<ReportLanguage>("en");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingEdit, setIsDeletingEdit] = useState(false);
  const queryClient = useQueryClient();
  const { data } = useCaseAnalysis(caseId, {
    status: "ready",
    generatedAt: analysis.generatedAt,
    analysis,
  });
  const liveAnalysis = data?.analysis ?? analysis;
  const reportDraft = liveAnalysis.reportDraft;
  const reportGeneration = liveAnalysis.reportGeneration;
  const isPersistedGenerationRunning =
    reportGeneration.status === "generating" &&
    !isStaleReportGeneration(reportGeneration.updatedAt);
  const isGenerationRunning = isGenerating || isPersistedGenerationRunning;
  const stepStatus = toStepStatus(reportGeneration.status, isGenerationRunning);
  const activeStepIndex = isGenerationRunning
    ? isPersistedGenerationRunning
      ? reportGeneration.currentStepIndex
      : 0
    : reportGeneration.status === "complete"
      ? reportGenerationSteps.length - 1
      : -1;
  const generatedDraftText =
    isGenerationRunning && draftMode === "generated"
      ? ""
      : reportDraft?.generatedContent ?? "";
  const savedEditedDraftText = reportDraft?.editedContent ?? "";
  const hasEditedDraft = Boolean(reportDraft?.editedContent);
  const hasUnsavedEdits =
    Boolean(reportDraft) &&
    draftMode === "edited" &&
    editedDraftText !== savedEditedDraftText;

  async function handleGenerateReport() {
    setIssues([]);
    setDraftMode("generated");
    setIsGenerating(true);
    queryClient.setQueryData<CaseAnalysisResponse>(
      queryKeys.analysis(caseId),
      (current) => {
        const currentAnalysis = current?.analysis ?? liveAnalysis;

        return {
          status: current?.status ?? "ready",
          generatedAt: current?.generatedAt ?? liveAnalysis.generatedAt,
          analysis: {
            ...currentAnalysis,
            reportDraft: currentAnalysis.reportDraft
              ? {
                  ...currentAnalysis.reportDraft,
                  generatedContent: "",
                }
              : currentAnalysis.reportDraft,
            reportGeneration: {
              status: "generating",
              runId: null,
              currentStep: reportGenerationSteps[0]?.title ?? "Build framework sections",
              currentStepIndex: 0,
              totalSteps: reportGenerationSteps.length,
              errorMessage: null,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      }
    );

    try {
      const result = await generateReportDraftAction(caseId, reportLanguage);

      if (!result.ok) {
        setIssues(result.issues);
        toast.error(result.message);
        return;
      }

      setDraftMode("generated");
      setEditedDraftText(
        result.analysis.reportDraft?.editedContent ??
          result.reportDraft.generatedContent
      );
      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => ({
          status: current?.status ?? "ready",
          generatedAt: current?.generatedAt ?? result.analysis.generatedAt,
          analysis: result.analysis,
        })
      );
      toast.success("Report draft generated.");
    } finally {
      setIsGenerating(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.analysis(caseId) });
    }
  }

  async function handleSaveEditedDraft() {
    if (!reportDraft) return;

    setIsSavingEdit(true);
    try {
      const result = await saveEditedReportDraftAction(caseId, editedDraftText);

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => ({
          status: current?.status ?? "ready",
          generatedAt: current?.generatedAt ?? result.analysis.generatedAt,
          analysis: result.analysis,
        })
      );
      setDraftMode("edited");
      setEditedDraftText(
        result.analysis.reportDraft?.editedContent ?? editedDraftText
      );
      toast.success("Edited report draft saved.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDeleteEditedDraft() {
    if (!reportDraft?.editedContent) return;

    setIsDeletingEdit(true);
    try {
      const result = await deleteEditedReportDraftAction(caseId);

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => ({
          status: current?.status ?? "ready",
          generatedAt: current?.generatedAt ?? result.analysis.generatedAt,
          analysis: result.analysis,
        })
      );
      setDraftMode("generated");
      setEditedDraftText(result.analysis.reportDraft?.generatedContent ?? "");
      toast.success("Edited report draft deleted.");
    } finally {
      setIsDeletingEdit(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ReportDraftMeta reportDraft={reportDraft} />
          <div className="flex flex-wrap gap-2">
            <select
              className="border-input bg-background h-8 rounded-md border px-2 text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
              value={reportLanguage}
              onChange={(event) =>
                setReportLanguage(event.target.value as ReportLanguage)
              }
              disabled={isGenerationRunning || isSavingEdit || isDeletingEdit}
              aria-label="Report language"
            >
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="de">German</option>
            </select>
            {reportDraft && draftMode === "edited" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleSaveEditedDraft}
                disabled={
                  !hasUnsavedEdits ||
                  isSavingEdit ||
                  isDeletingEdit ||
                  isGenerationRunning
                }
              >
                {isSavingEdit ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Save />
                )}
                {isSavingEdit ? "Saving..." : "Save edits"}
              </Button>
            ) : null}
            {hasEditedDraft ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={handleDeleteEditedDraft}
                disabled={isDeletingEdit || isSavingEdit || isGenerationRunning}
              >
                {isDeletingEdit ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Trash2 />
                )}
                {isDeletingEdit ? "Deleting..." : "Delete edits"}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={handleGenerateReport}
              disabled={
                isGenerationRunning ||
                isSavingEdit ||
                isDeletingEdit ||
                liveAnalysis.reproches.length === 0
              }
              title={
                liveAnalysis.reproches.length === 0
                  ? "No approved reproaches are available for report generation."
                  : undefined
              }
            >
              {isGenerationRunning ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              {isGenerationRunning
                ? "Generating..."
                : reportDraft
                  ? "Regenerate draft"
                  : "Generate draft"}
            </Button>
          </div>
        </div>

        {liveAnalysis.reproches.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
            No approved reproaches are available for report generation.
          </p>
        ) : null}

        <ReportGenerationSteps
          activeStepIndex={activeStepIndex}
          hasReportDraft={Boolean(reportDraft)}
          status={stepStatus}
        />

        {issues.length > 0 ? <CoherenceIssues issues={issues} /> : null}

        {reportGeneration.status === "failed" && reportGeneration.errorMessage ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {reportGeneration.errorMessage}
          </p>
        ) : null}

        {reportDraft ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={draftMode === "generated" ? "secondary" : "outline"}
              onClick={() => setDraftMode("generated")}
            >
              Generated draft
            </Button>
            <Button
              type="button"
              size="sm"
              variant={draftMode === "edited" ? "secondary" : "outline"}
              onClick={() => setDraftMode("edited")}
            >
              Edited draft
            </Button>
          </div>
        ) : null}

        {reportDraft && draftMode === "generated" ? (
          generatedDraftText ? (
            <div className="border-input bg-muted/30 min-h-[520px] w-full overflow-auto rounded-md border px-3 py-2 font-mono text-sm leading-relaxed whitespace-pre-wrap">
              {generatedDraftText}
            </div>
          ) : (
            <Empty>
              {isGenerationRunning
                ? "Generating draft..."
                : "No generated draft available."}
            </Empty>
          )
        ) : reportDraft && draftMode === "edited" ? (
          <textarea
            className="border-input bg-background ring-offset-background min-h-[520px] w-full resize-y rounded-md border px-3 py-2 font-mono text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={editedDraftText}
            onChange={(event) => {
              setDraftMode("edited");
              setEditedDraftText(event.target.value);
            }}
            placeholder="Edit the report draft here."
          />
        ) : (
          <Empty>No draft report generated.</Empty>
        )}
      </CardContent>
    </Card>
  );
}

function isStaleReportGeneration(updatedAt: string | null): boolean {
  if (!updatedAt) return true;

  const updatedTime = Date.parse(updatedAt);
  if (Number.isNaN(updatedTime)) return true;

  return Date.now() - updatedTime > reportGenerationStaleAfterMs;
}

function toStepStatus(
  status: InvestigationAnalysis["reportGeneration"]["status"],
  isGenerationRunning: boolean
): "idle" | "running" | "complete" | "error" {
  if (isGenerationRunning) return "running";
  if (status === "complete") return "complete";
  if (status === "failed") return "error";
  return "idle";
}

function ReportGenerationSteps({
  activeStepIndex,
  hasReportDraft,
  status,
}: {
  activeStepIndex: number;
  hasReportDraft: boolean;
  status: "idle" | "running" | "complete" | "error";
}) {
  const progress =
    status === "complete" || (hasReportDraft && status === "idle")
      ? 100
      : status === "running"
        ? Math.round(((activeStepIndex + 1) / reportGenerationSteps.length) * 100)
        : 0;
  const activeStep =
    activeStepIndex >= 0 ? reportGenerationSteps[activeStepIndex] : null;

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Report generation steps</h3>
      </div>

      {status === "running" || status === "complete" || hasReportDraft ? (
        <div className="mb-4 space-y-2">
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${Math.min(Math.max(progress, 8), 100)}%` }}
            />
          </div>
          <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
            <span className="truncate">
              {status === "running"
                ? activeStep?.title
                : hasReportDraft
                  ? "Report draft ready"
                  : "Ready to generate"}
            </span>
            {status === "running" ? (
              <span className="shrink-0 tabular-nums">
                {activeStepIndex + 1}/{reportGenerationSteps.length}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <ol className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {reportGenerationSteps.map((step, index) => {
          const isComplete =
            status === "complete" ||
            (hasReportDraft && status !== "running" && status !== "error") ||
            (status === "running" && index < activeStepIndex);
          const isActive = status === "running" && index === activeStepIndex;
          const isError = status === "error" && index === activeStepIndex;
          const StepIcon = isComplete ? CheckCircle2 : isActive ? Loader2 : Circle;

          return (
            <li
              key={step.title}
              className={cn(
                "flex min-h-28 flex-col gap-2 rounded-md border p-3 text-sm",
                isActive && "border-primary bg-primary/5",
                isComplete && "border-emerald-600/40 bg-emerald-50 text-emerald-950",
                isError && "border-destructive/50 bg-destructive/5"
              )}
            >
              <div className="flex items-center gap-2">
                <StepIcon
                  className={cn(
                    "size-4 shrink-0",
                    isActive && "animate-spin text-primary",
                    isComplete && "text-emerald-600",
                    isError && "text-destructive"
                  )}
                />
                <span className="font-medium leading-snug">{step.title}</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                {step.description}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ReportDraftMeta({ reportDraft }: { reportDraft: ReportDraft | null }) {
  if (!reportDraft) {
    return (
      <p className="text-muted-foreground text-sm">
        The draft will be saved after a coherent final check.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">Generated draft</Badge>
      {reportDraft.editedContent ? <Badge variant="secondary">Edited draft saved</Badge> : null}
      <Badge variant="success">Coherent</Badge>
      <span className="text-muted-foreground text-xs">
        Generated {formatGeneratedAt(reportDraft.generatedAt)}
      </span>
    </div>
  );
}

// Fixed locale + format so server and client render identically (no hydration
// mismatch) regardless of the host/browser locale.
const generatedAtFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatGeneratedAt(generatedAt: string) {
  return generatedAtFormatter.format(new Date(generatedAt));
}

function CoherenceIssues({
  issues,
}: {
  issues: z.infer<typeof reportCoherenceIssueSchema>[];
}) {
  return (
    <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-sm font-medium">Coherence check issues</p>
      <div className="space-y-3">
        {issues.map((issue, index) => (
          <div key={index} className="space-y-1 text-sm">
            <p className="font-medium">{issue.subject}</p>
            <p>
              <span className="text-muted-foreground">Version A:</span>{" "}
              {issue.versionA}
            </p>
            <p>
              <span className="text-muted-foreground">Version B:</span>{" "}
              {issue.versionB}
            </p>
            <p>
              <span className="text-muted-foreground">Recommendation:</span>{" "}
              {issue.recommendation}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
      {children}
    </p>
  );
}
