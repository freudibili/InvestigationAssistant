"use client";

import { ExtractionBoard } from "@/features/extraction/components/extraction-board";
import { useCase } from "@/hooks/use-case";
import type { Case, CaseDocument } from "@/lib/types";

/**
 * The Extraction tab: run, cancel, retry, and review AI extraction per document.
 * Reads the shared case query so progress and status stay live across tabs.
 */
export function ExtractionPanel({
  caseId,
  initialCase,
  initialDocuments,
}: {
  caseId: string;
  initialCase: Case;
  initialDocuments: CaseDocument[];
}) {
  const { data } = useCase(caseId, {
    case: initialCase,
    documents: initialDocuments,
  });
  const documents = data?.documents ?? initialDocuments;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">
        Interviews{" "}
        <span className="text-muted-foreground">({documents.length})</span>
      </h2>
      <ExtractionBoard documents={documents} />
    </div>
  );
}
