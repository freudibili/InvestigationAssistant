"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  FileText,
  Loader2,
  Sparkles,
  StopCircle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/documents/status-badge";
import { getSupportedExtension } from "@/lib/documents";
import {
  useCancelExtraction,
  useDeleteDocument,
  useDocumentProgress,
  useExtractDocument,
} from "@/hooks/use-documents";
import type { CaseDocument } from "@/lib/types";

export function DocumentRow({ document }: { document: CaseDocument }) {
  const extract = useExtractDocument(document.caseId);
  const cancelExtraction = useCancelExtraction(document.caseId);
  const remove = useDeleteDocument(document.caseId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const progressQuery = useDocumentProgress(
    document.caseId,
    document.id,
    document.status === "extracting" || extract.isPending
  );
  const liveDocument = progressQuery.data ?? document;
  const isExtracting = liveDocument.status === "extracting";
  const isStartingExtraction =
    extract.isPending && liveDocument.status !== "canceled";
  const progress =
    liveDocument.extractionTotalSteps > 0
      ? Math.round(
          (liveDocument.extractionCurrentStep /
            liveDocument.extractionTotalSteps) *
            100
        )
      : 8;
  const extractionSteps = getExtractionSteps(liveDocument, isExtracting);

  async function handleExtract() {
    try {
      await extract.mutateAsync(document.id);
      toast.success("Extraction complete.");
    } catch (error) {
      if (
        error instanceof Error &&
        /canceled|superseded/i.test(error.message)
      ) {
        return;
      }

      toast.error(
        error instanceof Error ? error.message : "Extraction failed."
      );
    }
  }

  async function handleCancelExtraction() {
    try {
      await cancelExtraction.mutateAsync(document.id);
      toast.success("Extraction canceled.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not cancel extraction."
      );
    }
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync(document.id);
      setConfirmOpen(false);
      toast.success("Document deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete document."
      );
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <FileText className="text-muted-foreground size-5 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{document.fileName}</p>
            <div className="mt-1">
              <StatusBadge status={liveDocument.status} />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {liveDocument.status === "extracted" ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/cases/${document.caseId}/documents/${document.id}`}
                >
                  View Result
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExtract}
                disabled={isExtracting || isStartingExtraction}
              >
                <Sparkles />
                Re-extract
              </Button>
            </>
          ) : isExtracting || isStartingExtraction ? (
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancelExtraction}
              disabled={cancelExtraction.isPending}
            >
              {cancelExtraction.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <StopCircle />
              )}
              {cancelExtraction.isPending ? "Canceling..." : "Cancel"}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleExtract}
              disabled={isStartingExtraction}
            >
              {isStartingExtraction ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              {isStartingExtraction
                ? liveDocument.hasResumableDrafts
                  ? "Resuming..."
                  : "Extracting..."
                : liveDocument.status === "failed" ||
                    liveDocument.status === "canceled"
                  ? liveDocument.hasResumableDrafts
                    ? "Resume Extraction"
                    : "Retry Extraction"
                  : "Extract Interview Data"}
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmOpen(true)}
            disabled={isExtracting || isStartingExtraction || remove.isPending}
            aria-label="Delete document"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {isExtracting ? (
        <div className="mt-4 space-y-3">
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${Math.min(Math.max(progress, 8), 100)}%` }}
            />
          </div>
          <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
            <span className="truncate">
              {liveDocument.extractionStep ?? "Preparing document"}
            </span>
            {liveDocument.extractionTotalSteps > 0 ? (
              <span className="shrink-0 tabular-nums">
                {liveDocument.extractionCurrentStep}/
                {liveDocument.extractionTotalSteps}
              </span>
            ) : null}
          </div>
          <ol className="grid max-h-40 gap-2 overflow-y-auto pr-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
            {extractionSteps.map((step) => (
              <li
                key={step.label}
                className="bg-muted/50 flex min-w-0 items-center gap-2 rounded-md px-2.5 py-2"
              >
                <StepIcon status={step.status} />
                <span
                  className={
                    step.status === "pending"
                      ? "text-muted-foreground truncate"
                      : "truncate font-medium"
                  }
                >
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document</DialogTitle>
            <DialogDescription>
              {`"${document.fileName}" and its extracted data will be permanently deleted. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={remove.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type StepStatus = "complete" | "active" | "pending";

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "complete") {
    return <CheckCircle2 className="text-primary size-3.5 shrink-0" />;
  }

  if (status === "active") {
    return <Loader2 className="text-primary size-3.5 shrink-0 animate-spin" />;
  }

  return <Circle className="text-muted-foreground size-3.5 shrink-0" />;
}

/**
 * How many pages each checklist step covers. Mirrors the server's
 * `PAGES_PER_CHUNK` so each step maps to a single extraction call and the
 * checklist ticks off in the same page groups the document is extracted in.
 */
const DISPLAY_PAGES_PER_GROUP = 2;

function getExtractionSteps(
  document: CaseDocument,
  isExtracting: boolean
): { label: string; status: StepStatus }[] {
  const totalSteps = document.extractionTotalSteps;
  const currentStep = document.extractionCurrentStep;
  const currentMessage = document.extractionStep ?? "";

  const isConverting = /^Converting\b/i.test(currentMessage);
  const isPreparing = /^(Prepared\b|Preparing)/i.test(currentMessage);
  const isVerifying =
    /^(Verifying|Consolidating|Merging|Retrying)\b/i.test(currentMessage);
  const isExtractingSourceUnit = /^Extracting\b/i.test(currentMessage);
  // Non-PDF uploads are converted to a paginated PDF first; surface that as the
  // leading step. The original file name keeps its extension after conversion,
  // so it reliably tells us whether this document needed converting.
  const requiresConversion = getSupportedExtension(document.fileName) !== ".pdf";

  // Before the page count is known (conversion + preparation report
  // `totalSteps: 0`), show a skeleton so the step list — and the active
  // "Convert to PDF" step — stay visible instead of collapsing to one line.
  if (totalSteps <= 0) {
    const skeleton: { label: string; status: StepStatus }[] = [];
    if (requiresConversion) {
      skeleton.push({
        label: "Convert to PDF",
        status: isConverting ? "active" : "complete",
      });
    }
    skeleton.push({
      label: "Prepare pages",
      status: isConverting ? "pending" : "active",
    });
    skeleton.push({ label: "Verify result", status: "pending" });
    return skeleton;
  }

  // Progress is reported in pages: `totalSteps` is the page count plus one final
  // verify step, and `currentStep` is the number of pages completed so far.
  const totalPages = Math.max(totalSteps - 1, 0);
  const steps: { label: string; status: StepStatus }[] = [];

  if (requiresConversion) {
    steps.push({
      label: "Convert to PDF",
      status: isConverting ? "active" : "complete",
    });
  }

  steps.push({
    label: "Prepare pages",
    status: isConverting ? "pending" : isPreparing ? "active" : "complete",
  });

  // Show real page ranges grouped the same few-pages-at-a-time the extractor
  // uses, so progress visibly jumps a group at a time ("Extract pages 4–6")
  // instead of crawling page by page. A group completes once all its pages are
  // done; the frontier group is active while extracting.
  for (
    let firstPage = 1;
    firstPage <= totalPages;
    firstPage += DISPLAY_PAGES_PER_GROUP
  ) {
    const lastPage = Math.min(firstPage + DISPLAY_PAGES_PER_GROUP - 1, totalPages);
    let status: StepStatus = "pending";

    if (currentStep >= lastPage) {
      status = "complete";
    } else if (isExtractingSourceUnit && currentStep >= firstPage - 1) {
      status = "active";
    }

    steps.push({
      label:
        firstPage === lastPage
          ? `Extract page ${firstPage}`
          : `Extract pages ${firstPage}–${lastPage}`,
      status,
    });
  }

  steps.push({
    label: "Verify result",
    status:
      currentStep >= totalSteps
        ? "complete"
        : isVerifying || (!isExtracting && currentStep >= totalPages)
          ? "active"
          : "pending",
  });

  return steps;
}
