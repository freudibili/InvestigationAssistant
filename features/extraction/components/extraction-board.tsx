"use client";

import { DocumentRow } from "@/features/extraction/components/document-row";
import type { CaseDocument } from "@/lib/types";

export function ExtractionBoard({ documents }: { documents: CaseDocument[] }) {
  if (documents.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
        No documents to extract yet. Upload interview transcripts in the
        Documents tab to get started.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {documents.map((document) => (
        <DocumentRow key={document.id} document={document} />
      ))}
    </div>
  );
}
