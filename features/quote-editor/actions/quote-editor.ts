"use server";

import { revalidatePath } from "next/cache";

import { correctQuote } from "@/features/quote-editor/lib/correct-quote";
import { quoteCorrectionSchema } from "@/features/quote-editor/validation";
import type { CaseDocument } from "@/lib/types";

export type QuoteCorrectionResult =
  | { ok: true; document: CaseDocument; sourceChanged: boolean }
  | { ok: false; message: string };

export async function saveQuoteCorrectionAction(
  input: unknown,
): Promise<QuoteCorrectionResult> {
  const parsed = quoteCorrectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "The quote correction is not valid." };
  }

  try {
    const result = await correctQuote(parsed.data);
    revalidateQuoteCorrectionPaths(result.document);
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not correct the quote.",
    };
  }
}

function revalidateQuoteCorrectionPaths(document: CaseDocument): void {
  revalidatePath(`/cases/${document.caseId}/extraction`);
  revalidatePath(`/cases/${document.caseId}/extraction/${document.id}`);
  revalidatePath(`/cases/${document.caseId}/analysis`);
}
