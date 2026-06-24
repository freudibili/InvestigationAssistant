import { listCases } from "@/lib/db/cases";
import { CaseList } from "@/components/cases/case-list";
import { CreateCaseDialog } from "@/components/cases/create-case-dialog";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cases = await listCases();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cases</h1>
          <p className="text-muted-foreground text-sm">
            Workplace investigation workspaces.
          </p>
        </div>
        <CreateCaseDialog />
      </div>

      <CaseList initialCases={cases} />
    </div>
  );
}
