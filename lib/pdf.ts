import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

const PAGE_BREAK = "\n\n--- Page {{PAGE_NUMBER}} ---\n\n";

/**
 * Extract plain text from a PDF buffer using unpdf while preserving page
 * boundaries for downstream page-by-page AI extraction.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pages = await extractPdfPages(data);
  return pages
    .map((page) =>
      PAGE_BREAK.replace("{{PAGE_NUMBER}}", String(page.pageNumber)) + page.text
    )
    .join("")
    .trim();
}

export async function extractPdfPages(
  data: ArrayBuffer
): Promise<Array<{ pageNumber: number; text: string }>> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf);
  return text.map((pageText, index) => ({
    pageNumber: index + 1,
    text: pageText.trim(),
  }));
}
