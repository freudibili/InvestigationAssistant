import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getDocument } from "@/lib/db/documents";
import { ExtractionResult } from "@/components/documents/extraction-result";
import { StatusBadge } from "@/components/documents/status-badge";

export const dynamic = "force-dynamic";

export default async function DocumentResultPage({
  params,
}: {
  params: Promise<{ caseId: string; documentId: string }>;
}) {
  const { caseId, documentId } = await params;
  const document = await getDocument(documentId);

  if (!document || document.caseId !== caseId) notFound();

  return (
    <div className="space-y-6">
      <Link
        href={`/cases/${caseId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        Back to case
      </Link>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {document.fileName}
          </h1>
          <p className="text-muted-foreground text-sm">Extraction result</p>
        </div>
        <StatusBadge status={document.status} />
      </div>

      <ExtractionResult document={document} />
    </div>
  );
}
