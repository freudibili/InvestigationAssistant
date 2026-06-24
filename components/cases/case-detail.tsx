"use client";

import { UploadDocument } from "@/components/documents/upload-document";
import { DocumentList } from "@/components/documents/document-list";
import { CaseTypeControl } from "@/components/cases/case-type-control";
import { DeleteCaseDialog } from "@/components/cases/delete-case-dialog";
import { useCase } from "@/hooks/use-case";
import type { Case, CaseDocument } from "@/lib/types";

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CaseTypeControl investigationCase={investigationCase} />
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {investigationCase.title}
          </h1>
          <p className="text-muted-foreground text-sm">
            {investigationCase.companyName}
          </p>
        </div>
        <DeleteCaseDialog
          caseId={caseId}
          caseTitle={investigationCase.title}
        />
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
