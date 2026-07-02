import "server-only";

import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";

/**
 * A4 page geometry and text layout used when rendering extracted plain text
 * into a paginated PDF. Page numbers come straight from this layout, so the
 * downstream `--- Page N ---` markers and the in-app source viewer line up.
 */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const MAX_TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const MAX_LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);

const PAGE_BREAK = "\n\n--- Page {{PAGE_NUMBER}} ---\n\n";
const UNICODE_FONT_PATH = join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "compiled",
  "@vercel",
  "og",
  "Geist-Regular.ttf",
);

/**
 * Render already-extracted plain text into a real, paginated PDF. Returns both
 * the PDF bytes (stored so investigators can open the source at a given page)
 * and `markedText`, which carries the exact `--- Page N ---` markers the rest of
 * the pipeline expects from a native PDF.
 *
 * `markedText` and the searchable PDF use the same characters and page layout,
 * so a citation of "Page N" lines up with page N of the viewer.
 */
export async function convertTextToPaginatedPdf(
  rawText: string,
): Promise<{ pdfBytes: Uint8Array; markedText: string }> {
  const pdf = await PDFDocument.create();
  const font = await embedDocumentFont(pdf, rawText);

  const wrappedLines = wrapText(rawText, (text) =>
    font.widthOfTextAtSize(text, FONT_SIZE),
  );
  const pages = paginate(wrappedLines);

  // A document with no readable text still needs one page so the source viewer
  // and page references have something to point at.
  if (pages.length === 0) pages.push([""]);

  for (const lines of pages) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;

    for (const line of lines) {
      if (line.length > 0) {
        page.drawText(line, {
          x: MARGIN,
          y,
          size: FONT_SIZE,
          font,
          color: rgb(0, 0, 0),
        });
      }
      y -= LINE_HEIGHT;
    }
  }

  const pdfBytes = await pdf.save();
  const markedText = pages
    .map(
      (lines, index) =>
        PAGE_BREAK.replace("{{PAGE_NUMBER}}", String(index + 1)) +
        lines.join("\n").trim(),
    )
    .join("")
    .trim();

  return { pdfBytes, markedText };
}

export async function convertMarkedTextToPdf(
  markedText: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await embedDocumentFont(pdf, markedText);
  const sourcePages = splitMarkedPages(markedText);

  for (const sourcePage of sourcePages) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const layout = fitSourcePage(sourcePage, (text, size) =>
      font.widthOfTextAtSize(text, size),
    );
    let y = PAGE_HEIGHT - layout.margin;

    for (const line of layout.lines) {
      if (line) {
        page.drawText(line, {
          x: layout.margin,
          y,
          size: layout.fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }
      y -= layout.lineHeight;
    }
  }

  if (sourcePages.length === 0) pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return pdf.save();
}

async function embedDocumentFont(
  pdf: PDFDocument,
  text: string,
): Promise<PDFFont> {
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await readFile(UNICODE_FONT_PATH), {
    subset: true,
  });
  assertFontSupportsText(font, text);
  return font;
}

function assertFontSupportsText(font: PDFFont, text: string): void {
  const supportedCharacters = new Set(font.getCharacterSet());
  const unsupportedCharacter = Array.from(normalizeWhitespace(text)).find(
    (character) =>
      character !== "\n" &&
      !supportedCharacters.has(character.codePointAt(0) ?? -1),
  );
  if (unsupportedCharacter) {
    const codePoint = unsupportedCharacter.codePointAt(0)?.toString(16);
    throw new Error(
      `The corrected PDF font cannot represent “${unsupportedCharacter}” (U+${codePoint?.toUpperCase()}).`,
    );
  }
}

function splitMarkedPages(markedText: string): string[] {
  const marker = /(?:^|\n)\s*--- Page \d+ ---\s*(?:\n|$)/g;
  const matches = Array.from(markedText.matchAll(marker));
  if (matches.length === 0) return [markedText.trim()];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? markedText.length;
    return markedText.slice(start, end).trim();
  });
}

function fitSourcePage(
  text: string,
  measure: (text: string, size: number) => number,
) {
  const margin = 30;

  for (let fontSize = 9; fontSize >= 4; fontSize -= 0.5) {
    const lineHeight = fontSize * 1.25;
    const lines = wrapText(text, (line) => measure(line, fontSize));
    if (lines.length <= Math.floor((PAGE_HEIGHT - margin * 2) / lineHeight)) {
      return { lines, fontSize, lineHeight, margin };
    }
  }

  const lines = wrapText(text, (line) => measure(line, 4));
  const lineHeight = (PAGE_HEIGHT - margin * 2) / Math.max(lines.length, 1);
  const fontSize = Math.min(4, lineHeight * 0.8);
  return {
    lines,
    fontSize,
    lineHeight,
    margin,
  };
}

/**
 * Split text into display lines: source newlines are preserved (blank lines
 * included so paragraphs stay separated) and each line is word-wrapped to the
 * page width. Words longer than a full line are hard-broken so nothing
 * overflows the margin. Lines keep their original characters; callers downgrade
 * to the font encoding only when drawing.
 */
function wrapText(
  rawText: string,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];

  for (const sourceLine of normalizeWhitespace(rawText).split("\n")) {
    const trimmedEnd = sourceLine.replace(/\s+$/, "");
    if (trimmedEnd.length === 0) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of trimmedEnd.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate) <= MAX_TEXT_WIDTH) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        current = "";
      }

      if (measure(word) <= MAX_TEXT_WIDTH) {
        current = word;
      } else {
        // Single word too wide for the page: break it across lines.
        const pieces = breakLongWord(word, measure);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1] ?? "";
      }
    }

    if (current) lines.push(current);
  }

  return lines;
}

function breakLongWord(
  word: string,
  measure: (text: string) => number,
): string[] {
  const pieces: string[] = [];
  let current = "";

  for (const char of word) {
    const candidate = current + char;
    if (current && measure(candidate) > MAX_TEXT_WIDTH) {
      pieces.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

function paginate(lines: string[]): string[][] {
  const pages: string[][] = [];

  for (let start = 0; start < lines.length; start += MAX_LINES_PER_PAGE) {
    pages.push(lines.slice(start, start + MAX_LINES_PER_PAGE));
  }

  return pages;
}

/**
 * Normalise line endings and tabs without dropping any characters. This is the
 * text the layout (and therefore the AI's `markedText`) is built from, so it
 * must preserve every original glyph regardless of script.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
}
