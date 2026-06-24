import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getCase } from "@/lib/db/cases";
import { listDocumentsForCase } from "@/lib/db/documents";
import { CaseDetail } from "@/components/cases/case-detail";

export const dynamic = "force-dynamic";

export default async function CasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const investigationCase = await getCase(caseId);
  if (!investigationCase) notFound();

  const documents = await listDocumentsForCase(caseId);

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        All cases
      </Link>

      <CaseDetail
        caseId={caseId}
        initialCase={investigationCase}
        initialDocuments={documents}
      />
    </div>
  );
}
