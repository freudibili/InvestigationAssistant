import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UserSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCaseAnalysis } from "@/features/investigation-analysis/lib/db";
import type { ConsolidatedWitness } from "@/features/investigation-analysis/types";

export const dynamic = "force-dynamic";

export default async function WitnessesPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const { analysis } = await getCaseAnalysis(caseId);
  if (!analysis) notFound();

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="px-0">
        <Link href={`/cases/${caseId}/analysis`}>
          <ArrowLeft />
          Investigation analysis
        </Link>
      </Button>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <UserSearch className="text-muted-foreground size-5" />
          <h2 className="text-xl font-semibold tracking-tight">Witnesses</h2>
        </div>
        <p className="text-muted-foreground text-sm">
          {analysis.witnesses.length} witness
          {analysis.witnesses.length === 1 ? "" : "es"} from the saved analysis.
        </p>
      </div>

      {analysis.witnesses.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No witnesses identified.
        </p>
      ) : (
        <div className="space-y-3">
          {analysis.witnesses.map((witness) => (
            <WitnessItem key={witness.name} witness={witness} />
          ))}
        </div>
      )}
    </div>
  );
}

function WitnessItem({ witness }: { witness: ConsolidatedWitness }) {
  return (
    <article className="space-y-2 rounded-lg border p-4">
      <h3 className="text-sm font-medium">{witness.name}</h3>
      {witness.whyTheyMatter ? (
        <p className="text-sm leading-relaxed">{witness.whyTheyMatter}</p>
      ) : null}
      {witness.relatedAllegations.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          Related allegations: {witness.relatedAllegations.join(", ")}
        </p>
      ) : null}
    </article>
  );
}
