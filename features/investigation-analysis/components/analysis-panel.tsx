"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Database,
  FileCheck2,
  Loader2,
  RotateCcw,
  Sparkles,
  StopCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCase } from "@/hooks/use-case";
import {
  useAnalyzeCase,
  useCancelAnalysis,
  useCaseAnalysis,
  type CaseAnalysisResponse,
} from "@/features/investigation-analysis/hooks/use-analysis";
import { AnalysisDashboard } from "@/features/investigation-analysis/components/analysis-dashboard";
import type { Case, CaseDocument } from "@/lib/types";

const analysisSteps = [
  {
    title: "Load extracted interviews",
    description: "Read the case documents already extracted in the database.",
  },
  {
    title: "Build case evidence",
    description: "Group interviews, allegations, quotes, events, people, and witnesses.",
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
  initialCase,
  initialDocuments,
  initialAnalysis,
}: {
  caseId: string;
  initialCase: Case;
  initialDocuments: CaseDocument[];
  initialAnalysis: CaseAnalysisResponse;
}) {
  const { data: caseData } = useCase(caseId, {
    case: initialCase,
    documents: initialDocuments,
  });
  const documents = caseData?.documents ?? initialDocuments;
  const extractedCount = documents.filter(
    (document) => document.extractedData
  ).length;

  const { data } = useCaseAnalysis(caseId, initialAnalysis);
  const analyze = useAnalyzeCase(caseId);
  const cancelAnalysis = useCancelAnalysis(caseId);

  const status = data?.status ?? "idle";
  const analysis = data?.analysis ?? null;
  const isRunning =
    status === "analyzing" || (analyze.isPending && status !== "canceled");
  const isCanceling = cancelAnalysis.isPending;
  const canRun = extractedCount > 0 && !isRunning && !isCanceling;

  async function run() {
    try {
      await analyze.mutateAsync();
      toast.success("Investigation analysis complete.");
    } catch (error) {
      if (
        error instanceof Error &&
        /canceled|superseded/i.test(error.message)
      ) {
        return;
      }

      toast.error(
        error instanceof Error ? error.message : "Analysis failed."
      );
    }
  }

  async function cancelRun() {
    try {
      await cancelAnalysis.mutateAsync();
      toast.success("Analysis canceled.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not cancel analysis."
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium">Cross-interview analysis</h2>
          <p className="text-muted-foreground text-sm">
            {extractedCount === 0
              ? "Extract at least one interview before running the analysis."
              : `Triangulates ${extractedCount} extracted interview${
                  extractedCount === 1 ? "" : "s"
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
          <Button onClick={run} disabled={!canRun}>
            {isRunning ? (
              <>
                <Loader2 className="animate-spin" />
                Analyzing…
              </>
            ) : status === "canceled" ? (
              <>
                <RotateCcw />
                Resume analysis
              </>
            ) : analysis ? (
              <>
                <RotateCcw />
                Re-run analysis
              </>
            ) : (
              <>
                <Sparkles />
                Start analysis
              </>
            )}
          </Button>
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
          Analysis was canceled. Resume it to run again from the extracted case data.
        </p>
      ) : null}

      <AnalysisSteps
        extractedCount={extractedCount}
        hasAnalysis={Boolean(analysis)}
        isRunning={isRunning}
      />

      {analysis ? (
        <AnalysisDashboard analysis={analysis} />
      ) : isRunning ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          Analyzing interviews… this can take a moment.
        </p>
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No analysis yet. Run it to build the case-level dashboard.
        </p>
      )}
    </div>
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
  const activeIndex = isRunning ? 2 : -1;

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
          const StepIcon = isComplete ? CheckCircle2 : isActive ? Loader2 : Circle;

          return (
            <li
              key={step.title}
              className={cn(
                "flex min-h-28 flex-col gap-2 rounded-md border p-3 text-sm",
                isActive && "border-primary bg-primary/5",
                isComplete && "border-emerald-600/40 bg-emerald-50 text-emerald-950",
                isUnavailable && "opacity-60"
              )}
            >
              <div className="flex items-center gap-2">
                <StepIcon
                  className={cn(
                    "size-4 shrink-0",
                    isActive && "animate-spin text-primary",
                    isComplete && "text-emerald-600"
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
