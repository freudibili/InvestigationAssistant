import { z } from "zod";

export const reportLanguageSchema = z.enum(["en", "fr", "de"]);
export type ReportLanguage = z.infer<typeof reportLanguageSchema>;

export const reportCoherenceIssueSchema = z.object({
  subject: z.string(),
  versionA: z.string(),
  versionB: z.string(),
  recommendation: z.string(),
});

export const reportDraftSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") return value;

    const draft = value as {
      content?: unknown;
      generatedContent?: unknown;
      editedContent?: unknown;
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
