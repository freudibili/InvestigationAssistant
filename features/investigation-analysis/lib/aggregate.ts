import type { CaseDocument } from "@/lib/types";
import {
  buildDocumentQuotes,
  normalizeText,
  sourceDocumentName,
  sourceRefFor,
} from "@/features/investigation-analysis/lib/catalog";
import type {
  ConsolidatedWitness,
  InterviewRef,
  Party,
  QuoteRef,
  TimelineEvent,
} from "@/features/investigation-analysis/types";

/** A single keyEvent lifted to the case level, with a stable id. */
export interface EventEntry {
  id: string;
  interviewId: string;
  date: string | null;
  description: string;
  participants: string[];
}

/** Compact projection of one interview handed to the LLM. */
export interface AiInterview {
  id: string;
  name: string;
  role: string | null;
  date: string | null;
  issue: string;
  primaryClaimants: string[];
  primaryAccused: string[];
  allegations: {
    title: string;
    description: string;
    claimant: string | null;
    subject: string | null;
    classification: string;
  }[];
  events: { id: string; date: string | null; description: string }[];
  witnesses: string[];
  people: string[];
}

export interface AiQuote {
  id: string;
  interviewId: string;
  speaker: string | null;
  text: string;
}

export interface AggregateResult {
  interviews: InterviewRef[];
  quotes: QuoteRef[];
  quoteById: Map<string, QuoteRef>;
  /** Quotes spoken by a normalized person name → quote ids (for people profiles). */
  quoteIdsBySpeaker: Map<string, string[]>;
  timeline: TimelineEvent[];
  eventIdsByPerson: Map<string, string[]>;
  mainParties: Party[];
  witnesses: ConsolidatedWitness[];
  people: { name: string; interviewIds: string[] }[];
  counts: {
    interviewCount: number;
    allegationCount: number;
    witnessCount: number;
    eventCount: number;
  };
  ai: {
    interviews: AiInterview[];
    quotes: AiQuote[];
    events: { id: string; date: string | null; description: string }[];
  };
}

/** Max quote characters sent to the model (selection only; resolution is full). */
const AI_QUOTE_CHARS = 400;

export function buildAggregate(documents: CaseDocument[]): AggregateResult {
  const extracted = documents.filter((d) => d.extractedData);

  const interviews: InterviewRef[] = [];
  const quotes: QuoteRef[] = [];
  const aiInterviews: AiInterview[] = [];
  const aiEvents: { id: string; date: string | null; description: string }[] = [];
  const eventEntries: EventEntry[] = [];

  // People registry: normalized name → display name + the interviews mentioning
  // them + claimant/accused tallies (for main-party roles).
  const people = new Map<
    string,
    {
      display: string;
      interviewIds: Set<string>;
      claimant: number;
      accused: number;
      mentions: number;
    }
  >();
  const registerPerson = (
    rawName: string,
    interviewId: string,
    kind: "claimant" | "accused" | "mention"
  ) => {
    const name = rawName?.trim();
    if (!name) return;
    const key = normalizeText(name);
    if (!key) return;
    const existing = people.get(key);
    const entry = existing ?? {
      display: name,
      interviewIds: new Set<string>(),
      claimant: 0,
      accused: 0,
      mentions: 0,
    };
    if (name.length > entry.display.length) entry.display = name;
    entry.interviewIds.add(interviewId);
    if (kind === "claimant") entry.claimant += 1;
    else if (kind === "accused") entry.accused += 1;
    else entry.mentions += 1;
    people.set(key, entry);
  };

  const witnesses = new Map<
    string,
    {
      display: string;
      interviewIds: Set<string>;
      relatedAllegations: Set<string>;
      whyTheyMatter: string;
      priority: number;
    }
  >();

  let allegationCount = 0;

  extracted.forEach((document, docIndex) => {
    const data = document.extractedData!;
    const id = document.id;
    const documentName = sourceDocumentName(document);
    const name = data.intervieweeName?.trim() || document.fileName;

    interviews.push({ id, name, documentName });

    // Quotes → catalog.
    const docQuotes = buildDocumentQuotes(document, docIndex);
    quotes.push(...docQuotes);

    // People.
    for (const person of data.peopleMentioned ?? []) {
      registerPerson(person, id, "mention");
    }
    for (const person of data.investigationScope?.primaryClaimants ?? []) {
      registerPerson(person, id, "claimant");
    }
    for (const person of data.investigationScope?.primaryAccused ?? []) {
      registerPerson(person, id, "accused");
    }

    // Allegations (raw count for the summary).
    allegationCount += (data.allegations ?? []).length;

    // Events → case-level entries with ids.
    (data.keyEvents ?? []).forEach((event, eventIndex) => {
      const eventId = `e${docIndex}_${eventIndex}`;
      const entry: EventEntry = {
        id: eventId,
        interviewId: id,
        date: event.date ?? null,
        description: event.description,
        participants: event.participants ?? [],
      };
      eventEntries.push(entry);
      aiEvents.push({ id: eventId, date: entry.date, description: entry.description });
    });

    // Witnesses (prefer the consolidated form; fall back to potential).
    const docWitnesses =
      (data.consolidatedWitnesses ?? []).length > 0
        ? (data.consolidatedWitnesses ?? []).map((w) => ({
            name: w.name,
            why: w.whyTheyMatter,
            related: w.relatedAllegations ?? [],
            priority: w.priorityScore ?? 50,
          }))
        : (data.potentialWitnesses ?? []).map((w) => ({
            name: w.name,
            why: w.relevance,
            related: [] as string[],
            priority: 50,
          }));
    for (const w of docWitnesses) {
      const key = normalizeText(w.name);
      if (!key) continue;
      const entry = witnesses.get(key) ?? {
        display: w.name.trim(),
        interviewIds: new Set<string>(),
        relatedAllegations: new Set<string>(),
        whyTheyMatter: "",
        priority: 0,
      };
      entry.interviewIds.add(id);
      for (const rel of w.related) if (rel.trim()) entry.relatedAllegations.add(rel.trim());
      if (!entry.whyTheyMatter && w.why?.trim()) entry.whyTheyMatter = w.why.trim();
      entry.priority = Math.max(entry.priority, w.priority);
      witnesses.set(key, entry);
    }

    // Compact AI projection.
    aiInterviews.push({
      id,
      name,
      role: data.role ?? null,
      date: data.interviewDate ?? null,
      issue: data.investigationScope?.scopeSummary ?? data.summary ?? "",
      primaryClaimants: data.investigationScope?.primaryClaimants ?? [],
      primaryAccused: data.investigationScope?.primaryAccused ?? [],
      allegations: (data.allegations ?? []).map((a) => ({
        title: a.allegation || a.description,
        description: a.description,
        claimant: a.claimant ?? null,
        subject: a.subject ?? null,
        classification: a.classification,
      })),
      events: (data.keyEvents ?? []).map((event, eventIndex) => ({
        id: `e${docIndex}_${eventIndex}`,
        date: event.date ?? null,
        description: event.description,
      })),
      witnesses: docWitnesses.map((w) => w.display ?? w.name),
      people: data.peopleMentioned ?? [],
    });
  });

  const quoteById = new Map(quotes.map((q) => [q.id, q]));

  // Index quotes by speaker for deterministic person profiles.
  const quoteIdsBySpeaker = new Map<string, string[]>();
  for (const quote of quotes) {
    if (!quote.speaker) continue;
    const key = normalizeText(quote.speaker);
    if (!key) continue;
    const list = quoteIdsBySpeaker.get(key) ?? [];
    list.push(quote.id);
    quoteIdsBySpeaker.set(key, list);
  }

  const timeline = buildTimeline(eventEntries, documents);
  const eventIdsByPerson = indexEventsByPerson(timeline);

  const mainParties = buildMainParties(people);

  const consolidatedWitnesses: ConsolidatedWitness[] = [...witnesses.values()]
    .sort((a, b) => b.priority - a.priority)
    .map((w) => ({
      name: w.display,
      interviewIds: [...w.interviewIds],
      relatedAllegations: [...w.relatedAllegations],
      whyTheyMatter: w.whyTheyMatter,
    }));

  const peopleList = [...people.values()].map((p) => ({
    name: p.display,
    interviewIds: [...p.interviewIds],
  }));

  return {
    interviews,
    quotes,
    quoteById,
    quoteIdsBySpeaker,
    timeline,
    eventIdsByPerson,
    mainParties,
    witnesses: consolidatedWitnesses,
    people: peopleList,
    counts: {
      interviewCount: interviews.length,
      allegationCount,
      witnessCount: consolidatedWitnesses.length,
      eventCount: timeline.length,
    },
    ai: {
      interviews: aiInterviews,
      quotes: quotes.map((q) => ({
        id: q.id,
        interviewId: q.documentId,
        speaker: q.speaker,
        text: q.text.slice(0, AI_QUOTE_CHARS),
      })),
      events: aiEvents,
    },
  };
}

/** Merge duplicate events across interviews and sort chronologically. */
function buildTimeline(
  events: EventEntry[],
  documents: CaseDocument[]
): TimelineEvent[] {
  const docById = new Map(documents.map((d) => [d.id, d]));
  const merged = new Map<string, TimelineEvent>();

  for (const event of events) {
    if (!event.description.trim()) continue;
    const key = `${event.date ?? ""}|${normalizeText(event.description)}`;
    const document = docById.get(event.interviewId);
    const ref = document
      ? sourceRefFor(
          document,
          // We only have the event id here; rebuild the page from the source
          // event via the document's extraction is unnecessary — events carry
          // sourcePages, but we already mapped them in EventEntry-less form.
          undefined
        )
      : null;

    const existing = merged.get(key);
    if (existing) {
      if (!existing.interviewIds.includes(event.interviewId)) {
        existing.interviewIds.push(event.interviewId);
      }
      for (const p of event.participants) {
        if (p.trim() && !existing.participants.includes(p)) {
          existing.participants.push(p);
        }
      }
      if (ref && !existing.sources.some((s) => s.documentId === ref.documentId)) {
        existing.sources.push(ref);
      }
      continue;
    }

    merged.set(key, {
      id: event.id,
      date: event.date,
      description: event.description.trim(),
      participants: event.participants.filter((p) => p.trim()),
      interviewIds: [event.interviewId],
      sources: ref ? [ref] : [],
    });
  }

  return [...merged.values()].sort(compareByDate);
}

function compareByDate(a: { date: string | null }, b: { date: string | null }) {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return a.date.localeCompare(b.date);
}

function indexEventsByPerson(timeline: TimelineEvent[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const event of timeline) {
    for (const participant of event.participants) {
      const key = normalizeText(participant);
      if (!key) continue;
      const list = index.get(key) ?? [];
      list.push(event.id);
      index.set(key, list);
    }
  }
  return index;
}

function buildMainParties(
  people: Map<
    string,
    {
      display: string;
      interviewIds: Set<string>;
      claimant: number;
      accused: number;
      mentions: number;
    }
  >
): Party[] {
  const parties: (Party & { score: number; rank: number })[] = [];

  for (const entry of people.values()) {
    const isClaimant = entry.claimant > 0;
    const isAccused = entry.accused > 0;
    const mentionedIn = entry.interviewIds.size;
    // Keep only people who are a party or are broadly mentioned, so the section
    // stays scannable rather than listing every name in the case.
    if (!isClaimant && !isAccused && mentionedIn < 2) continue;

    let role = "Frequently mentioned";
    let rank = 2;
    if (isAccused && entry.accused >= entry.claimant) {
      role = "Subject of allegations";
      rank = 0;
    } else if (isClaimant) {
      role = "Claimant";
      rank = 1;
    }

    parties.push({
      name: entry.display,
      role,
      interviewIds: [...entry.interviewIds],
      score: mentionedIn,
      rank,
    });
  }

  return parties
    .sort((a, b) => a.rank - b.rank || b.score - a.score)
    .slice(0, 12)
    .map(({ name, role, interviewIds }) => ({ name, role, interviewIds }));
}
