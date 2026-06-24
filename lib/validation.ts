import { z } from "zod";
import { CASE_TYPES } from "@/lib/types";

/** Input for creating a new case (used by the form + server action). */
export const createCaseSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Title must be at least 2 characters.")
    .max(200, "Title is too long."),
  companyName: z
    .string()
    .trim()
    .min(1, "Company name is required.")
    .max(200, "Company name is too long."),
  caseType: z.enum(CASE_TYPES),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;

/**
 * Schema the LLM response must satisfy. Kept tolerant where the source
 * transcript may simply not contain the information (nullable metadata),
 * but strict about the overall shape so failures are caught early.
 */
export const extractedDataSchema = z.object({
  intervieweeName: z.string().nullable(),
  interviewDate: z.string().nullable(),
  role: z.string().nullable(),
  summary: z.string(),
  peopleMentioned: z.array(z.string()),
  keyEvents: z.array(
    z.object({
      description: z.string(),
    })
  ),
  notableQuotes: z.array(z.string()),
});

export type ExtractedDataInput = z.infer<typeof extractedDataSchema>;
