import { z } from "zod";

/**
 * Schemas for the cross-interview Investigation Analysis.
 *
 * Two shapes live here:
 * - `analysisResponseSchema`: the reasoning-only object the LLM returns. It
 *   references evidence by *id* (quote ids, interview ids, allegation ids) and
 *   never reproduces quote text — that keeps generated text un-clickable.
 * - `investigationAnalysisSchema`: the full persisted/dashboard object, which
 *   adds the deterministic aggregates (catalog, counts, timeline, parties,
 *   people, witnesses) the server builds around the AI sections.
 */

const stringArray = z.array(z.string()).default([]);

/** A resolved, clickable piece of evidence. The only thing the UI links to. */
export const quoteRefSchema = z.object({
  id: z.string(),
  provenanceId: z.string().nullable().default(null),
  text: z.string(),
  speaker: z.string().nullable().default(null),
  intervieweeName: z.string().nullable().default(null),
  intervieweeRole: z.enum(["claimant", "accused", "witness"]).nullable().default(null),
  /** 1-based PDF page, or null when the source had no real pagination. */
  page: z.number().int().positive().nullable().default(null),
  charStart: z.number().int().nonnegative().nullable().default(null),
  charEnd: z.number().int().nonnegative().nullable().default(null),
  pageCharStart: z.number().int().nonnegative().nullable().default(null),
  pageCharEnd: z.number().int().nonnegative().nullable().default(null),
  normalizedPageCharStart: z.number().int().nonnegative().nullable().default(null),
  normalizedPageCharEnd: z.number().int().nonnegative().nullable().default(null),
  documentId: z.string(),
  documentName: z.string(),
});

export const interviewRefSchema = z.object({
  id: z.string(),
  /** Interviewee name (falls back to the file name). */
  name: z.string(),
  documentName: z.string(),
});

/**
 * A clickable source location without a verbatim quote (e.g. a timeline event's
 * page). Opens the PDF at the page; no text is highlighted. Quotes remain the
 * primary, highlighted evidence — this is only for items extraction stored with
 * a page but no quote.
 */
export const sourceRefSchema = z.object({
  documentId: z.string(),
  documentName: z.string(),
  page: z.number().int().positive().nullable().default(null),
  label: z.string(),
});

/** Whether a grievance describes a recurring pattern or a one-off incident. */
const grievanceTypeSchema = z
  .enum(["Recurring", "Incident", "Unclear"])
  .default("Unclear");

/**
 * The investigator's finding on a grievance after triangulating the accounts.
 * "Word against word" is the report's "parole contre parole" — directly
 * conflicting accounts with no corroborating evidence either way.
 */
const verdictSchema = z
  .enum([
    "Supported",
    "Partially supported",
    "Not established",
    "Word against word",
    "Requires investigator assessment",
  ])
  .default("Requires investigator assessment");

const confidenceSchema = z.number().int().min(0).max(100).default(0);

/**
 * How a reproche is grounded in the case material. Only the first five values
 * justify a standalone reproche; "context_only" material may inform findings but
 * must never become its own allegation. Defaults to "context_only" so a reproche
 * the model fails to ground is treated as ungrounded (and dropped) rather than
 * silently promoted to a real allegation.
 */
export const reproachSourceBasisSchema = z
  .enum([
    "explicit_claimant_allegation",
    "explicit_accused_response",
    "explicit_reference_concern",
    "documented_incident",
    "source_grounded_pattern",
    "context_only",
  ])
  .default("context_only");

export type ReproachSourceBasis = z.infer<typeof reproachSourceBasisSchema>;

/**
 * Internal guard flagging how far a reproche's wording risks running ahead of
 * its source. Defaults to "high" so an unassessed reproche is treated as the
 * riskiest case until proven otherwise.
 */
export const amplificationRiskSchema = z
  .enum(["low", "medium", "high"])
  .default("high");

export type AmplificationRisk = z.infer<typeof amplificationRiskSchema>;

export const conductAssessmentCategorySchema = z.enum([
  "Mobbing",
  "Sexual harassment",
  "Violence",
  "Racism",
]);

export const conductAssessmentStatusSchema = z.enum([
  "Likely indicated",
  "Possible",
  "Not indicated",
  "Insufficient information",
]);

export const mobbingFactorSchema = z.enum([
  "Expression and communication",
  "Social relations",
  "Professional reputation",
  "Working conditions",
  "Health",
]);

export const conductAssessmentSchema = z.object({
  categories: z
    .array(
      z.object({
        category: conductAssessmentCategorySchema,
        status: conductAssessmentStatusSchema,
        confidence: confidenceSchema,
        rationale: z.string().default(""),
        supportingFactors: z.array(z.string()).default([]),
        missingInformation: z.array(z.string()).default([]),
      })
    )
    .default([]),
  mobbingFactors: z.array(mobbingFactorSchema).default([]),
  mobbingFactorAssessments: z
    .array(
      z.object({
        factor: mobbingFactorSchema,
        confidence: confidenceSchema,
        rationale: z.string().default(""),
      })
    )
    .default([]),
  missingInformation: z.array(z.string()).default([]),
  overallCaution: z.string().default(""),
});

export type ConductAssessment = z.infer<typeof conductAssessmentSchema>;

// ---------------------------------------------------------------------------
// AI response (reasoning sections only; references by id)
// ---------------------------------------------------------------------------

/**
 * One party's account of a grievance. `interviewId` ties the summary back to a
 * real interview (so the role can be labelled with the interviewee's name);
 * `quoteIds` reference verbatim evidence the dashboard resolves and links. A
 * null `interviewId` means this role was not interviewed (e.g. a missing
 * account) — the slot is still rendered so the gap is visible.
 */
const aiStatementSchema = z.object({
  interviewId: z.string().nullable().default(null),
  summary: z.string().default(""),
  quoteIds: stringArray,
});

/**
 * A single grievance ("reproche"), triangulated across the parties — the core
 * unit of the report's Section 5. Each carries the claimant's account, the
 * accused's account, any reference persons' accounts, and a findings/evaluation
 * block reaching a verdict.
 */
const aiReprocheSchema = z.object({
  id: z.string(),
  title: z.string(),
  grievanceType: grievanceTypeSchema,
  /**
   * Internal: which kind of source material grounds this reproche. Reproches
   * tagged "context_only" are dropped during merge — they must not stand as
   * their own allegation. Not rendered to investigators.
   */
  sourceBasis: reproachSourceBasisSchema,
  sourceBasisInterviewIds: stringArray,
  sourceBasisQuoteIds: stringArray,
  sourceBasisEventIds: stringArray,
  /**
   * Internal: how far the title/summary risks overstating the source. Used to
   * pressure the model toward cautious wording and merging; not rendered.
   */
  amplificationRisk: amplificationRiskSchema,
  description: z.string().default(""),
  claimantStatement: aiStatementSchema.default({
    interviewId: null,
    summary: "",
    quoteIds: [],
  }),
  accusedStatement: aiStatementSchema.default({
    interviewId: null,
    summary: "",
    quoteIds: [],
  }),
  /** Reference persons in order — rendered as "Reference person 1", "2", … */
  referenceStatements: z.array(aiStatementSchema).default([]),
  /** Bullet points of convergences and divergences across the accounts. */
  findings: stringArray,
  /** Prose evaluation triangulating the accounts and justifying the verdict. */
  evaluation: z.string().default(""),
  verdict: verdictSchema,
  openQuestions: stringArray,
  relatedEventIds: stringArray,
  conductAssessment: conductAssessmentSchema.nullable().default(null),
});

const aiGapsSchema = z.object({
  missingInterviews: stringArray,
  missingEvidence: stringArray,
  missingClarification: stringArray,
});

export const analysisResponseSchema = z.object({
  scopeSummary: z.string().default(""),
  reproches: z.array(aiReprocheSchema).default([]),
  /** Case-level synthesis across all grievances (the report's §6). */
  globalAssessment: z.string().default(""),
  gaps: aiGapsSchema.default({
    missingInterviews: [],
    missingEvidence: [],
    missingClarification: [],
  }),
});

export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;

// ---------------------------------------------------------------------------
// Persisted analysis (AI sections + deterministic aggregates)
// ---------------------------------------------------------------------------

const partySchema = z.object({
  personId: z.string(),
  canonicalName: z.string(),
  caseRole: z.enum([
    "claimant",
    "accused",
    "reference_person",
    "witness",
    "investigator",
  ]),
  jobRole: z.string().nullable().default(null),
  interviewDocumentId: z.string(),
  interviewDocumentName: z.string(),
  aliases: stringArray,
});

/** Persisted reproche shape == the AI shape (statements reference ids the dashboard resolves). */
const reprocheSchema = aiReprocheSchema;

const timelineEventSchema = z.object({
  id: z.string(),
  date: z.string().nullable().default(null),
  description: z.string(),
  participants: stringArray,
  interviewIds: stringArray,
  sources: z.array(sourceRefSchema).default([]),
});

const personProfileSchema = z.object({
  name: z.string(),
  interviewIds: stringArray,
  relatedReprocheIds: stringArray,
  supportingQuoteIds: stringArray,
  eventIds: stringArray,
  witnesses: stringArray,
});

const witnessSchema = z.object({
  name: z.string(),
  interviewIds: stringArray,
  relatedAllegations: stringArray,
  whyTheyMatter: z.string().default(""),
});

export const investigationAnalysisSchema = z.object({
  generatedAt: z.string(),
  interviewCount: z.number().int().nonnegative().default(0),
  reprocheCount: z.number().int().nonnegative().default(0),
  witnessCount: z.number().int().nonnegative().default(0),
  eventCount: z.number().int().nonnegative().default(0),
  scopeSummary: z.string().default(""),
  globalAssessment: z.string().default(""),
  overallConductAssessment: conductAssessmentSchema.nullable().default(null),
  interviews: z.array(interviewRefSchema).default([]),
  quotes: z.array(quoteRefSchema).default([]),
  mainParties: z.array(partySchema).default([]),
  reproches: z.array(reprocheSchema).default([]),
  timeline: z.array(timelineEventSchema).default([]),
  people: z.array(personProfileSchema).default([]),
  witnesses: z.array(witnessSchema).default([]),
  gaps: aiGapsSchema.default({
    missingInterviews: [],
    missingEvidence: [],
    missingClarification: [],
  }),
});

export type InvestigationAnalysis = z.infer<typeof investigationAnalysisSchema>;
