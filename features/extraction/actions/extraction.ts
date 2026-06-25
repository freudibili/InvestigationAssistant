"use server";

import { revalidatePath } from "next/cache";
import { convertTextToPaginatedPdf } from "@/features/extraction/lib/pdf-convert";
import {
  chunkPageSpan,
  createExtractionChunks,
  type ExtractionChunk,
} from "@/features/extraction/lib/extraction-chunks";
import { getSupportedExtension } from "@/lib/documents";
import {
  consolidateExtractions,
  ExtractionError,
  extractInterviewChunkWithFallback,
  parseStoredDrafts,
} from "@/features/extraction/lib/openai";
import { suggestCaseType } from "@/lib/db/cases";
import {
  cancelDocumentExtraction,
  getDocument,
  getDocumentExtractionDrafts,
  getDocumentExtractionRunState,
  replaceDocumentWithPdf,
  saveExtractionDrafts,
  saveExtractionResult,
  setExtractionProgress,
  setDocumentStatus,
  startDocumentExtraction,
} from "@/lib/db/documents";
import type {
  CaseDocument,
  ExtractionDraftGroup,
  ExtractionResponse,
} from "@/lib/types";

class ExtractionCanceledError extends Error {
  constructor(message = "Extraction canceled.") {
    super(message);
    this.name = "ExtractionCanceledError";
  }
}

export async function cancelExtractionAction(
  documentId: string
): Promise<CaseDocument> {
  const document = await cancelDocumentExtraction(documentId);
  revalidatePath(`/cases/${document.caseId}/extraction`);
  revalidatePath(`/cases/${document.caseId}/extraction/${documentId}`);
  return document;
}

/**
 * How many page drafts are extracted concurrently. Page extractions are
 * independent, so parallelism cuts wall-clock time without enlarging any single
 * prompt/response — it has no effect on extraction accuracy, only speed. With
 * one page per call this is what keeps long (60+ page) documents fast. Lower it
 * if the provider starts rate-limiting.
 */
const EXTRACTION_CONCURRENCY = 6;

/**
 * Result of an extraction attempt. We deliberately *return* failures instead of
 * throwing: in a production build Next.js strips the message off any error
 * thrown by a Server Action, so throwing would leave the client with an opaque
 * "An error occurred in the Server Components render" string. Returning a result
 * lets a safe, real message reach the toast.
 */
export type ExtractDocumentResult =
  | { ok: true; document: CaseDocument }
  | { ok: false; canceled: boolean; message: string };

/**
 * Run AI extraction for a document. Triggered manually by the investigator.
 * On any failure the document is marked `failed` and a safe message is returned.
 */
export async function extractDocumentAction(
  documentId: string
): Promise<ExtractDocumentResult> {
  const document = await getDocument(documentId);
  if (!document) {
    return { ok: false, canceled: false, message: "Document not found." };
  }

  if (!document.rawText || document.rawText.trim().length === 0) {
    await setDocumentStatus(documentId, "failed");
    revalidatePath(`/cases/${document.caseId}/extraction`);
    return {
      ok: false,
      canceled: false,
      message: "This document has no extracted text to analyze.",
    };
  }

  const runId = crypto.randomUUID();
  await startDocumentExtraction(documentId, runId);
  revalidatePath(`/cases/${document.caseId}/extraction`);

  try {
    // Always work from a real, paginated PDF so the whole document is extracted
    // page-by-page with auditable "Page N" citations. PDFs already carry page
    // markers from text extraction; any other source is converted now. Keyed off
    // the stored object, not the original file name: once a non-PDF has been
    // converted, `fileUrl` ends in `.pdf` and we never reconvert on re-extraction.
    let rawText = document.rawText;
    const alreadyPaginated = getSupportedExtension(document.fileUrl) === ".pdf";

    if (!alreadyPaginated) {
      await setExtractionProgress({
        id: documentId,
        runId,
        currentStep: 0,
        totalSteps: 0,
        step: "Converting to PDF",
      });
      await assertExtractionIsActive(documentId, runId);

      const { pdfBytes, markedText } = await convertTextToPaginatedPdf(rawText);
      await replaceDocumentWithPdf({
        id: documentId,
        runId,
        caseId: document.caseId,
        oldObjectPath: document.fileUrl,
        pdfBytes,
        rawText: markedText,
      });
      rawText = markedText;
      await assertExtractionIsActive(documentId, runId);
    }

    const chunks = createExtractionChunks(rawText);
    // Progress is measured in source pages, not in model-call chunks: a chunk
    // bundles a few pages, so reporting chunk counts made the UI crawl and hid
    // the grouping. We track the page number each chunk ends on, which lets the
    // client show real page ranges and a smooth per-page bar.
    const lastPageOfChunk = (index: number) => {
      const chunk = chunks[index];
      return chunk.pageEnd ?? chunk.pageStart ?? index + 1;
    };
    const totalPages = chunks.length === 0 ? 0 : lastPageOfChunk(chunks.length - 1);
    const totalSteps = totalPages + 1;

    // Reuse page drafts persisted by a previous failed/canceled run so we resume
    // where we stopped instead of re-extracting every page. Chunking is
    // deterministic from the stored text, so a chunk's label is a stable key;
    // any saved group that fails re-validation is dropped so its chunk is simply
    // re-extracted. Drafts from a fully extracted document are cleared on
    // success, so a re-extraction of an already-extracted document starts fresh.
    const savedByLabel = loadResumableDrafts(
      await getDocumentExtractionDrafts(documentId)
    );

    // Completed chunk groups, kept in document order. Re-persisted after each
    // batch so a later failure resumes from the last saved chunk; flattened into
    // `drafts` for consolidation.
    const draftGroups: ExtractionDraftGroup[] = [];
    const resumedPages = sumReusableChunkPages(chunks, savedByLabel);

    await setExtractionProgress({
      id: documentId,
      runId,
      currentStep: resumedPages,
      totalSteps,
      step:
        resumedPages > 0
          ? `Resuming after ${resumedPages} already-extracted page${resumedPages === 1 ? "" : "s"}`
          : `Prepared ${totalPages} page${totalPages === 1 ? "" : "s"}`,
    });
    await assertExtractionIsActive(documentId, runId);

    // Extract several source units per round-trip instead of one at a time:
    // page drafts are independent, so running them concurrently cuts wall-clock
    // time without enlarging any single prompt/response (the truncation risk).
    // Cancellation is checked between batches; a batch's drafts are appended in
    // order so consolidation still sees pages in document order.
    for (let start = 0; start < chunks.length; start += EXTRACTION_CONCURRENCY) {
      const batch = chunks.slice(start, start + EXTRACTION_CONCURRENCY);
      const batchLabel = describeSourceUnitBatch(start, batch);
      const pagesBefore = start === 0 ? 0 : lastPageOfChunk(start - 1);
      const pagesAfter = lastPageOfChunk(start + batch.length - 1);
      const allReused = batch.every((chunk) => savedByLabel.has(chunk.label));

      await setExtractionProgress({
        id: documentId,
        runId,
        currentStep: pagesBefore,
        totalSteps,
        step: `${allReused ? "Reusing" : "Extracting"} ${batchLabel}`,
      });
      await assertExtractionIsActive(documentId, runId);

      const batchGroups = await Promise.all(
        batch.map(async (chunk): Promise<ExtractionDraftGroup> => {
          const reused = savedByLabel.get(chunk.label);
          const chunkDrafts =
            reused ??
            (await extractInterviewChunkWithFallback(chunk, document.fileName));
          return { chunkLabel: chunk.label, drafts: chunkDrafts };
        })
      );
      draftGroups.push(...batchGroups);

      // Persist progress so a failure later in the document can resume from here.
      // Skip the write when the whole batch was reused — nothing changed.
      if (!allReused) {
        await saveExtractionDrafts(documentId, runId, draftGroups);
      }

      await setExtractionProgress({
        id: documentId,
        runId,
        currentStep: pagesAfter,
        totalSteps,
        step: `Finished ${batchLabel}`,
      });
      await assertExtractionIsActive(documentId, runId);
    }

    const drafts: ExtractionResponse[] = draftGroups.flatMap(
      (group) => group.drafts
    );

    await setExtractionProgress({
      id: documentId,
      runId,
      currentStep: totalPages,
      totalSteps,
      step: "Consolidating extraction",
    });
    await assertExtractionIsActive(documentId, runId);

    // Consolidate page drafts in small batches rather than in one giant prompt.
    // The callback both reports progress and aborts the run if it was canceled.
    const { suggestedCaseType, ...extracted } = await consolidateExtractions(
      drafts,
      {
        onStep: async (message) => {
          await setExtractionProgress({
            id: documentId,
            runId,
            currentStep: totalPages,
            totalSteps,
            step: message,
          });
          await assertExtractionIsActive(documentId, runId);
        },
      }
    );
    await assertExtractionIsActive(documentId, runId);

    const updated = await saveExtractionResult(documentId, runId, extracted, {
      currentStep: totalSteps,
      totalSteps,
      step: "Verified extraction",
    });

    // Apply the AI's suggested type, but only if the case is still
    // unclassified — `suggestCaseType` is a no-op once a type exists.
    if (suggestedCaseType) {
      await suggestCaseType(document.caseId, suggestedCaseType);
    }

    revalidatePath(`/cases/${document.caseId}/extraction`);
    revalidatePath(`/cases/${document.caseId}/extraction/${documentId}`);
    return { ok: true, document: updated };
  } catch (error) {
    if (error instanceof ExtractionCanceledError) {
      revalidatePath(`/cases/${document.caseId}/extraction`);
      revalidatePath(`/cases/${document.caseId}/extraction/${documentId}`);
      return { ok: false, canceled: true, message: error.message };
    }

    const state = await getDocumentExtractionRunState(documentId);
    if (state.status === "canceled" || state.extractionRunId !== runId) {
      revalidatePath(`/cases/${document.caseId}/extraction`);
      revalidatePath(`/cases/${document.caseId}/extraction/${documentId}`);
      return {
        ok: false,
        canceled: true,
        message: "Extraction was canceled.",
      };
    }

    // Log the real JSON/Zod diagnostics server-side (never sent to the client),
    // then return only a safe, human-readable message.
    logExtractionFailure({ documentId, runId, error });
    await setDocumentStatus(documentId, "failed");
    revalidatePath(`/cases/${document.caseId}/extraction`);
    return {
      ok: false,
      canceled: false,
      message: toExtractionUserMessage(error),
    };
  }
}

/**
 * Human-readable label for the span of pages extracted together in one
 * concurrent round, e.g. "pages 1–12". Reporting the whole span (rather than
 * listing each internal chunk) keeps the live status reading as a single
 * forward jump instead of crawling page by page when dense pages happen to be
 * chunked individually. Falls back to 1-based positions if a chunk is missing
 * its page numbers.
 */
function describeSourceUnitBatch(
  start: number,
  batch: { pageStart: number | null; pageEnd?: number }[]
): string {
  const paginated = batch.filter((chunk) => chunk.pageStart != null);

  if (paginated.length === batch.length && paginated.length > 0) {
    const first = Math.min(...paginated.map((chunk) => chunk.pageStart as number));
    const last = Math.max(
      ...paginated.map((chunk) => chunk.pageEnd ?? (chunk.pageStart as number))
    );
    return first === last ? `page ${first}` : `pages ${first}–${last}`;
  }

  const firstNum = start + 1;
  const lastNum = start + batch.length;
  return firstNum === lastNum ? `page ${firstNum}` : `pages ${firstNum}–${lastNum}`;
}

/**
 * Build a label→drafts lookup from the page drafts persisted by an earlier run.
 * Each group is re-validated; a group that no longer matches the current schema
 * is dropped so its chunk gets re-extracted rather than poisoning consolidation.
 */
function loadResumableDrafts(
  groups: ExtractionDraftGroup[]
): Map<string, ExtractionResponse[]> {
  const byLabel = new Map<string, ExtractionResponse[]>();

  for (const group of groups) {
    if (!group?.chunkLabel || !Array.isArray(group.drafts)) continue;
    const parsed = parseStoredDrafts(group.drafts);
    if (parsed) byLabel.set(group.chunkLabel, parsed);
  }

  return byLabel;
}

/**
 * How many source pages are covered by chunks we can reuse from a previous run,
 * used only to seed the initial progress bar so a resume doesn't appear to start
 * over from zero.
 */
function sumReusableChunkPages(
  chunks: ExtractionChunk[],
  savedByLabel: Map<string, ExtractionResponse[]>
): number {
  return chunks.reduce(
    (total, chunk) =>
      savedByLabel.has(chunk.label) ? total + chunkPageSpan(chunk) : total,
    0
  );
}

/** Safe, non-sensitive message to surface to the investigator. */
function toExtractionUserMessage(error: unknown): string {
  if (error instanceof ExtractionError) return error.userMessage;
  return "Extraction failed. Please try again.";
}

/**
 * Log the full failure (including the underlying JSON parse / Zod cause) with
 * the document and run ids so a production failure can be traced from the logs.
 */
function logExtractionFailure(params: {
  documentId: string;
  runId: string;
  error: unknown;
}): void {
  const { documentId, runId, error } = params;
  const prefix = `[extraction] failed documentId=${documentId} runId=${runId}`;

  if (error instanceof ExtractionError) {
    console.error(
      `${prefix} type=ExtractionError recoverable=${error.recoverable} message="${error.message}"` +
        (error.detail ? ` detail=${JSON.stringify(error.detail)}` : "")
    );
    if (error.cause) console.error(`${prefix} cause:`, error.cause);
    return;
  }

  if (error instanceof Error) {
    console.error(`${prefix} type=${error.name} message="${error.message}"`, error);
    return;
  }

  console.error(`${prefix} non-error thrown:`, error);
}

async function assertExtractionIsActive(
  documentId: string,
  runId: string
): Promise<void> {
  const state = await getDocumentExtractionRunState(documentId);

  if (state.status === "canceled") {
    throw new ExtractionCanceledError();
  }

  if (state.status !== "extracting" || state.extractionRunId !== runId) {
    throw new ExtractionCanceledError("Extraction was superseded.");
  }
}
