import { NextResponse } from "next/server";
import { listCases } from "@/lib/db/cases";

export async function GET() {
  try {
    const cases = await listCases();
    return NextResponse.json({ cases });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
