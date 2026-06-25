"use client";

import { UploadDocument } from "@/features/documents/components/upload-document";
import { DocumentFileRow } from "@/features/documents/components/document-file-row";
import { useCase } from "@/hooks/use-case";
import type { Case, CaseDocument } from "@/lib/types";

/**
 * The Documents tab: upload transcripts and manage the uploaded files. Reads the
 * shared case query (seeded by the case layout) so uploads and deletes reflect
 * instantly across tabs.
 */
export function DocumentsPanel({
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
    <div className="space-y-8">
      <UploadDocument caseId={caseId} />

      <div className="space-y-3">
        <h2 className="text-sm font-medium">
          Documents{" "}
          <span className="text-muted-foreground">({documents.length})</span>
        </h2>
        {documents.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            No documents yet. Upload interview transcripts to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {documents.map((document) => (
              <DocumentFileRow key={document.id} document={document} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
