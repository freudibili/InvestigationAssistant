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
    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
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
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/cases/${document.caseId}/documents/${document.id}`}
            >
              View Result
            </Link>
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleExtract}
            disabled={isExtracting}
          >
            <Sparkles />
            {isExtracting
              ? "Extracting…"
              : document.status === "failed"
                ? "Retry Extraction"
                : "Extract Interview Data"}
          </Button>
        )}
      </div>
    </div>
  );
}
