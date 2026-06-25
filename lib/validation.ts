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

const sourcePagesSchema = z.array(z.string()).default([]);

// The model is asked for `{ description, sourcePages }` objects, but for some
// fields (notably findingReadiness.*) it occasionally emits a bare string —
// likely because evidenceAssessment reuses the same field names as plain
// `string[]`. Coerce a lone string into an evidence item so one shape slip
// doesn't fail the entire document extraction. Downstream normalization trims
// and drops empty descriptions.
const evidenceItemSchema = z.preprocess(
  (value) => (typeof value === "string" ? { description: value } : value),
  z.object({
    description: z.string(),
    sourcePages: sourcePagesSchema,
  })
);

const identityItemSchema = z.object({
  canonicalName: z.string(),
  variants: z.array(z.string()).default([]),
  role: nullableMetadataString.default(null),
  sourcePages: sourcePagesSchema,
});

const quoteItemSchema = z.object({
  speaker: nullableMetadataString.default(null),
  text: z.string(),
  sourcePages: sourcePagesSchema,
});

const eventItemSchema = z.object({
  date: nullableMetadataString.default(null),
  description: z.string(),
  participants: z.array(z.string()).default([]),
  sourcePages: sourcePagesSchema,
});

const witnessItemSchema = z.object({
  name: z.string(),
  relevance: z.string(),
  sourcePages: sourcePagesSchema,
});

const consolidatedWitnessSchema = z.object({
  name: z.string(),
  whyTheyMatter: z.string(),
  relatedAllegations: z.array(z.string()).default([]),
  mentionedInInterviews: z.array(z.string()).default([]),
  priorityScore: z.coerce.number().min(0).max(100).default(50),
  sourcePages: sourcePagesSchema,
});

const allegationItemSchema = z.object({
  date: nullableMetadataString.default(null),
  claimant: nullableMetadataString.default(null),
  subject: nullableMetadataString.default(null),
  classification: z.enum(["primary", "secondary"]).default("primary"),
  allegation: z.string().optional(),
  description: z.string(),
  supportingEvidence: z.array(evidenceItemSchema).default([]),
  contradictoryEvidence: z.array(evidenceItemSchema).default([]),
  missingEvidence: z.array(z.string()).default([]),
  relevantQuotes: z.array(quoteItemSchema).default([]),
  witnesses: z.array(witnessItemSchema).default([]),
  followUpQuestions: z.array(z.string()).default([]),
  riskAreas: z.array(z.string()).default([]),
  sourcePages: sourcePagesSchema,
});

const investigationAssessmentSchema = z.object({
  allegation: z.string(),
  strengthOfSupportingEvidence: z.string(),
  strengthOfContradictoryEvidence: z.string(),
  confidenceLevel: z.string(),
  supportableFindings: z.array(z.string()).default([]),
  unprovenFindings: z.array(z.string()).default([]),
  evidenceToCollect: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([]),
  recommendedActions: z.array(z.string()).default([]),
  sourcePages: sourcePagesSchema,
});

const investigationScopeSchema = z.object({
  primaryClaimants: z.array(z.string()).default([]),
  primaryAccused: z.array(z.string()).default([]),
  scopeSummary: z.string().default(""),
  primaryAllegations: z.array(z.string()).default([]),
  secondaryObservations: z.array(z.string()).default([]),
  sourcePages: sourcePagesSchema,
});

const findingReadinessSchema = z.object({
  supportableFindings: z.array(evidenceItemSchema).default([]),
  unprovenFindings: z.array(evidenceItemSchema).default([]),
  evidenceToCollect: z.array(evidenceItemSchema).default([]),
});

const interviewPositionSchema = z.object({
  classification: z
    .enum([
      "Supports claimant",
      "Supports accused",
      "Mixed / nuanced",
      "Neutral witness",
      "Unknown",
    ])
    .default("Unknown"),
  rationale: z.string(),
  sourcePages: sourcePagesSchema,
});

const pageFindingSchema = z.object({
  sourcePage: z.string(),
  allegations: z.array(allegationItemSchema).default([]),
  factualStatements: z.array(evidenceItemSchema).default([]),
  opinions: z.array(evidenceItemSchema).default([]),
  assumptions: z.array(evidenceItemSchema).default([]),
  hearsay: z.array(evidenceItemSchema).default([]),
  observations: z.array(evidenceItemSchema).default([]),
  notableQuotes: z.array(quoteItemSchema).default([]),
  supportingEvidence: z.array(evidenceItemSchema).default([]),
  contradictoryEvidence: z.array(evidenceItemSchema).default([]),
  potentialWitnesses: z.array(witnessItemSchema).default([]),
  relevantEvents: z.array(eventItemSchema).default([]),
});

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
  summary: z.string().default(""),
  investigationScope: investigationScopeSchema.default({
    primaryClaimants: [],
    primaryAccused: [],
    scopeSummary: "",
    primaryAllegations: [],
    secondaryObservations: [],
    sourcePages: [],
  }),
  allegations: z
    .array(allegationItemSchema)
    .default([]),
  peopleMentioned: z.array(z.string()).default([]),
  canonicalIdentities: z.array(identityItemSchema).default([]),
  keyEvents: z.array(eventItemSchema).default([]),
  notableQuotes: z.array(quoteItemSchema).default([]),
  factualStatements: z.array(evidenceItemSchema).default([]),
  opinions: z.array(evidenceItemSchema).default([]),
  assumptions: z.array(evidenceItemSchema).default([]),
  hearsay: z.array(evidenceItemSchema).default([]),
  observations: z.array(evidenceItemSchema).default([]),
  potentialWitnesses: z.array(witnessItemSchema).default([]),
  consolidatedWitnesses: z.array(consolidatedWitnessSchema).default([]),
  missingInformation: z.array(evidenceItemSchema).default([]),
  followUpQuestions: z.array(evidenceItemSchema).default([]),
  recommendedNextInterviews: z.array(evidenceItemSchema).default([]),
  riskAreas: z.array(evidenceItemSchema).default([]),
  findingReadiness: findingReadinessSchema.default({
    supportableFindings: [],
    unprovenFindings: [],
    evidenceToCollect: [],
  }),
  investigationImpact: z.string().default(""),
  interviewPosition: interviewPositionSchema.default({
    classification: "Unknown",
    rationale: "No interview position could be determined from the source.",
    sourcePages: [],
  }),
  evidenceAssessment: z.array(investigationAssessmentSchema).default([]),
  pageFindings: z.array(pageFindingSchema).default([]),
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
