import { notFound } from "next/navigation";

import { getCase } from "@/lib/db/cases";
import { listDocumentsForCase } from "@/lib/db/documents";
import { ExtractionPanel } from "@/features/extraction/components/extraction-panel";

export const dynamic = "force-dynamic";

export default async function CaseExtractionPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const investigationCase = await getCase(caseId);
  if (!investigationCase) notFound();

  const documents = await listDocumentsForCase(caseId);

  return (
    <ExtractionPanel
      caseId={caseId}
      initialCase={investigationCase}
      initialDocuments={documents}
    />
  );
}
