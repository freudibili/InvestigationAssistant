import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

/**
 * Render already-extracted plain text into a real, paginated PDF. Returns both
 * the PDF bytes (stored so investigators can open the source at a given page)
 * and `markedText`, which carries the exact `--- Page N ---` markers the rest of
 * the pipeline expects from a native PDF.
 *
 * `markedText` preserves the document's ORIGINAL characters (it is what the AI
 * extracts from), while only the bytes drawn into the PDF are downgraded to the
 * font's encoding. Both are built from the same line/page layout, so a citation
 * of "Page N" still lines up with page N of the viewer — but a non-Latin name
 * survives in the extraction even if the standard font can't render its glyphs.
 */
export async function convertTextToPaginatedPdf(
  rawText: string
): Promise<{ pdfBytes: Uint8Array; markedText: string }> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // Wrap on the original text, measuring widths against the renderable
  // (font-encodable) form so `widthOfTextAtSize` can never throw on an
  // unencodable glyph.
  const wrappedLines = wrapText(rawText, (text) =>
    font.widthOfTextAtSize(toRenderable(text), FONT_SIZE)
  );
  const pages = paginate(wrappedLines);

  // A document with no readable text still needs one page so the source viewer
  // and page references have something to point at.
  if (pages.length === 0) pages.push([""]);

  for (const lines of pages) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;

    for (const line of lines) {
      const rendered = toRenderable(line);
      if (rendered.length > 0) {
        page.drawText(rendered, {
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
        lines.join("\n").trim()
    )
    .join("")
    .trim();

  return { pdfBytes, markedText };
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
  measure: (text: string) => number
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
  measure: (text: string) => number
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

const UNDEFINED_WIN_ANSI = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);

/**
 * Normalise line endings and tabs without dropping any characters. This is the
 * text the layout (and therefore the AI's `markedText`) is built from, so it
 * must preserve every original glyph regardless of script.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
}

/**
 * Downgrade a line to what the Helvetica standard font can draw: it encodes
 * WinAnsi (cp1252) only. Common Unicode punctuation is folded to ASCII, then
 * anything still outside the range is dropped so `drawText` can never throw on
 * an unencodable glyph. Used ONLY for rendering — never for the AI input.
 */
function toRenderable(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\t/g, "    ");

  let result = "";
  for (const char of normalized) {
    if (char === "\n") {
      result += char;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0xff && !UNDEFINED_WIN_ANSI.has(code)) {
      result += char;
    }
  }

  return result;
}
