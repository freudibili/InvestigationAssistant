import { getExtension, getSupportedExtension } from "@/lib/documents";
import type { CaseDocument, ExtractedData } from "@/lib/types";
import type { QuoteRef, SourceRef } from "@/features/investigation-analysis/types";

type Quote = ExtractedData["notableQuotes"][number];
type QuoteProvenance = NonNullable<Quote["provenance"]>;
type ClickableQuoteProvenance = QuoteProvenance & {
  pageNumber: number;
  charStart: number;
  charEnd: number;
};

/** The cited source pdf name (a converted non-PDF is served as `.pdf`). */
export function sourceDocumentName(document: CaseDocument): string {
  const isPdf = getSupportedExtension(document.fileUrl) === ".pdf";
  const ext = getExtension(document.fileName);
  if (!isPdf || ext === ".pdf") return document.fileName;
  const base = ext ? document.fileName.slice(0, -ext.length) : document.fileName;
  return `${base}.pdf`;
}

/** First usable "Page N" in a sourcePages list → page number + display label. */
export function parseFirstPage(sourcePages: string[] | undefined): {
  page: number | null;
  label: string;
} {
  for (const raw of sourcePages ?? []) {
    const normalized = raw?.replace(/\s+/g, " ").trim() ?? "";
    if (
      !normalized ||
      /^chunks?\b/i.test(normalized) ||
      /^internal segments?\b/i.test(normalized) ||
      /pagination unavailable|source location unavailable/i.test(normalized)
    ) {
      continue;
    }
    const match = normalized.match(/\bpages?\s+(\d+)/i) ?? normalized.match(/^(\d+)$/);
    if (match) {
      const page = Number(match[1]);
      return { page, label: `Page ${page}` };
    }
  }
  return { page: null, label: "Source unavailable" };
}

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isClickableQuoteProvenance(
  provenance: QuoteProvenance | undefined
): provenance is ClickableQuoteProvenance {
  return Boolean(
    provenance?.verified &&
      provenance.pageNumber !== null &&
      provenance.charStart !== null &&
      provenance.charEnd !== null &&
      (provenance.sourceStatus === "verified" ||
        provenance.sourceStatus === "fuzzy_verified")
  );
}

/** Build a clickable page reference for a non-quote item (timeline event). */
export function sourceRefFor(
  document: CaseDocument,
  sourcePages: string[] | undefined
): SourceRef | null {
  const { page, label } = parseFirstPage(sourcePages);
  if (page === null) return null;
  return {
    documentId: document.id,
    documentName: sourceDocumentName(document),
    page,
    label,
  };
}

/**
 * Walk every quote in a document's extraction and yield {@link QuoteRef}s with
 * stable ids (`q{docIndex}_{n}`). This is the single source of clickable
 * evidence for the whole analysis: the LLM references these ids and we resolve
 * them back to verbatim text + page + document, so no generated text is ever
 * clickable and no hallucinated quote can slip in.
 */
export function buildDocumentQuotes(
  document: CaseDocument,
  docIndex: number
): QuoteRef[] {
  const data = document.extractedData;
  if (!data) return [];

  const documentName = sourceDocumentName(document);
  const collected: Quote[] = [
    ...(data.notableQuotes ?? []),
    ...(data.factualStatements ?? []).flatMap((f) => f.supportingQuotes ?? []),
    ...(data.keyEvents ?? []).flatMap((e) => e.supportingQuotes ?? []),
    ...(data.potentialWitnesses ?? []).flatMap((w) => w.supportingQuotes ?? []),
    ...(data.allegations ?? []).flatMap((a) => [
      ...(a.relevantQuotes ?? []),
      ...(a.witnesses ?? []).flatMap((w) => w.supportingQuotes ?? []),
    ]),
  ];

  const seen = new Map<string, QuoteRef>();
  let seq = 0;

  for (const quote of collected) {
    const text = quote.text?.trim();
    if (!text || text.length < 8) continue;
    const key = normalizeText(text);
    if (seen.has(key)) continue;

    const provenance = isClickableQuoteProvenance(quote.provenance)
      ? quote.provenance
      : null;
    seq += 1;
    seen.set(key, {
      id: `q${docIndex}_${seq}`,
      provenanceId: provenance?.id ?? null,
      text,
      speaker: quote.speaker?.trim() || null,
      page: provenance?.pageNumber ?? null,
      documentId: document.id,
      documentName,
    });
  }

  return [...seen.values()];
}
