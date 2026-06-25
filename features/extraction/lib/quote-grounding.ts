import "server-only";

import type { ExtractedData } from "@/lib/types";
import { getExtractionProvider } from "@/features/extraction/lib/providers";

const PAGE_MARKER_RE = /(?:^|\n)\s*--- Page (\d+) ---\s*\n/g;

type MatchStrategy = "exact" | "normalized" | "fuzzy";
type SourceStatus = "verified" | "fuzzy_verified";

type QuoteWithProvenance = ExtractedData["notableQuotes"][number];

export type QuoteProvenance = {
  id: string;
  documentId: string;
  quoteText: string;
  pageNumber: number;
  charStart: number;
  charEnd: number;
  pageCharStart: number;
  pageCharEnd: number;
  normalizedPageCharStart: number;
  normalizedPageCharEnd: number;
  matchStrategy: MatchStrategy;
  matchedBy: MatchStrategy;
  confidence: number;
  verified: boolean;
  sourceStatus: SourceStatus;
  extractionItemId: string;
  supportedItemId: string;
  boundingBoxes: null;
};

type CanonicalPage = {
  pageNumber: number;
  text: string;
  charStart: number;
  charEnd: number;
  normalizedText: string;
  normalizedChars: NormalizedChar[];
};

type CanonicalIndex = {
  text: string;
  normalizedText: string;
  normalizedChars: NormalizedChar[];
  pages: CanonicalPage[];
  hasReliablePagination: boolean;
};

type LocatedQuote = {
  charStart: number;
  charEnd: number;
  matchStrategy: MatchStrategy;
  confidence: number;
};

type NormalizedChar = {
  value: string;
  originalIndex: number;
};

const PUNCTUATION_RE = /[\p{P}\p{S}]/u;
const FUZZY_THRESHOLD = 0.9;
const FUZZY_MAX_COMPARISONS = 500;
const FUZZY_MAX_QUOTE_LENGTH = 240;
const FUZZY_MAX_PAGE_LENGTH = 6_000;
const RETRY_SOURCE_WINDOW_MAX_LENGTH = 8_000;
const QUOTE_RETRY_SYSTEM_PROMPT = `You find exact source quotes for workplace investigation extraction items.
Return ONLY JSON with this shape: {"quote": string | null}.
The quote must be an exact substring copied from the source text.
Do not paraphrase, translate, shorten, add ellipses, or include page markers.
Return null if no exact source substring supports the item.`;

export async function groundExtractionQuotes(params: {
  documentId: string;
  rawText: string;
  extractedData: ExtractedData;
}): Promise<ExtractedData> {
  const index = buildCanonicalIndex(params.rawText);
  if (!index.hasReliablePagination) {
    throw new Error("Cannot ground quotes because source text is not paginated.");
  }

  const locatedByQuote = new Map<string, LocatedQuote | null>();
  let sequence = 0;

  const groundQuote = async (
    quote: QuoteWithProvenance,
    supportedItemId: string
  ): Promise<QuoteWithProvenance | null> => {
    sequence += 1;
    const id = `${params.documentId}:quote:${sequence}`;
    const text = quote.text?.trim() ?? "";
    const pages = quote.sourcePages ?? [];
    const cacheKey = `${normalizeComparable(text)}|${pages.join(",")}`;
    let located = locatedByQuote.get(cacheKey);

    if (!locatedByQuote.has(cacheKey)) {
      located = text && index.text ? locateQuote(index, text, pages) : null;
      locatedByQuote.set(cacheKey, located);
    }

    if (!located) {
      logRejectedQuote(params.documentId, supportedItemId, text);
      return null;
    }

    const groundedQuote = {
      ...quote,
      text: sourceTextForLocatedQuote(index, located),
    };

    const provenance = buildProvenance({
      id,
      documentId: params.documentId,
      supportedItemId,
      index,
      located,
    });

    if (!provenance) {
      logRejectedQuote(params.documentId, supportedItemId, text);
      return null;
    }

    groundedQuote.provenance = provenance;
    groundedQuote.sourcePages = [`Page ${provenance.pageNumber}`];

    return groundedQuote;
  };

  const data = structuredClone(params.extractedData) as ExtractedData;

  data.notableQuotes = await groundQuoteList(data.notableQuotes ?? [], {
    itemDescription: "notable quote",
    itemSourcePages: [],
    supportedItemId: "notableQuotes",
    index,
    groundQuote,
  });

  data.factualStatements = await mapSequential(
    data.factualStatements ?? [],
    async (fact, factIndex) => ({
      ...fact,
      supportingQuotes: await groundQuoteList(fact.supportingQuotes ?? [], {
        itemDescription: fact.description,
        itemSourcePages: fact.sourcePages,
        supportedItemId: `factualStatements.${factIndex}`,
        index,
        groundQuote,
      }),
    })
  );

  data.keyEvents = await mapSequential(data.keyEvents ?? [], async (event, eventIndex) => ({
    ...event,
    supportingQuotes: await groundQuoteList(event.supportingQuotes ?? [], {
      itemDescription: event.description,
      itemSourcePages: event.sourcePages,
      supportedItemId: `keyEvents.${eventIndex}`,
      index,
      groundQuote,
    }),
  }));

  data.potentialWitnesses = await mapSequential(
    data.potentialWitnesses ?? [],
    async (witness, witnessIndex) => ({
      ...witness,
      supportingQuotes: await groundQuoteList(witness.supportingQuotes ?? [], {
        itemDescription: `${witness.name}: ${witness.relevance}`,
        itemSourcePages: witness.sourcePages,
        supportedItemId: `potentialWitnesses.${witnessIndex}`,
        index,
        groundQuote,
      }),
    })
  );

  data.allegations = await mapSequential(
    data.allegations ?? [],
    async (allegation, allegationIndex) => ({
      ...allegation,
      relevantQuotes: await groundQuoteList(allegation.relevantQuotes ?? [], {
        itemDescription: allegation.allegation || allegation.description,
        itemSourcePages: allegation.sourcePages,
        supportedItemId: `allegations.${allegationIndex}`,
        index,
        groundQuote,
      }),
      witnesses: await mapSequential(
        allegation.witnesses ?? [],
        async (witness, witnessIndex) => ({
          ...witness,
          supportingQuotes: await groundQuoteList(witness.supportingQuotes ?? [], {
            itemDescription: `${witness.name}: ${witness.relevance}`,
            itemSourcePages: witness.sourcePages,
            supportedItemId: `allegations.${allegationIndex}.witnesses.${witnessIndex}`,
            index,
            groundQuote,
          }),
        })
      ),
    })
  );

  data.pageFindings = await mapSequential(
    data.pageFindings ?? [],
    async (pageFinding, pageFindingIndex) => ({
      ...pageFinding,
      notableQuotes: await groundQuoteList(pageFinding.notableQuotes ?? [], {
        itemDescription: `page finding ${pageFinding.sourcePage}`,
        itemSourcePages: [pageFinding.sourcePage],
        supportedItemId: `pageFindings.${pageFindingIndex}.notableQuotes`,
        index,
        groundQuote,
      }),
      allegations: await mapSequential(
        pageFinding.allegations ?? [],
        async (allegation, allegationIndex) => ({
          ...allegation,
          relevantQuotes: await groundQuoteList(allegation.relevantQuotes ?? [], {
            itemDescription: allegation.allegation || allegation.description,
            itemSourcePages: allegation.sourcePages,
            supportedItemId: `pageFindings.${pageFindingIndex}.allegations.${allegationIndex}`,
            index,
            groundQuote,
          }),
        })
      ),
      potentialWitnesses: await mapSequential(
        pageFinding.potentialWitnesses ?? [],
        async (witness, witnessIndex) => ({
          ...witness,
          supportingQuotes: await groundQuoteList(witness.supportingQuotes ?? [], {
            itemDescription: `${witness.name}: ${witness.relevance}`,
            itemSourcePages: witness.sourcePages,
            supportedItemId: `pageFindings.${pageFindingIndex}.potentialWitnesses.${witnessIndex}`,
            index,
            groundQuote,
          }),
        })
      ),
      relevantEvents: await mapSequential(
        pageFinding.relevantEvents ?? [],
        async (event, eventIndex) => ({
          ...event,
          supportingQuotes: await groundQuoteList(event.supportingQuotes ?? [], {
            itemDescription: event.description,
            itemSourcePages: event.sourcePages,
            supportedItemId: `pageFindings.${pageFindingIndex}.relevantEvents.${eventIndex}`,
            index,
            groundQuote,
          }),
        })
      ),
    })
  );

  return data;
}

type GroundQuoteListParams = {
  itemDescription: string;
  itemSourcePages: string[];
  supportedItemId: string;
  index: CanonicalIndex;
  groundQuote: (
    quote: QuoteWithProvenance,
    supportedItemId: string
  ) => Promise<QuoteWithProvenance | null>;
};

async function groundQuoteList(
  quotes: QuoteWithProvenance[],
  params: GroundQuoteListParams
): Promise<QuoteWithProvenance[]> {
  const grounded = (
    await mapSequential(quotes, (quote) =>
      params.groundQuote(quote, params.supportedItemId)
    )
  ).filter((quote): quote is QuoteWithProvenance => Boolean(quote));

  if (grounded.length > 0) return grounded;
  if (quotes.length === 0) return [];

  const replacement = await findReplacementQuote({
    itemDescription: params.itemDescription,
    sourcePages: params.itemSourcePages,
    index: params.index,
  });

  if (!replacement) return [];

  const groundedReplacement = await params.groundQuote(
    {
      speaker: null,
      text: replacement,
      sourcePages: params.itemSourcePages,
    },
    params.supportedItemId
  );

  return groundedReplacement ? [groundedReplacement] : [];
}

async function mapSequential<T, U>(
  items: T[],
  map: (item: T, index: number) => Promise<U>
): Promise<U[]> {
  const mapped: U[] = [];
  for (const [index, item] of items.entries()) {
    mapped.push(await map(item, index));
  }
  return mapped;
}

async function findReplacementQuote(params: {
  itemDescription: string;
  sourcePages: string[];
  index: CanonicalIndex;
}): Promise<string | null> {
  const sourceWindow = sourceWindowForPages(params.index, params.sourcePages);
  if (!sourceWindow) return null;

  const { content, truncated } = await getExtractionProvider().complete({
    system: QUOTE_RETRY_SYSTEM_PROMPT,
    user: [
      "Find one exact source quote that supports this extracted item.",
      `Item: ${params.itemDescription}`,
      "Source text:",
      '"""',
      sourceWindow,
      '"""',
    ].join("\n"),
  });

  if (truncated || !content) return null;

  try {
    const parsed = JSON.parse(content) as { quote?: unknown };
    return typeof parsed.quote === "string" && parsed.quote.trim()
      ? parsed.quote.trim()
      : null;
  } catch {
    return null;
  }
}

function sourceWindowForPages(
  index: CanonicalIndex,
  sourcePages: string[]
): string {
  const pages = estimatedPages(index, sourcePages);
  const text = pages.length > 0 ? pages.map((page) => page.text).join("\n\n") : index.text;
  return text.slice(0, RETRY_SOURCE_WINDOW_MAX_LENGTH).trim();
}

function logRejectedQuote(
  documentId: string,
  supportedItemId: string,
  quoteText: string
): void {
  console.warn("[quote-grounding] rejected unverified quote", {
    documentId,
    supportedItemId,
    quoteText,
  });
}

function sourceTextForLocatedQuote(
  index: CanonicalIndex,
  located: LocatedQuote
): string {
  return index.text.slice(located.charStart, located.charEnd).trim();
}

export function findQuoteProvenanceById(
  extractedData: ExtractedData | null,
  quoteId: string
): QuoteProvenance | null {
  if (!extractedData) return null;
  let found: QuoteProvenance | null = null;

  visitExtractionQuotes(extractedData, (quote) => {
    if (quote.provenance?.id === quoteId) {
      found = quote.provenance;
    }
  });

  return found;
}

function visitExtractionQuotes(
  data: ExtractedData,
  visit: (quote: QuoteWithProvenance) => void
): void {
  data.notableQuotes?.forEach(visit);
  data.factualStatements?.forEach((fact) => fact.supportingQuotes?.forEach(visit));
  data.keyEvents?.forEach((event) => event.supportingQuotes?.forEach(visit));
  data.potentialWitnesses?.forEach((witness) =>
    witness.supportingQuotes?.forEach(visit)
  );
  data.allegations?.forEach((allegation) => {
    allegation.relevantQuotes?.forEach(visit);
    allegation.witnesses?.forEach((witness) =>
      witness.supportingQuotes?.forEach(visit)
    );
  });
  data.pageFindings?.forEach((pageFinding) => {
    pageFinding.notableQuotes?.forEach(visit);
    pageFinding.allegations?.forEach((allegation) =>
      allegation.relevantQuotes?.forEach(visit)
    );
    pageFinding.potentialWitnesses?.forEach((witness) =>
      witness.supportingQuotes?.forEach(visit)
    );
    pageFinding.relevantEvents?.forEach((event) =>
      event.supportingQuotes?.forEach(visit)
    );
  });
}

function buildCanonicalIndex(rawText: string): CanonicalIndex {
  const matches = [...rawText.matchAll(PAGE_MARKER_RE)];
  if (matches.length === 0) {
    const text = rawText.trim();
    const normalizedChars = normalizeWithMap(text);
    return {
      text,
      normalizedText: normalizedChars.map((item) => item.value).join(""),
      normalizedChars,
      pages: [],
      hasReliablePagination: false,
    };
  }

  const pages: CanonicalPage[] = [];
  const parts: string[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end =
      index + 1 < matches.length
        ? matches[index + 1].index ?? rawText.length
        : rawText.length;
    const pageText = rawText.slice(start, end).trim();
    if (!pageText) return;

    if (parts.length > 0) {
      parts.push("\n\n");
      cursor += 2;
    }

    const charStart = cursor;
    const normalizedChars = normalizeWithMap(pageText);
    parts.push(pageText);
    cursor += pageText.length;
    pages.push({
      pageNumber: Number(match[1]),
      text: pageText,
      charStart,
      charEnd: cursor,
      normalizedText: normalizedChars.map((item) => item.value).join(""),
      normalizedChars,
    });
  });

  const text = parts.join("");
  const normalizedChars = normalizeWithMap(text);

  return {
    text,
    normalizedText: normalizedChars.map((item) => item.value).join(""),
    normalizedChars,
    pages,
    hasReliablePagination: pages.length > 0,
  };
}

function locateQuote(
  index: CanonicalIndex,
  quoteText: string,
  sourcePages: string[]
): LocatedQuote | null {
  for (const candidate of quoteCandidates(quoteText)) {
    const exact = findExactMatch(index, candidate, sourcePages);
    if (exact) return { ...exact, matchStrategy: "exact", confidence: 1 };

    const normalized = findNormalizedMatch(index, candidate, sourcePages);
    if (normalized) {
      return { ...normalized, matchStrategy: "normalized", confidence: 0.97 };
    }
  }

  return findFuzzyMatch(index, quoteText, sourcePages);
}

function quoteCandidates(quoteText: string): string[] {
  const trimmed = quoteText.trim();
  const withoutSpeaker = trimmed.replace(
    /^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]{1,80}:\s*/u,
    ""
  );
  return [trimmed, withoutSpeaker].filter(
    (candidate, index, candidates) =>
      candidate.length > 0 && candidates.indexOf(candidate) === index
  );
}

function findExactMatch(
  index: CanonicalIndex,
  quoteText: string,
  sourcePages: string[]
): Pick<LocatedQuote, "charStart" | "charEnd"> | null {
  const matches = findAllOccurrences(index.text, quoteText);
  return chooseMatch(index, matches, sourcePages, quoteText.length);
}

function findNormalizedMatch(
  index: CanonicalIndex,
  quoteText: string,
  sourcePages: string[]
): Pick<LocatedQuote, "charStart" | "charEnd"> | null {
  const normalizedQuote = normalizeWithMap(quoteText).map((item) => item.value).join("");
  if (!normalizedQuote) return null;

  const normalizedMatches = findAllOccurrences(index.normalizedText, normalizedQuote);
  const matches = normalizedMatches
    .map((start) => {
      const first = index.normalizedChars[start];
      const last = index.normalizedChars[start + normalizedQuote.length - 1];
      if (!first || !last) return null;
      return { charStart: first.originalIndex, charEnd: last.originalIndex + 1 };
    })
    .filter((match): match is Pick<LocatedQuote, "charStart" | "charEnd"> =>
      Boolean(match)
    );

  return chooseLocatedMatch(index, matches, sourcePages);
}

function findFuzzyMatch(
  index: CanonicalIndex,
  quoteText: string,
  sourcePages: string[]
): LocatedQuote | null {
  const normalizedQuote = normalizeComparable(quoteText);
  if (normalizedQuote.length < 12) return null;
  if (normalizedQuote.length > FUZZY_MAX_QUOTE_LENGTH) return null;

  const searchPages = estimatedPages(index, sourcePages);
  const pagesToSearch = searchPages.length > 0 ? searchPages : index.pages;
  if (pagesToSearch.length === 0) return null;

  let best: LocatedQuote | null = null;
  const targetLength = normalizedQuote.length;
  let comparisons = 0;

  for (const page of pagesToSearch) {
    const normalizedPage = page.normalizedChars;
    const pageValue = page.normalizedText;
    if (pageValue.length === 0) continue;
    if (pageValue.length > FUZZY_MAX_PAGE_LENGTH) continue;

    const minLength = Math.max(8, Math.floor(targetLength * 0.85));
    const maxLength = Math.ceil(targetLength * 1.15);

    for (let start = 0; start < pageValue.length; start += 1) {
      for (
        let length = minLength;
        length <= maxLength && start + length <= pageValue.length;
        length += 1
      ) {
        comparisons += 1;
        if (comparisons > FUZZY_MAX_COMPARISONS) return best;

        const candidate = pageValue.slice(start, start + length);
        const confidence = similarity(normalizedQuote, candidate);
        if (confidence < FUZZY_THRESHOLD || confidence <= (best?.confidence ?? 0)) {
          continue;
        }

        const first = normalizedPage[start];
        const last = normalizedPage[start + length - 1];
        if (!first || !last) continue;

        best = {
          charStart: page.charStart + first.originalIndex,
          charEnd: page.charStart + last.originalIndex + 1,
          matchStrategy: "fuzzy",
          confidence,
        };
      }
    }
  }

  return best;
}

function buildProvenance(params: {
  id: string;
  documentId: string;
  supportedItemId: string;
  index: CanonicalIndex;
  located: LocatedQuote;
}): QuoteProvenance | null {
  const page =
    params.index.hasReliablePagination
      ? pageContainingOffset(params.index, params.located.charStart)
      : null;

  if (!page) return null;

  const pageCharStart =
    params.located.charStart - page.charStart;
  const pageCharEnd =
    params.located.charEnd - page.charStart;
  const quoteText = sourceTextForLocatedQuote(params.index, params.located);
  const sourceStatus =
    params.located.matchStrategy === "fuzzy" ? "fuzzy_verified" : "verified";

  return {
    id: params.id,
    documentId: params.documentId,
    quoteText,
    pageNumber: page.pageNumber,
    charStart: params.located.charStart,
    charEnd: params.located.charEnd,
    pageCharStart,
    pageCharEnd,
    normalizedPageCharStart:
      normalizeComparable(page.text.slice(0, pageCharStart)).length,
    normalizedPageCharEnd:
      normalizeComparable(page.text.slice(0, pageCharEnd)).length,
    matchStrategy: params.located.matchStrategy,
    matchedBy: params.located.matchStrategy,
    confidence: params.located.confidence,
    verified: true,
    sourceStatus,
    extractionItemId: params.supportedItemId,
    supportedItemId: params.supportedItemId,
    boundingBoxes: null,
  };
}

function pageContainingOffset(
  index: CanonicalIndex,
  offset: number
): CanonicalPage | null {
  return (
    index.pages.find((page) => offset >= page.charStart && offset < page.charEnd) ??
    null
  );
}

function estimatedPages(
  index: CanonicalIndex,
  sourcePages: string[]
): CanonicalPage[] {
  const pageNumbers = new Set<number>();
  for (const sourcePage of sourcePages) {
    const normalized = sourcePage?.replace(/\s+/g, " ").trim() ?? "";
    const match = normalized.match(/\bpages?\s+(\d+)(?:\s*[-–]\s*(\d+))?\b/i);
    if (!match) continue;

    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    for (let page = start; page <= end; page += 1) pageNumbers.add(page);
  }

  return index.pages.filter((page) => pageNumbers.has(page.pageNumber));
}

function chooseMatch(
  index: CanonicalIndex,
  starts: number[],
  sourcePages: string[],
  length: number
): Pick<LocatedQuote, "charStart" | "charEnd"> | null {
  const matches = starts.map((start) => ({ charStart: start, charEnd: start + length }));
  return chooseLocatedMatch(index, matches, sourcePages);
}

function chooseLocatedMatch(
  index: CanonicalIndex,
  matches: Array<Pick<LocatedQuote, "charStart" | "charEnd">>,
  sourcePages: string[]
): Pick<LocatedQuote, "charStart" | "charEnd"> | null {
  if (matches.length === 0) return null;
  const pageHints = estimatedPages(index, sourcePages);
  const hinted = matches.find((match) =>
    pageHints.some(
      (page) => match.charStart >= page.charStart && match.charStart < page.charEnd
    )
  );
  return hinted ?? matches[0];
}

function findAllOccurrences(text: string, search: string): number[] {
  const starts: number[] = [];
  let index = text.indexOf(search);
  while (index !== -1) {
    starts.push(index);
    index = text.indexOf(search, index + 1);
  }
  return starts;
}

function normalizeWithMap(value: string): NormalizedChar[] {
  const chars: NormalizedChar[] = [];
  let previousWasSpace = true;

  for (let index = 0; index < value.length; index += 1) {
    const normalized = normalizeCharacter(value[index]);
    if (!normalized) continue;

    if (/\s/.test(normalized)) {
      if (!previousWasSpace) {
        chars.push({ value: " ", originalIndex: index });
        previousWasSpace = true;
      }
      continue;
    }

    chars.push({ value: normalized, originalIndex: index });
    previousWasSpace = false;
  }

  if (chars.at(-1)?.value === " ") chars.pop();
  return chars;
}

function normalizeComparable(value: string): string {
  return normalizeWithMap(value)
    .map((item) => item.value)
    .join("");
}

function normalizeCharacter(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’‘`´]/g, "'")
    .toLowerCase();

  if (PUNCTUATION_RE.test(normalized)) return "";
  return normalized;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? previous[j - 1]
          : Math.min(previous[j - 1] + 1, previous[j] + 1, current[j - 1] + 1);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}
