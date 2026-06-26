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
      const sourceFragment = findSupportedSourceFragment(quotes, fragment);

      if (!sourceFragment) return fragment;

      const openQuote = curly === undefined ? `"` : "“";
      const closeQuote = curly === undefined ? `"` : "”";
      return `${openQuote}${sourceFragment}${closeQuote}`;
    }
  );
}

export function quoteSupportsVisibleInlineFragment(
  text: string,
  quoteText: string
): boolean {
  return Boolean(findVisibleQuotedFragmentMatch(text, quoteText));
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

function findSupportedSourceFragment<TQuote extends MatchableQuote>(
  quotes: TQuote[],
  fragment: string
): string | null {
  for (const quote of quotes) {
    const sourceFragment = findSourceFragment(quote.text, fragment);
    if (sourceFragment) return sourceFragment;
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
  return Boolean(findSourceFragment(quoteText, fragment));
}

function quoteTokens(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

type QuoteToken = {
  value: string;
  index: number;
  endIndex: number;
};

function quoteTokensWithPositions(text: string): QuoteToken[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    value: match[0].toLowerCase(),
    index: match.index,
    endIndex: match.index + match[0].length,
  }));
}

function normalizeQuoteText(value: string): string {
  return quoteTokens(value).join(" ").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSourceFragment(
  quoteText: string,
  fragment: string
): string | null {
  const quoteWords = quoteTokensWithPositions(quoteText);
  const fragmentWords = quoteTokens(fragment).map((token) => token.toLowerCase());
  if (fragmentWords.length === 0 || fragmentWords.length > quoteWords.length) return null;

  const allowedMismatches =
    fragmentWords.length < 8 ? 0 : Math.max(1, Math.floor(fragmentWords.length * 0.08));
  for (let start = 0; start <= quoteWords.length - fragmentWords.length; start += 1) {
    let mismatches = 0;
    for (let index = 0; index < fragmentWords.length; index += 1) {
      if (areSimilarQuoteTokens(quoteWords[start + index].value, fragmentWords[index])) {
        continue;
      }

      mismatches += 1;
      if (mismatches > allowedMismatches) break;
    }

    if (mismatches <= allowedMismatches) {
      const firstToken = quoteWords[start];
      const lastToken = quoteWords[start + fragmentWords.length - 1];
      return quoteText.slice(firstToken.index, lastToken.endIndex);
    }
  }

  return null;
}

function areSimilarQuoteTokens(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 5) return false;
  return levenshteinDistance(left, right) <= 1;
}

function levenshteinDistance(left: string, right: string): number {
  const distances = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let previous = distances[0];
    distances[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const current = distances[rightIndex];
      distances[rightIndex] =
        left[leftIndex - 1] === right[rightIndex - 1]
          ? previous
          : Math.min(previous, distances[rightIndex - 1], distances[rightIndex]) + 1;
      previous = current;
    }
  }

  return distances[right.length];
}

const inlineQuotePattern = /“([^”]{1,500})”|"([^"]{1,500})"/g;
