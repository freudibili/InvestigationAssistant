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
