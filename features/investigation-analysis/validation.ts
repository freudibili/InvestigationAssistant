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
  /** 1-based PDF page, or null when the source had no real pagination. */
  page: z.number().int().positive().nullable().default(null),
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

const repetitionSchema = z
  .enum(["Repeated", "Isolated", "Unclear"])
  .default("Unclear");
const systematicitySchema = z
  .enum(["Systematic", "Isolated", "Unclear"])
  .default("Unclear");

// ---------------------------------------------------------------------------
// AI response (reasoning sections only; references by id)
// ---------------------------------------------------------------------------

const aiAllegationSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(""),
  claimants: stringArray,
  subjects: stringArray,
  relatedInterviewIds: stringArray,
  supportingInterviewIds: stringArray,
  contradictoryInterviewIds: stringArray,
  supportingQuoteIds: stringArray,
  contradictoryQuoteIds: stringArray,
  relatedWitnesses: stringArray,
  relatedEventIds: stringArray,
  timelineConsistency: z.string().default(""),
  openQuestions: stringArray,
});

const aiPatternSchema = z.object({
  id: z.string(),
  title: z.string(),
  targets: stringArray,
  perpetrators: stringArray,
  relatedAllegationIds: stringArray,
  relatedInterviewIds: stringArray,
  supportingQuoteIds: stringArray,
  timelineConsistency: z.string().default(""),
  repetition: repetitionSchema,
  systematicity: systematicitySchema,
  missingEvidence: stringArray,
});

const aiContradictionSchema = z.object({
  id: z.string(),
  description: z.string(),
  interviewAId: z.string().nullable().default(null),
  interviewBId: z.string().nullable().default(null),
  quoteIdsA: stringArray,
  quoteIdsB: stringArray,
});

const aiGapsSchema = z.object({
  missingInterviews: stringArray,
  missingEvidence: stringArray,
  missingClarification: stringArray,
});

export const analysisResponseSchema = z.object({
  scopeSummary: z.string().default(""),
  allegations: z.array(aiAllegationSchema).default([]),
  mobbingPatterns: z.array(aiPatternSchema).default([]),
  contradictions: z.array(aiContradictionSchema).default([]),
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
  name: z.string(),
  role: z.string(),
  interviewIds: stringArray,
});

const mergedAllegationSchema = aiAllegationSchema;

const patternSchema = aiPatternSchema.extend({
  status: z.string().default("Requires investigator assessment"),
});

const contradictionSchema = aiContradictionSchema;

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
  relatedAllegationIds: stringArray,
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
  allegationCount: z.number().int().nonnegative().default(0),
  witnessCount: z.number().int().nonnegative().default(0),
  eventCount: z.number().int().nonnegative().default(0),
  scopeSummary: z.string().default(""),
  interviews: z.array(interviewRefSchema).default([]),
  quotes: z.array(quoteRefSchema).default([]),
  mainParties: z.array(partySchema).default([]),
  allegations: z.array(mergedAllegationSchema).default([]),
  mobbingPatterns: z.array(patternSchema).default([]),
  contradictions: z.array(contradictionSchema).default([]),
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
