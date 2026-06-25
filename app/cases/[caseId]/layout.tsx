import { notFound } from "next/navigation";

import { getCase } from "@/lib/db/cases";
import { listDocumentsForCase } from "@/lib/db/documents";
import { CaseChrome } from "@/components/cases/case-chrome";

export const dynamic = "force-dynamic";

export default async function CaseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const investigationCase = await getCase(caseId);
  if (!investigationCase) notFound();

  const documents = await listDocumentsForCase(caseId);

  return (
    <CaseChrome
      caseId={caseId}
      initialCase={investigationCase}
      initialDocuments={documents}
    >
      {children}
    </CaseChrome>
  );
}
