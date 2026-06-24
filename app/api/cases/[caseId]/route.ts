import { NextResponse } from "next/server";
import { getCase } from "@/lib/db/cases";
import { listDocumentsForCase } from "@/lib/db/documents";

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
    const documents = await listDocumentsForCase(caseId);
    return NextResponse.json({ case: investigationCase, documents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
