import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  redirect(`/cases/${caseId}/extraction`);
}
