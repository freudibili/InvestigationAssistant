"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Loader2 } from "lucide-react";

import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import type { ContentVersion } from "@/lib/types";

// pdf.js needs a worker; load the matching one bundled with pdfjs-dist. The
// `new URL(..., import.meta.url)` form lets the bundler fingerprint and serve it.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeComparable(value: string): string {
  let output = "";
  let previousWasSpace = true;

  for (const char of value) {
    const normalized = char
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[’‘`´]/g, "'")
      .toLowerCase();

    if (!normalized) continue;
    if (/\s/.test(normalized)) {
      if (!previousWasSpace) output += " ";
      previousWasSpace = true;
      continue;
    }
    if (/[\p{P}\p{S}]/u.test(normalized)) continue;

    output += normalized;
    previousWasSpace = false;
  }

  return output.trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Renders the source PDF page inside a dialog, scrolled to the cited page and —
 * when a quote is supplied — highlighting the exact text. Loads the PDF bytes
 * from our same-origin `/file` route so storage CORS never blocks pdf.js.
 *
 * Quotes are the only clickable evidence, so highlighting is best-effort: if the
 * text layer can't be matched (scanned/OCR'd pages, reflowed text) the page is
 * still shown at the right location.
 */
export type SourcePdfViewerProps = {
  documentId: string;
  page: number;
  quoteId?: string;
  charStart?: number | null;
  charEnd?: number | null;
  pageCharStart?: number | null;
  pageCharEnd?: number | null;
  normalizedPageCharStart?: number | null;
  normalizedPageCharEnd?: number | null;
  quote?: string | null;
  version?: ContentVersion;
  onTextSelection?: (text: string) => void;
};

export function SourcePdfViewer({
  documentId,
  page,
  quoteId,
  charStart,
  charEnd,
  pageCharStart,
  pageCharEnd,
  normalizedPageCharStart,
  normalizedPageCharEnd,
  quote,
  version,
  onTextSelection,
}: SourcePdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(0);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A stable `file` reference avoids react-pdf reloading the document on every
  // render. Memoize on the route so it only changes when the document changes.
  const file = useMemo(
    () => ({
      url: `/api/documents/${documentId}/file${version ? `?version=${version}` : ""}`,
    }),
    [documentId, version],
  );

  const normalizedQuote = useMemo(
    () => (quote ? normalize(quote) : null),
    [quote],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(Math.floor(next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const textRenderer = useMemo(() => {
    if (
      normalizedPageCharStart === null ||
      normalizedPageCharStart === undefined ||
      normalizedPageCharEnd === null ||
      normalizedPageCharEnd === undefined ||
      normalizedPageCharEnd <= normalizedPageCharStart
    ) {
      if (!normalizedQuote) return undefined;
      return ({ str }: { str: string }) => {
        const item = normalize(str);
        const overlaps =
          (item.length >= 4 && normalizedQuote.includes(item)) ||
          (normalizedQuote.length >= 4 && item.includes(normalizedQuote));
        return overlaps
          ? `<mark class="source-quote-highlight">${escapeHtml(str)}</mark>`
          : escapeHtml(str);
      };
    }

    let cursor = 0;
    return ({ str, itemIndex }: { str: string; itemIndex: number }) => {
      if (itemIndex === 0) cursor = 0;
      const normalizedText = normalizeComparable(str);
      const start = cursor;
      const end = cursor + normalizedText.length;
      cursor = end + (normalizedText.length > 0 ? 1 : 0);
      const overlaps =
        normalizedText.length > 0 &&
        start < normalizedPageCharEnd &&
        end > normalizedPageCharStart;
      return overlaps
        ? `<mark class="source-quote-highlight">${escapeHtml(str)}</mark>`
        : escapeHtml(str);
    };
  }, [normalizedPageCharEnd, normalizedPageCharStart, normalizedQuote]);

  const safePage = numPages ? Math.min(Math.max(page, 1), numPages) : page;

  function handleTextLayerRendered() {
    // Scroll the first highlighted span into view once the text layer exists.
    const mark = containerRef.current?.querySelector(
      "mark.source-quote-highlight",
    );
    mark?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function handleTextSelection() {
    if (!onTextSelection) return;
    const selection = window.getSelection();
    const selectedText = selection?.toString().replace(/\s+/g, " ").trim();
    if (!selection || !selectedText || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!containerRef.current?.contains(range.commonAncestorContainer)) return;
    onTextSelection(selectedText);
  }

  return (
    <div
      ref={containerRef}
      onMouseUp={handleTextSelection}
      className="bg-muted/30 min-h-0 w-full flex-1 overflow-auto rounded-md border"
    >
      {/* highlight styling injected globally so it applies to text-layer HTML */}
      <style>{`.source-quote-highlight{background:rgba(250,204,21,.55);color:inherit;border-radius:2px;}`}</style>
      {error ? (
        <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
          {error}
        </div>
      ) : (
        <Document
          file={file}
          onLoadSuccess={({ numPages: n }) => {
            setNumPages(n);
            setError(null);
          }}
          onLoadError={() => setError("Could not load the source document.")}
          loading={
            <div className="text-muted-foreground flex h-full items-center justify-center gap-2 p-8 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading source…
            </div>
          }
          className="flex justify-center p-4"
        >
          {width > 0 ? (
            <Page
              key={`${documentId}-${safePage}-${quoteId ?? ""}-${charStart ?? ""}-${charEnd ?? ""}-${pageCharStart ?? ""}-${pageCharEnd ?? ""}-${normalizedPageCharStart ?? ""}-${normalizedPageCharEnd ?? ""}`}
              pageNumber={safePage}
              width={Math.min(width - 32, 900)}
              customTextRenderer={textRenderer}
              onRenderTextLayerSuccess={handleTextLayerRendered}
              renderAnnotationLayer={false}
            />
          ) : null}
        </Document>
      )}
    </div>
  );
}
