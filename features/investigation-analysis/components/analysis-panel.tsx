"use client";

import { Loader2, Sparkles, RotateCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useCase } from "@/hooks/use-case";
import {
  useAnalyzeCase,
  useCaseAnalysis,
  type CaseAnalysisResponse,
} from "@/features/investigation-analysis/hooks/use-analysis";
import { AnalysisDashboard } from "@/features/investigation-analysis/components/analysis-dashboard";
import type { Case, CaseDocument } from "@/lib/types";

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

  const status = data?.status ?? "idle";
  const analysis = data?.analysis ?? null;
  const isRunning = status === "analyzing" || analyze.isPending;
  const canRun = extractedCount > 0 && !isRunning;

  async function run() {
    try {
      await analyze.mutateAsync();
      toast.success("Investigation analysis complete.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Analysis failed."
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
              : `Consolidates ${extractedCount} extracted interview${
                  extractedCount === 1 ? "" : "s"
                } into allegations, patterns, contradictions, and gaps.`}
          </p>
        </div>
        <Button onClick={run} disabled={!canRun}>
          {isRunning ? (
            <>
              <Loader2 className="animate-spin" />
              Analyzing…
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

      {status === "failed" && !isRunning ? (
        <p className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          The last analysis failed. You can try running it again.
        </p>
      ) : null}

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
