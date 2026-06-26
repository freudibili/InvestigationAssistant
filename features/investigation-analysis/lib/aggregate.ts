import type { CaseDocument, IntervieweeRole } from "@/lib/types";
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
  sourcePages: string[];
}

/** Compact projection of one interview handed to the LLM. */
export interface AiInterview {
  id: string;
  name: string;
  role: string | null;
  roleHint: "claimant" | "accused" | "reference";
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

type MainPartyCaseRole = Party["caseRole"];
type ExtractedData = NonNullable<CaseDocument["extractedData"]>;

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
    reprocheCount: number;
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

  const people = new Map<
    string,
    {
      display: string;
      interviewIds: Set<string>;
    }
  >();
  const registerPerson = (rawName: string, interviewId: string) => {
    const name = rawName?.trim();
    if (!name) return;
    const key = normalizeText(name);
    if (!key) return;
    const existing = people.get(key);
    const entry = existing ?? {
      display: name,
      interviewIds: new Set<string>(),
    };
    if (name.length > entry.display.length) entry.display = name;
    entry.interviewIds.add(interviewId);
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
      registerPerson(person, id);
    }
    for (const person of data.investigationScope?.primaryClaimants ?? []) {
      registerPerson(person, id);
    }
    for (const person of data.investigationScope?.primaryAccused ?? []) {
      registerPerson(person, id);
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
        sourcePages: event.sourcePages ?? [],
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
      roleHint: roleHintForIntervieweeRole(document.intervieweeRole),
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
      witnesses: docWitnesses.map((w) => w.name),
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

  const mainParties = buildMainParties(extracted);

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
      // Fallback only — the real count is the model's consolidated grievances.
      reprocheCount: allegationCount,
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

function roleHintForIntervieweeRole(
  role: IntervieweeRole | null
): AiInterview["roleHint"] {
  if (role === "claimant" || role === "accused") return role;
  return "reference";
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
    const ref = document ? sourceRefFor(document, event.sourcePages) : null;

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

function buildMainParties(documents: CaseDocument[]): Party[] {
  const parties = new Map<
    string,
    Party & { aliasesSet: Set<string>; roleRank: number }
  >();

  for (const document of documents) {
    if (!document.extractedData || !document.intervieweeRole) continue;

    const caseRole = caseRoleForIntervieweeRole(document.intervieweeRole);
    const rawIntervieweeName = document.extractedData.intervieweeName?.trim();
    if (!rawIntervieweeName) continue;

    const identity = findIdentityForName(
      document.extractedData.canonicalIdentities,
      rawIntervieweeName
    );
    const canonicalName = identity?.canonicalName.trim() || rawIntervieweeName;
    const key = normalizeText(canonicalName);
    if (!key) continue;

    const aliases = aliasesForParty(
      canonicalName,
      rawIntervieweeName,
      document.extractedData.canonicalIdentities
    );
    const roleRank = mainPartyRoleRank(caseRole);
    const existing = parties.get(key);

    if (existing) {
      for (const alias of aliases) existing.aliasesSet.add(alias);
      if (!existing.jobRole && document.extractedData.role) {
        existing.jobRole = document.extractedData.role;
      }
      if (roleRank < existing.roleRank) existing.caseRole = caseRole;
      existing.roleRank = Math.min(existing.roleRank, roleRank);
      continue;
    }

    parties.set(key, {
      personId: key,
      canonicalName,
      caseRole,
      jobRole: document.extractedData.role ?? null,
      interviewDocumentId: document.id,
      interviewDocumentName: sourceDocumentName(document),
      aliases,
      aliasesSet: new Set(aliases),
      roleRank,
    });
  }

  return [...parties.values()]
    .sort((a, b) => a.roleRank - b.roleRank)
    .slice(0, 8)
    .map(({ aliasesSet, roleRank, ...party }) => ({
      ...party,
      aliases: [...aliasesSet],
    }));
}

function caseRoleForIntervieweeRole(
  role: IntervieweeRole
): MainPartyCaseRole {
  if (role === "witness") return "reference_person";
  return role;
}

function mainPartyRoleRank(role: MainPartyCaseRole): number {
  switch (role) {
    case "claimant":
      return 0;
    case "accused":
      return 1;
    case "reference_person":
      return 2;
    case "witness":
      return 3;
    case "investigator":
      return 4;
  }
}

function findIdentityForName(
  identities: ExtractedData["canonicalIdentities"],
  name: string
) {
  const key = normalizeText(name);

  return identities.find((identity) => {
    const names = [identity.canonicalName, ...identity.variants];
    return names.some((value) => normalizeText(value) === key);
  });
}

function aliasesForParty(
  canonicalName: string,
  intervieweeName: string,
  identities: ExtractedData["canonicalIdentities"]
): string[] {
  const canonicalKey = normalizeText(canonicalName);
  const aliases = new Set<string>();

  for (const identity of identities) {
    const names = [identity.canonicalName, ...identity.variants];
    if (!names.some((name) => normalizeText(name) === canonicalKey)) continue;

    for (const name of names) addAlias(name, canonicalKey, aliases);
  }

  addAlias(intervieweeName, canonicalKey, aliases);
  return [...aliases];
}

function addAlias(
  name: string,
  canonicalKey: string,
  aliases: Set<string>
): void {
  const trimmed = name.trim();
  if (!trimmed || normalizeText(trimmed) === canonicalKey) return;
  aliases.add(trimmed);
}
