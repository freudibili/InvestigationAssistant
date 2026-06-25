import { notFound } from "next/navigation";

import { getCase } from "@/lib/db/cases";
import { listDocumentsForCase } from "@/lib/db/documents";
import { getCaseAnalysis } from "@/features/investigation-analysis/lib/db";
import { AnalysisPanel } from "@/features/investigation-analysis/components/analysis-panel";

export const dynamic = "force-dynamic";

export default async function CaseAnalysisPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const investigationCase = await getCase(caseId);
  if (!investigationCase) notFound();

  const [documents, analysis] = await Promise.all([
    listDocumentsForCase(caseId),
    getCaseAnalysis(caseId),
  ]);

  return (
    <AnalysisPanel
      caseId={caseId}
      initialCase={investigationCase}
      initialDocuments={documents}
      initialAnalysis={analysis}
    />
  );
}
