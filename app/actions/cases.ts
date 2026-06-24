"use server";

import { revalidatePath } from "next/cache";
import { createCase } from "@/lib/db/cases";
import { createCaseSchema, type CreateCaseInput } from "@/lib/validation";
import type { Case } from "@/lib/types";

export async function createCaseAction(input: CreateCaseInput): Promise<Case> {
  const parsed = createCaseSchema.parse(input);
  const created = await createCase(parsed);
  revalidatePath("/");
  return created;
}
