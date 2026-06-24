"use server";

import { revalidatePath } from "next/cache";
import { createCase, deleteCase, setCaseType } from "@/lib/db/cases";
import {
  createCaseSchema,
  setCaseTypeSchema,
  type CreateCaseInput,
  type SetCaseTypeInput,
} from "@/lib/validation";
import type { Case } from "@/lib/types";

export async function createCaseAction(input: CreateCaseInput): Promise<Case> {
  const parsed = createCaseSchema.parse(input);
  const created = await createCase(parsed);
  revalidatePath("/");
  return created;
}

export async function deleteCaseAction(caseId: string): Promise<void> {
  if (!caseId) throw new Error("Missing case id.");

  await deleteCase(caseId);
  revalidatePath("/");
  revalidatePath(`/cases/${caseId}`);
}

/** Confirm an AI suggestion or override the case type (null = unclassify). */
export async function setCaseTypeAction(
  caseId: string,
  input: SetCaseTypeInput
): Promise<Case> {
  const { caseType } = setCaseTypeSchema.parse(input);
  const updated = await setCaseType(caseId, caseType);
  revalidatePath("/");
  revalidatePath(`/cases/${caseId}`);
  return updated;
}
