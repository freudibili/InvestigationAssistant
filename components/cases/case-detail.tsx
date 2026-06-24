"use client";

import { UploadDocument } from "@/components/documents/upload-document";
import { DocumentList } from "@/components/documents/document-list";
import { useCase } from "@/hooks/use-case";
import { CASE_TYPE_LABELS, type Case, type CaseDocument } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

export function CaseDetail({
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

  const investigationCase = data?.case ?? initialCase;
  const documents = data?.documents ?? initialDocuments;

  return (
    <div className="space-y-8">
      <div>
        <Badge variant="outline">
          {CASE_TYPE_LABELS[investigationCase.caseType]}
        </Badge>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {investigationCase.title}
        </h1>
        <p className="text-muted-foreground text-sm">
          {investigationCase.companyName}
        </p>
      </div>

      <UploadDocument caseId={caseId} />

      <div className="space-y-3">
        <h2 className="text-sm font-medium">
          Documents{" "}
          <span className="text-muted-foreground">({documents.length})</span>
        </h2>
        <DocumentList documents={documents} />
      </div>
    </div>
  );
}
