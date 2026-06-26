import Link from "next/link";
import { FilePenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCaseAnalysis } from "@/features/investigation-analysis/lib/db";
import { ReportDraftCard } from "@/features/report-generation/components/report-draft-card";

export const dynamic = "force-dynamic";

export default async function CaseReportPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const { analysis } = await getCaseAnalysis(caseId);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <FilePenLine className="text-muted-foreground size-5" />
          <h2 className="text-xl font-semibold tracking-tight">Report Draft</h2>
        </div>
        <p className="text-muted-foreground text-sm">
          Generate an editable investigation report from the approved dashboard
          analysis.
        </p>
      </div>

      {analysis ? (
        <ReportDraftCard caseId={caseId} analysis={analysis} />
      ) : (
        <div className="space-y-4 rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Run and review the investigation analysis before generating a report
            draft.
          </p>
          <Button asChild variant="outline">
            <Link href={`/cases/${caseId}/analysis`}>Open analysis</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
