import type { z } from "zod";
import type {
  analysisResponseSchema,
  interviewRefSchema,
  investigationAnalysisSchema,
  quoteRefSchema,
  sourceRefSchema,
} from "@/features/investigation-analysis/validation";

/** The full persisted/dashboard analysis object. */
export type InvestigationAnalysis = z.infer<typeof investigationAnalysisSchema>;

/** The reasoning-only object the LLM returns (references evidence by id). */
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;

/** A resolved, clickable quote — the only evidence the dashboard links to. */
export type QuoteRef = z.infer<typeof quoteRefSchema>;

/** An interview within the case, used for labelling references. */
export type InterviewRef = z.infer<typeof interviewRefSchema>;

/** A clickable page location without a verbatim quote (page nav only). */
export type SourceRef = z.infer<typeof sourceRefSchema>;

export type Party = InvestigationAnalysis["mainParties"][number];
/** A single triangulated grievance card (claimant/accused/reference → finding). */
export type Reproche = InvestigationAnalysis["reproches"][number];
/** One party's account within a grievance. */
export type ReprocheStatement = Reproche["claimantStatement"];
export type TimelineEvent = InvestigationAnalysis["timeline"][number];
export type PersonProfile = InvestigationAnalysis["people"][number];
export type ConsolidatedWitness = InvestigationAnalysis["witnesses"][number];
export type AnalysisGaps = InvestigationAnalysis["gaps"];
