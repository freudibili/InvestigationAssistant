import { NextResponse } from "next/server";

import { getCase } from "@/lib/db/cases";
import { getCaseAnalysis } from "@/features/investigation-analysis/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  try {
    const { caseId } = await params;
    const investigationCase = await getCase(caseId);
    if (!investigationCase) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    const analysis = await getCaseAnalysis(caseId);
    return NextResponse.json(analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
