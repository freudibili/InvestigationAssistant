export type MatchableQuote = {
  id: string;
  text: string;
};

export type QuoteTextMatch<TQuote extends MatchableQuote> = {
  index: number;
  endIndex: number;
  quote: TQuote;
};

type TextMatch = {
  index: number;
  endIndex: number;
};

export function buildQuoteTextMatches<TQuote extends MatchableQuote>(
  text: string,
  quotes: TQuote[]
): QuoteTextMatch<TQuote>[] {
  const candidates = quotes
    .map((quote) => {
      const match = findQuoteTextMatch(text, quote.text);
      return match ? { ...match, quote } : null;
    })
    .filter((match): match is QuoteTextMatch<TQuote> => Boolean(match));

  const selected: QuoteTextMatch<TQuote>[] = [];
  for (const match of candidates.sort(
    (a, b) => b.endIndex - b.index - (a.endIndex - a.index)
  )) {
    const overlaps = selected.some(
      (selectedMatch) =>
        match.index < selectedMatch.endIndex &&
        selectedMatch.index < match.endIndex
    );
    if (!overlaps) selected.push(match);
  }

  return selected.sort((a, b) => a.index - b.index);
}

export function findQuoteTextMatch(
  text: string,
  quoteText: string
): TextMatch | null {
  return (
    matchQuoteTokens(text, quoteTokens(quoteText)) ??
    findVisibleQuotedFragmentMatch(text, quoteText) ??
    findBestPartialQuoteMatch(text, quoteText)
  );
}

export function removeUnsupportedInlineQuotes<TQuote extends MatchableQuote>(
  summary: string,
  quotes: TQuote[]
): string {
  return summary.replace(
    inlineQuotePattern,
    (match, curly: string | undefined, straight: string | undefined) => {
      const fragment = curly ?? straight ?? "";
      const isSupported = quotes.some((quote) =>
        quoteContainsFragment(quote.text, fragment)
      );

      return isSupported ? match : fragment;
    }
  );
}

function findVisibleQuotedFragmentMatch(
  text: string,
  quoteText: string
): TextMatch | null {
  for (const match of text.matchAll(inlineQuotePattern)) {
    const fragment = match[1] ?? match[2] ?? "";
    if (!quoteContainsFragment(quoteText, fragment)) continue;

    return { index: match.index, endIndex: match.index + match[0].length };
  }

  return null;
}

function findBestPartialQuoteMatch(text: string, quoteText: string): TextMatch | null {
  for (const tokens of quoteTokenWindows(quoteText)) {
    const match = matchQuoteTokens(text, tokens);
    if (match) return match;
  }

  return null;
}

function quoteTokenWindows(text: string): string[][] {
  const words = quoteTokens(text).slice(0, 80);
  const windows: string[][] = [];

  for (let size = words.length - 1; size >= 2; size -= 1) {
    for (let start = 0; start <= words.length - size; start += 1) {
      windows.push(words.slice(start, start + size));
    }
  }

  return windows;
}

function matchQuoteTokens(text: string, tokens: string[]): TextMatch | null {
  if (tokens.length === 0) return null;

  const pattern = tokens.map(escapeRegExp).join("[\\s\\p{P}\\p{S}]+");
  const match = new RegExp(pattern, "iu").exec(text);

  return match ? { index: match.index, endIndex: match.index + match[0].length } : null;
}

function quoteContainsFragment(quoteText: string, fragment: string): boolean {
  const normalizedFragment = normalizeQuoteText(fragment);
  return (
    normalizedFragment.length > 0 &&
    normalizeQuoteText(quoteText).includes(normalizedFragment)
  );
}

function quoteTokens(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function normalizeQuoteText(value: string): string {
  return quoteTokens(value).join(" ").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const inlineQuotePattern = /“([^”]{1,200})”|"([^"]{1,200})"/g;
