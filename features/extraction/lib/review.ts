import type { ExtractedData } from "@/lib/types";

export const EXTRACTION_REVIEW_SECTIONS = [
  "metadata",
  "people",
  "facts",
  "events",
  "witnesses",
  "quotes",
  "warnings",
] as const;

export function isExtractionReviewComplete(data: ExtractedData): boolean {
  return (
    EXTRACTION_REVIEW_SECTIONS.every(
      (section) => data.sectionReviewStates[section] === "approved",
    ) &&
    data.allegations.every(
      (allegation) => allegation.reviewStatus === "approved",
    )
  );
}

export function resetExtractionReview(data: ExtractedData): ExtractedData {
  return {
    ...data,
    sectionReviewStates: {},
    extractionWarningReviews: data.extractionWarnings.map((warning) => ({
      warning,
      status: "needs_correction",
    })),
    allegations: data.allegations.map((allegation) => ({
      ...allegation,
      reviewStatus: "ai_generated",
    })),
  };
}
