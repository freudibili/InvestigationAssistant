import "server-only";

import { env } from "@/lib/env";

export interface ExtractionChunk {
  label: string;
  pageStart: number | null;
  pageEnd?: number;
  text: string;
}

const PAGE_MARKER_RE = /(?:^|\n)\s*--- Page (\d+) ---\s*\n/g;

/**
 * How many real document pages are sent to the model in a single extraction
 * call. Kept small for precision: few pages in the prompt keep citations
 * accurate and each response short. Set to 2 so an answer that runs across a
 * single page break still lands in one call (the two pages are seen together),
 * while citations stay reliable. The round-trip cost is absorbed by running
 * calls concurrently (see `EXTRACTION_CONCURRENCY`), so accuracy never trades
 * off against speed.
 */
const PAGES_PER_CHUNK = env.extractionPagesPerChunk;

/**
 * How many source pages a chunk covers. Used only to seed the resume progress
 * bar; correctness never depends on it.
 */
export function chunkPageSpan(chunk: ExtractionChunk): number {
  if (chunk.pageStart == null) return 1;
  return (chunk.pageEnd ?? chunk.pageStart) - chunk.pageStart + 1;
}

/**
 * Split a document's page-markered text into extraction chunks. Every document
 * is converted to a paginated PDF before extraction, so the text always carries
 * "--- Page N ---" markers; a document with no readable pages yields no chunks.
 */
export function createExtractionChunks(rawText: string): ExtractionChunk[] {
  return splitMarkedPages(rawText);
}

interface MarkedPage {
  pageNumber: number;
  text: string;
}

function splitMarkedPages(rawText: string): ExtractionChunk[] {
  const matches = [...rawText.matchAll(PAGE_MARKER_RE)];
  if (matches.length === 0) return [];

  const pages: MarkedPage[] = matches
    .map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end =
        index + 1 < matches.length
          ? (matches[index + 1].index ?? rawText.length)
          : rawText.length;

      return {
        pageNumber: Number(match[1]),
        text: rawText.slice(start, end).trim(),
      };
    })
    .filter((page) => page.text.length > 0);

  return groupPagesIntoChunks(pages);
}

/**
 * Group consecutive pages into chunks of {@link PAGES_PER_CHUNK} pages. Each
 * page keeps its own "--- Page N ---" marker inside the chunk text so the model
 * can still cite the exact page an item came from.
 */
function groupPagesIntoChunks(pages: MarkedPage[]): ExtractionChunk[] {
  const chunks: ExtractionChunk[] = [];

  for (let start = 0; start < pages.length; start += PAGES_PER_CHUNK) {
    const group = pages.slice(start, start + PAGES_PER_CHUNK);
    const first = group[0].pageNumber;
    const last = group[group.length - 1].pageNumber;

    chunks.push({
      label: first === last ? `Page ${first}` : `Pages ${first}-${last}`,
      pageStart: first,
      pageEnd: last,
      text: group
        .map((page) => `--- Page ${page.pageNumber} ---\n${page.text}`)
        .join("\n\n"),
    });
  }

  return chunks;
}

/**
 * Re-split an already-built multi-page chunk back into one chunk per page. Used
 * as a fallback when a grouped extraction call truncates: retrying each page on
 * its own keeps every prompt and response small. Single-page chunks are
 * returned unchanged.
 */
export function splitChunkIntoSinglePages(
  chunk: ExtractionChunk
): ExtractionChunk[] {
  const matches = [...chunk.text.matchAll(PAGE_MARKER_RE)];
  if (matches.length <= 1) return [chunk];

  return matches
    .map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end =
        index + 1 < matches.length
          ? (matches[index + 1].index ?? chunk.text.length)
          : chunk.text.length;
      const pageNumber = Number(match[1]);

      return {
        label: `Page ${pageNumber}`,
        pageStart: pageNumber,
        pageEnd: pageNumber,
        text: chunk.text.slice(start, end).trim(),
      };
    })
    .filter((page) => page.text.length > 0);
}
