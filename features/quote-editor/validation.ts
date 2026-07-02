import { z } from "zod";

export const quoteCorrectionSchema = z.object({
  documentId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  quoteId: z.string().min(1),
  page: z.number().int().positive(),
  selectedText: z.string().trim().min(1).max(20_000),
  correctedText: z.string().trim().min(1).max(20_000),
  sourceVersion: z.enum(["ai", "edited", "approved"]).optional(),
});

export type QuoteCorrection = z.infer<typeof quoteCorrectionSchema>;
