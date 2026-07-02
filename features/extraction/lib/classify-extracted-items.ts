import "server-only";

import { z } from "zod";
import { getExtractionProvider } from "@/features/extraction/lib/providers";
import type { ExtractedData } from "@/lib/types";

export type FindingCategory =
  | "allegation_against_interviewee"
  | "interviewee_response_to_allegation"
  | "interviewee_observation"
  | "management_context"
  | "procedural_context"
  | "event"
  | "fact"
  | "referenced_evidence"
  | "unclear";

const findingCategorySchema = z.enum([
  "allegation_against_interviewee",
  "interviewee_response_to_allegation",
  "interviewee_observation",
  "management_context",
  "procedural_context",
  "event",
  "fact",
  "referenced_evidence",
  "unclear",
]);

const classificationSchema = z.object({
  itemId: z.string(),
  category: findingCategorySchema,
  claimant: z.string().nullable(),
  subject: z.string().nullable(),
  shouldAppearInAllegationsSection: z.boolean(),
  reason: z.string(),
});

const classificationResponseSchema = z.object({
  classifications: z.array(classificationSchema),
});

type Classification = z.infer<typeof classificationSchema>;
type AllegationItem = ExtractedData["allegations"][number];
type QuoteItem = ExtractedData["notableQuotes"][number];
type FactItem = ExtractedData["factualStatements"][number];
type EventItem = ExtractedData["keyEvents"][number];
type EvidenceItem = ExtractedData["observations"][number];

type ClassifierInput = {
  itemId: string;
  title: string;
  currentCategory: "allegation_against_interviewee";
  claimant: string | null;
  subject: string | null;
  verifiedQuoteSpeaker: string | null;
  verifiedQuoteText: string;
  surroundingContext: string | null;
};

const SYSTEM_PROMPT = `You classify already-extracted workplace investigation items.
You receive only verified quotes attached to existing items. Do not extract new content. Do not create, modify, paraphrase, shorten, translate, or invent quotes. Do not return item text or quotes.
Return ONLY JSON with this shape:
{"classifications":[{"itemId":"string","category":"allegation_against_interviewee|interviewee_response_to_allegation|interviewee_observation|management_context|procedural_context|event|fact|referenced_evidence|unclear","claimant":"string|null","subject":"string|null","shouldAppearInAllegationsSection":true,"reason":"string"}]}`;

const USER_PROMPT = `Classify each item into exactly one category and fix attribution.

Categories:
- allegation_against_interviewee
- interviewee_response_to_allegation
- interviewee_observation
- management_context
- procedural_context
- event
- fact
- referenced_evidence
- unclear

Attribution rules:
- If the interviewer says Philippe alleges something, set claimant to Philippe and category to allegation_against_interviewee.
- If Serge says something from his own perspective, set claimant to Serge and category to interviewee_observation unless another category is clearly better.
- If Caroline says something from her own perspective, set claimant to Caroline and category to interviewee_observation unless another category is clearly better.
- If the speaker is known from the verified quote, do not leave claimant null unless the item is not a person's claim or attribution is truly impossible.
- Employment structure, reporting lines, calendar process, meetings, or management setup are management_context.
- Investigation procedure, interview process, evidence handling, complaints process, or procedural chronology are procedural_context.

Allegation rule:
Only set category to allegation_against_interviewee and shouldAppearInAllegationsSection to true if all are true:
1. The claimant is Philippe or the interviewer is explicitly relaying Philippe's allegation.
2. The subject is Caroline or the accused person.
3. The content describes alleged mistreatment, harassment, humiliation, aggressive conduct, pressure, discrimination, retaliation, or similar.
4. The verified quote directly supports that allegation.

Do not classify Serge's management opinions about Philippe as allegations against Caroline.

Interviewee observation rule:
Use interviewee_observation when the interviewee describes Philippe's behavior, communication style, lack of transparency, difficulty accepting challenge, operational problems, performance concerns, or relationship dynamics.

Output rules:
- Return the same itemIds only.
- Return updated fields only.
- Do not return full item text.
- Do not return quotes.
- shouldAppearInAllegationsSection must be true only for allegation_against_interviewee.
- Keep reason under 160 characters.

Items:
{{ITEMS}}`;

export async function classifyExtractedItems(params: {
  extractedData: ExtractedData;
  rawText: string;
}): Promise<ExtractedData> {
  const candidates = buildClassifierInputs(params.extractedData, params.rawText);
  const unquoted = unquotedAllegationClassifications(params.extractedData);

  if (candidates.length === 0) {
    return applyClassifications(params.extractedData, unquoted);
  }

  const { content, truncated } = await getExtractionProvider().complete({
    system: SYSTEM_PROMPT,
    user: USER_PROMPT.replace("{{ITEMS}}", JSON.stringify(candidates)),
  });

  if (truncated || !content) {
    return applyClassifications(params.extractedData, unquoted);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return applyClassifications(params.extractedData, unquoted);
  }

  const result = classificationResponseSchema.safeParse(parsed);
  if (!result.success) {
    return applyClassifications(params.extractedData, unquoted);
  }

  return applyClassifications(params.extractedData, [
    ...unquoted,
    ...result.data.classifications,
  ]);
}

function buildClassifierInputs(
  data: ExtractedData,
  rawText: string
): ClassifierInput[] {
  return data.allegations
    .map((allegation, index): ClassifierInput | null => {
      const quote = firstVerifiedQuote(allegation.relevantQuotes);
      if (!quote) return null;

      return {
        itemId: itemIdForAllegation(index),
        title: allegation.allegation || allegation.description,
        currentCategory: "allegation_against_interviewee",
        claimant: allegation.claimant,
        subject: allegation.subject,
        verifiedQuoteSpeaker: quote.speaker,
        verifiedQuoteText: quote.text,
        surroundingContext: surroundingContextForQuote(rawText, quote.text),
      };
    })
    .filter((item): item is ClassifierInput => Boolean(item));
}

function unquotedAllegationClassifications(data: ExtractedData): Classification[] {
  return data.allegations.flatMap((allegation, index) =>
    firstVerifiedQuote(allegation.relevantQuotes)
      ? []
      : [
          {
            itemId: itemIdForAllegation(index),
            category: "unclear" as const,
            claimant: allegation.claimant,
            subject: allegation.subject,
            shouldAppearInAllegationsSection: false,
            reason: "No verified quote directly supports this as an allegation.",
          },
        ]
  );
}

function applyClassifications(
  data: ExtractedData,
  classifications: Classification[]
): ExtractedData {
  const byId = new Map(classifications.map((item) => [item.itemId, item]));
  const allegations: AllegationItem[] = [];
  const factualStatements: FactItem[] = [...data.factualStatements];
  const keyEvents: EventItem[] = [...data.keyEvents];
  const observations: EvidenceItem[] = [...data.observations];
  const opinions: EvidenceItem[] = [...data.opinions];

  data.allegations.forEach((allegation, index) => {
    const classification = byId.get(itemIdForAllegation(index));
    if (!classification) {
      allegations.push(allegation);
      return;
    }

    const quoteSpeaker = firstVerifiedQuote(allegation.relevantQuotes)?.speaker ?? null;
    const claimant = classification.claimant ?? allegation.claimant ?? quoteSpeaker;
    const subject = classification.subject ?? allegation.subject;

    if (
      classification.category === "allegation_against_interviewee" &&
      classification.shouldAppearInAllegationsSection
    ) {
      allegations.push({
        ...allegation,
        claimant,
        subject,
      });
      return;
    }

    addDemotedItem({
      allegation,
      category: classification.category,
      claimant,
      subject,
      factualStatements,
      keyEvents,
      observations,
      opinions,
    });
  });

  return {
    ...data,
    allegations: dedupeAllegations(allegations),
    factualStatements: dedupeFacts(factualStatements),
    keyEvents: dedupeEvents(keyEvents),
    observations: dedupeEvidence(observations),
    opinions: dedupeEvidence(opinions),
  };
}

function addDemotedItem(params: {
  allegation: AllegationItem;
  category: FindingCategory;
  claimant: string | null;
  subject: string | null;
  factualStatements: FactItem[];
  keyEvents: EventItem[];
  observations: EvidenceItem[];
  opinions: EvidenceItem[];
}) {
  const description = params.allegation.allegation || params.allegation.description;
  const sourcePages = params.allegation.sourcePages;
  const supportingQuotes = params.allegation.relevantQuotes;

  if (params.category === "event") {
    params.keyEvents.push({
      title: description,
      date: params.allegation.date,
      approximateDate: false,
      description,
      participants: [params.claimant, params.subject].filter(
        (value): value is string => Boolean(value)
      ),
      supportingQuotes,
      sourcePages,
      evidenceStatus: evidenceStatusForQuotes(supportingQuotes),
    });
    return;
  }

  if (params.category === "interviewee_observation") {
    params.observations.push({ description, sourcePages });
    params.factualStatements.push({
      description,
      supportingQuotes,
      sourcePages,
      evidenceStatus: evidenceStatusForQuotes(supportingQuotes),
    });
    return;
  }

  if (params.category === "interviewee_response_to_allegation") {
    params.opinions.push({ description, sourcePages });
    params.factualStatements.push({
      description,
      supportingQuotes,
      sourcePages,
      evidenceStatus: evidenceStatusForQuotes(supportingQuotes),
    });
    return;
  }

  params.factualStatements.push({
    description,
    supportingQuotes,
    sourcePages,
    evidenceStatus: evidenceStatusForQuotes(supportingQuotes),
  });
}

function evidenceStatusForQuotes(
  quotes: QuoteItem[],
): FactItem["evidenceStatus"] {
  if (quotes.some((quote) => quote.provenance?.verified)) return "supported";
  return quotes.length > 0 ? "needs_review" : "unsupported";
}

function firstVerifiedQuote(quotes: QuoteItem[]): QuoteItem | null {
  return quotes.find((quote) => quote.provenance?.verified) ?? null;
}

function surroundingContextForQuote(rawText: string, quoteText: string): string | null {
  const index = rawText.indexOf(quoteText);
  if (index < 0) return null;

  const before = rawText.slice(0, index).split(/\r?\n/).slice(-2);
  const after = rawText
    .slice(index + quoteText.length)
    .split(/\r?\n/)
    .slice(0, 2);
  const context = [...before, quoteText, ...after]
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return context.length > 1_500 ? `${context.slice(0, 1_500).trimEnd()}...` : context;
}

function itemIdForAllegation(index: number): string {
  return `allegations.${index}`;
}

function dedupeAllegations(items: AllegationItem[]): AllegationItem[] {
  return dedupeByKey(
    items,
    (item) =>
      [
        item.date ?? "",
        item.claimant ?? "",
        item.subject ?? "",
        normalizeForComparison(item.allegation || item.description),
        item.sourcePages.join(","),
      ].join("|")
  );
}

function dedupeFacts(items: FactItem[]): FactItem[] {
  return dedupeByKey(
    items,
    (item) =>
      [normalizeForComparison(item.description), item.sourcePages.join(",")].join(
        "|"
      )
  );
}

function dedupeEvents(items: EventItem[]): EventItem[] {
  return dedupeByKey(
    items,
    (item) =>
      [
        item.date ?? "",
        normalizeForComparison(item.description),
        item.sourcePages.join(","),
      ].join("|")
  );
}

function dedupeEvidence(items: EvidenceItem[]): EvidenceItem[] {
  return dedupeByKey(
    items,
    (item) =>
      [normalizeForComparison(item.description), item.sourcePages.join(",")].join(
        "|"
      )
  );
}

function dedupeByKey<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function normalizeForComparison(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
