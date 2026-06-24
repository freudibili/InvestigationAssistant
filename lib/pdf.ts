import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

/**
 * Extract plain text from a PDF buffer using unpdf (a serverless-friendly
 * build of pdf.js). Returns the concatenated text of all pages.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}
