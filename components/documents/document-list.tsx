"use client";

import { DocumentRow } from "@/components/documents/document-row";
import type { CaseDocument } from "@/lib/types";

export function DocumentList({ documents }: { documents: CaseDocument[] }) {
  if (documents.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
        No documents yet. Upload interview transcripts to get started.
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
