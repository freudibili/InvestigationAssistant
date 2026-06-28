import { z } from "zod";

export const reportLanguageSchema = z.enum(["en", "fr", "de"]);
export type ReportLanguage = z.infer<typeof reportLanguageSchema>;

export const reportCoherenceIssueSchema = z.object({
  subject: z.string(),
  versionA: z.string(),
  versionB: z.string(),
  recommendation: z.string(),
});

export const reportSectionTypeSchema = z.enum(["manual", "generated", "custom"]);

export const reportSectionSourceSchema = z.enum([
  "template",
  "caseMetadata",
  "analysis",
  "globalAssessment",
]);

export type ReportSection = {
  id: string;
  number: string;
  title: string;
  type: z.infer<typeof reportSectionTypeSchema>;
  source?: z.infer<typeof reportSectionSourceSchema>;
  content: string;
  placeholder?: string;
  editedContent?: string | null;
  children?: ReportSection[];
};

export const reportSectionSchema: z.ZodType<ReportSection> = z.lazy(() =>
  z.object({
    id: z.string(),
    number: z.string(),
    title: z.string(),
    type: reportSectionTypeSchema,
    source: reportSectionSourceSchema.optional(),
    content: z.string(),
    placeholder: z.string().optional(),
    editedContent: z.string().nullable().optional(),
    children: z.array(reportSectionSchema).default([]),
  })
);

export const reportDraftSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") return value;

    const draft = value as {
      content?: unknown;
      generatedContent?: unknown;
      editedContent?: unknown;
      sections?: unknown;
    };

    if (typeof draft.generatedContent === "string") return value;
    if (typeof draft.content !== "string") return value;

    return {
      ...draft,
      generatedContent: draft.content,
      editedContent:
        typeof draft.editedContent === "string" ? draft.editedContent : null,
    };
  },
  z.object({
    generatedAt: z.string(),
    generatedContent: z.string(),
    editedContent: z.string().nullable().default(null),
    sections: z.array(reportSectionSchema).default([]),
    coherence: z.object({
      status: z.enum(["coherent", "issues_found"]),
      issues: z.array(reportCoherenceIssueSchema).default([]),
    }),
  })
);

export type ReportDraft = z.infer<typeof reportDraftSchema>;

export const reportGenerationStateSchema = z.object({
  status: z.enum(["idle", "generating", "complete", "failed"]).default("idle"),
  runId: z.string().nullable().default(null),
  currentStep: z.string().nullable().default(null),
  currentStepIndex: z.number().int().nonnegative().default(0),
  totalSteps: z.number().int().positive().default(6),
  errorMessage: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});

export type ReportGenerationState = z.infer<typeof reportGenerationStateSchema>;
