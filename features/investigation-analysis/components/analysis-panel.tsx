"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Database,
  FileCheck2,
  Play,
  Loader2,
  RotateCcw,
  Sparkles,
  StopCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useAnalyzeCase,
  useCancelAnalysis,
  useCaseAnalysis,
  type CaseAnalysisResponse,
} from "@/features/investigation-analysis/hooks/use-analysis";
import { AnalysisDashboard } from "@/features/investigation-analysis/components/analysis-dashboard";
import type { CaseDocument } from "@/lib/types";

const analysisSteps = [
  {
    title: "Load extracted interviews",
    description: "Read the case documents already extracted in the database.",
  },
  {
    title: "Build case evidence",
    description:
      "Group interviews, allegations, quotes, events, people, and witnesses.",
  },
  {
    title: "Analyze across accounts",
    description: "Compare claimant, accused, and reference person statements.",
  },
  {
    title: "Validate the result",
    description: "Check the AI response against the expected analysis format.",
  },
  {
    title: "Save the dashboard",
    description: "Store the final analysis on the case for review and re-use.",
  },
];

/**
 * The Investigation Analysis tab: run the cross-interview analysis and review
 * the resulting dashboard. The Start/Re-run button is the entry point — there is
 * no automatic trigger, the investigator runs it once interviews are extracted.
 */
export function AnalysisPanel({
  caseId,
  initialDocuments,
  initialAnalysis,
}: {
  caseId: string;
  initialDocuments: CaseDocument[];
  initialAnalysis: CaseAnalysisResponse;
}) {
  const approvedExtractionCount = useMemo(
    () =>
      initialDocuments.filter(
        (document) => document.extractionReviewStatus === "approved",
      ).length,
    [initialDocuments],
  );
  const { data } = useCaseAnalysis(caseId, initialAnalysis);
  const analyze = useAnalyzeCase(caseId);
  const cancelAnalysis = useCancelAnalysis(caseId);

  const status = data?.status ?? "idle";
  const analysis = data?.analysis ?? null;
  const isCanceled = status === "canceled";
  const isRunning =
    status === "analyzing" || (analyze.isPending && !isCanceled);
  const isCanceling = cancelAnalysis.isPending;
  const canRun = approvedExtractionCount > 0 && !isRunning && !isCanceling;
  const visibleAnalysis = isRunning ? null : analysis;

  async function run() {
    try {
      await analyze.mutateAsync();
      toast.success(
        analysis
          ? "Investigation analysis updated."
          : "Investigation analysis complete.",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        /canceled|superseded/i.test(error.message)
      ) {
        return;
      }

      toast.error(error instanceof Error ? error.message : "Analysis failed.");
    }
  }

  async function cancelRun() {
    try {
      await cancelAnalysis.mutateAsync();
      toast.success("Analysis canceled.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not cancel analysis.",
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium">Cross-interview analysis</h2>
          <p className="text-muted-foreground text-sm">
            {approvedExtractionCount === 0
              ? "Approve at least one extraction before running the analysis."
              : `Triangulates ${approvedExtractionCount} approved interview${
                  approvedExtractionCount === 1 ? "" : "s"
                } into per-grievance findings — claimant, accused, and reference accounts with a reasoned verdict.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isRunning ? (
            <Button
              variant="outline"
              onClick={cancelRun}
              disabled={isCanceling}
            >
              {isCanceling ? (
                <Loader2 className="animate-spin" />
              ) : (
                <StopCircle />
              )}
              {isCanceling ? "Canceling..." : "Cancel"}
            </Button>
          ) : null}
          <Button
            variant={isCanceled ? "outline" : "default"}
            onClick={() => void run()}
            disabled={!canRun}
          >
            {isRunning ? (
              <>
                <Loader2 className="animate-spin" />
                Analyzing…
              </>
            ) : isCanceled || analysis ? (
              <>
                <RotateCcw />
                Re-analyse all grievances
              </>
            ) : (
              <>
                <Sparkles />
                Start analysis
              </>
            )}
          </Button>
          {isCanceled && !isRunning ? (
            <Button onClick={() => void run()} disabled={!canRun}>
              <Play />
              Resume analysis
            </Button>
          ) : null}
        </div>
      </div>

      {status === "failed" && !isRunning ? (
        <p className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          The last analysis failed. You can try running it again.
        </p>
      ) : null}

      {status === "canceled" && !isRunning ? (
        <p className="flex items-center gap-2 rounded-lg border border-muted bg-muted/40 p-3 text-sm text-muted-foreground">
          <StopCircle className="size-4 shrink-0" />
          Analysis was canceled. Resume it to run again from the extracted case
          data.
        </p>
      ) : null}

      <AnalysisSteps
        extractedCount={approvedExtractionCount}
        hasAnalysis={Boolean(visibleAnalysis)}
        isRunning={isRunning}
      />

      {visibleAnalysis ? (
        <AnalysisDashboard caseId={caseId} analysis={visibleAnalysis} />
      ) : isRunning ? (
        <AnalysisLoadingPanel />
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No analysis yet. Run it to build the case-level dashboard.
        </p>
      )}
    </div>
  );
}

function AnalysisLoadingPanel() {
  return (
    <section className="flex min-h-80 items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <Loader2 className="size-8 animate-spin text-primary" />
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Analyzing interviews</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Building the investigation dashboard from the extracted case
            material.
          </p>
        </div>
      </div>
    </section>
  );
}

function AnalysisSteps({
  extractedCount,
  hasAnalysis,
  isRunning,
}: {
  extractedCount: number;
  hasAnalysis: boolean;
  isRunning: boolean;
}) {
  const activeIndex = isRunning ? 0 : -1;

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center gap-2">
        <Database className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Analysis steps</h3>
      </div>

      <ol className="grid gap-3 md:grid-cols-5">
        {analysisSteps.map((step, index) => {
          const isComplete = hasAnalysis || (isRunning && index < activeIndex);
          const isActive = isRunning && index === activeIndex;
          const isUnavailable = extractedCount === 0;
          const StepIcon = isComplete
            ? CheckCircle2
            : isActive
              ? Loader2
              : Circle;

          return (
            <li
              key={step.title}
              className={cn(
                "flex min-h-28 flex-col gap-2 rounded-md border p-3 text-sm",
                isActive && "border-primary bg-primary/5",
                isComplete &&
                  "border-emerald-600/40 bg-emerald-50 text-emerald-950",
                isUnavailable && "opacity-60",
              )}
            >
              <div className="flex items-center gap-2">
                <StepIcon
                  className={cn(
                    "size-4 shrink-0",
                    isActive && "animate-spin text-primary",
                    isComplete && "text-emerald-600",
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

      {extractedCount === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <FileCheck2 className="size-4" />
          Extract at least one interview to enable these steps.
        </p>
      ) : null}
    </section>
  );
}
