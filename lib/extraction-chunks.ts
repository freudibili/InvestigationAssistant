import "server-only";

export interface ExtractionChunk {
  label: string;
  text: string;
}

const PAGE_MARKER_RE = /(?:^|\n)\s*--- Page (\d+) ---\s*\n/g;
const MAX_CHUNK_CHARS = 12000;

export function createExtractionChunks(rawText: string): ExtractionChunk[] {
  const pageChunks = splitMarkedPages(rawText);
  if (pageChunks.length > 0) return pageChunks;

  return splitTextIntoChunks(rawText);
}

function splitMarkedPages(rawText: string): ExtractionChunk[] {
  const matches = [...rawText.matchAll(PAGE_MARKER_RE)];
  if (matches.length === 0) return [];

  return matches
    .map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end =
        index + 1 < matches.length
          ? (matches[index + 1].index ?? rawText.length)
          : rawText.length;

      return {
        label: `page ${match[1]}`,
        text: rawText.slice(start, end).trim(),
      };
    })
    .filter((chunk) => chunk.text.length > 0);
}

function splitTextIntoChunks(rawText: string): ExtractionChunk[] {
  const paragraphs = rawText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!current) {
      if (paragraph.length > MAX_CHUNK_CHARS) {
        chunks.push(...splitLongText(paragraph));
      } else {
        current = paragraph;
      }
      continue;
    }

    if (current.length + paragraph.length + 2 <= MAX_CHUNK_CHARS) {
      current += `\n\n${paragraph}`;
      continue;
    }

    chunks.push(current);
    current = "";

    if (paragraph.length > MAX_CHUNK_CHARS) {
      chunks.push(...splitLongText(paragraph));
    } else {
      current = paragraph;
    }
  }

  if (current) chunks.push(current);

  return chunks.map((text, index) => ({
    label: `chunk ${index + 1}`,
    text,
  }));
}

function splitLongText(text: string): string[] {
  const chunks: string[] = [];

  for (let start = 0; start < text.length; start += MAX_CHUNK_CHARS) {
    chunks.push(text.slice(start, start + MAX_CHUNK_CHARS));
  }

  return chunks;
}
