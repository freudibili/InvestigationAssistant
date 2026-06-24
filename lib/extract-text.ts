import "server-only";

import mammoth from "mammoth";
import WordExtractor from "word-extractor";

import { extractPdfText } from "@/lib/pdf";
import { getSupportedExtension, type SupportedExtension } from "@/lib/documents";

/**
 * Extract plain text from an uploaded document, dispatching on the file
 * extension. Throws if the format is unsupported or the text can't be read.
 */
export async function extractDocumentText(
  fileName: string,
  data: ArrayBuffer
): Promise<string> {
  const ext = getSupportedExtension(fileName);
  if (!ext) {
    throw new Error("Unsupported file type.");
  }

  switch (ext satisfies SupportedExtension) {
    case ".pdf":
      return extractPdfText(data);
    case ".txt":
      return new TextDecoder().decode(data).trim();
    case ".docx": {
      const { value } = await mammoth.extractRawText({
        buffer: Buffer.from(data),
      });
      return value.trim();
    }
    case ".doc": {
      const extracted = await new WordExtractor().extract(Buffer.from(data));
      return extracted.getBody().trim();
    }
  }
}
