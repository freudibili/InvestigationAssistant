import { z } from "zod";
import { CASE_TYPES } from "@/lib/types";

const nullableMetadataString = z.preprocess((value) => {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (
    !trimmed ||
    ["null", "n/a", "unknown", "not found"].includes(trimmed.toLowerCase())
  ) {
    return null;
  }

  return trimmed;
}, z.string().nullable());

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
  // Optional: the type is often unknown when a case is first opened. It can be
  // suggested by the AI later, or set by the investigator at any time.
  caseType: z.enum(CASE_TYPES).optional(),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;

/**
 * Input for explicitly setting a case's type (confirming a suggestion or
 * overriding it). `null` clears the type back to "unclassified".
 */
export const setCaseTypeSchema = z.object({
  caseType: z.enum(CASE_TYPES).nullable(),
});

export type SetCaseTypeInput = z.infer<typeof setCaseTypeSchema>;

/**
 * Schema the LLM response must satisfy. Kept tolerant where the source
 * transcript may simply not contain the information (nullable metadata),
 * but strict about the overall shape so failures are caught early.
 */
export const extractedDataSchema = z.object({
  intervieweeName: nullableMetadataString,
  interviewDate: nullableMetadataString,
  role: nullableMetadataString,
  interviewerNames: z.array(z.string()).default([]),
  extractionWarnings: z.array(z.string()).default([]),
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

/**
 * Full LLM response: the per-document extracted data plus a best-guess case
 * type. `suggestedCaseType` is null when the transcript doesn't clearly point to
 * one — we never force a classification.
 */
export const extractionResponseSchema = extractedDataSchema.extend({
  suggestedCaseType: z.enum(CASE_TYPES).nullable(),
});

export type ExtractionResponse = z.infer<typeof extractionResponseSchema>;
