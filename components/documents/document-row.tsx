"use client";

import Link from "next/link";
import { FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/documents/status-badge";
import { useExtractDocument } from "@/hooks/use-documents";
import type { CaseDocument } from "@/lib/types";

export function DocumentRow({ document }: { document: CaseDocument }) {
  const extract = useExtractDocument(document.caseId);
  const isExtracting =
    document.status === "extracting" || extract.isPending;
  const progress =
    document.extractionTotalSteps > 0
      ? Math.round(
          (document.extractionCurrentStep / document.extractionTotalSteps) * 100
        )
      : 8;

  async function handleExtract() {
    try {
      await extract.mutateAsync(document.id);
      toast.success("Extraction complete.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Extraction failed."
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
              <StatusBadge status={document.status} />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {document.status === "extracted" ? (
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
                disabled={isExtracting}
              >
                <Sparkles />
                Re-extract
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={handleExtract}
              disabled={isExtracting}
            >
              <Sparkles />
              {isExtracting
                ? "Extracting..."
                : document.status === "failed"
                  ? "Retry Extraction"
                  : "Extract Interview Data"}
            </Button>
          )}
        </div>
      </div>

      {isExtracting ? (
        <div className="mt-4 space-y-2">
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
            <span className="truncate">
              {document.extractionStep ?? "Preparing document"}
            </span>
            {document.extractionTotalSteps > 0 ? (
              <span className="shrink-0 tabular-nums">
                {document.extractionCurrentStep}/{document.extractionTotalSteps}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
