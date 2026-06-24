import { listCases } from "@/lib/db/cases";
import { getDatabaseEnvironmentIssues } from "@/lib/env";
import { CaseList } from "@/components/cases/case-list";
import { CreateCaseDialog } from "@/components/cases/create-case-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const environmentIssues = getDatabaseEnvironmentIssues();
  if (environmentIssues.length > 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Supabase setup needed</CardTitle>
            <CardDescription>
              Add your real Supabase project values before loading cases.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              {environmentIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              Update <code className="font-mono text-foreground">.env</code> or{" "}
              <code className="font-mono text-foreground">.env.local</code>,
              then restart the dev server.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

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
