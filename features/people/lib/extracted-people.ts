import type { ExtractedData } from "@/lib/types";

type ExtractedQuote = ExtractedData["notableQuotes"][number];
type Witness = ExtractedData["potentialWitnesses"][number];
type ConsolidatedWitness = ExtractedData["consolidatedWitnesses"][number];
type Identity = ExtractedData["canonicalIdentities"][number];
type Allegation = ExtractedData["allegations"][number];
type Event = ExtractedData["keyEvents"][number];

export function collectEditablePeople(data: ExtractedData): string[] {
  return uniqueNames([
    data.intervieweeName,
    ...data.interviewerNames,
    ...data.peopleMentioned,
    ...data.investigationScope.primaryClaimants,
    ...data.investigationScope.primaryAccused,
    ...data.allegations.flatMap((allegation) => [
      allegation.claimant,
      allegation.subject,
      ...allegation.witnesses.map((witness) => witness.name),
    ]),
    ...data.keyEvents.flatMap((event) => event.participants),
    ...data.potentialWitnesses.map((witness) => witness.name),
    ...data.consolidatedWitnesses.map((witness) => witness.name),
    ...data.canonicalIdentities.flatMap((identity) => [
      identity.canonicalName,
      ...identity.variants,
    ]),
  ]);
}

export function renamePersonReferences(
  data: ExtractedData,
  currentName: string,
  nextName: string,
): ExtractedData {
  const source = currentName.trim();
  const target = nextName.trim();
  if (!source || !target || source === target) return data;

  const rename = (name: string) =>
    isSameName(name, source) ? target : name.trim();
  const renameNullable = (name: string | null) =>
    name === null ? null : rename(name);
  const renameQuote = (quote: ExtractedQuote): ExtractedQuote => ({
    ...quote,
    speaker: renameNullable(quote.speaker),
  });
  const renameWitness = (witness: Witness): Witness => ({
    ...witness,
    name: rename(witness.name),
    supportingQuotes: witness.supportingQuotes.map(renameQuote),
  });
  const renameAllegation = (allegation: Allegation): Allegation => ({
    ...allegation,
    claimant: renameNullable(allegation.claimant),
    subject: renameNullable(allegation.subject),
    relevantQuotes: allegation.relevantQuotes.map(renameQuote),
    witnesses: mergeWitnesses(allegation.witnesses.map(renameWitness)),
  });
  const renameEvent = (event: Event): Event => ({
    ...event,
    participants: uniqueNames(event.participants.map(rename)),
    supportingQuotes: event.supportingQuotes.map(renameQuote),
  });

  return {
    ...data,
    intervieweeName: renameNullable(data.intervieweeName),
    interviewerNames: uniqueNames(data.interviewerNames.map(rename)),
    peopleMentioned: uniqueNames(data.peopleMentioned.map(rename)),
    investigationScope: {
      ...data.investigationScope,
      primaryClaimants: uniqueNames(
        data.investigationScope.primaryClaimants.map(rename),
      ),
      primaryAccused: uniqueNames(
        data.investigationScope.primaryAccused.map(rename),
      ),
    },
    allegations: data.allegations.map(renameAllegation),
    keyEvents: data.keyEvents.map(renameEvent),
    notableQuotes: data.notableQuotes.map(renameQuote),
    factualStatements: data.factualStatements.map((fact) => ({
      ...fact,
      supportingQuotes: fact.supportingQuotes.map(renameQuote),
    })),
    potentialWitnesses: mergeWitnesses(
      data.potentialWitnesses.map(renameWitness),
    ),
    consolidatedWitnesses: mergeConsolidatedWitnesses(
      data.consolidatedWitnesses.map((witness) => ({
        ...witness,
        name: rename(witness.name),
      })),
    ),
    canonicalIdentities: mergeIdentities(
      data.canonicalIdentities.map((identity) =>
        renameIdentity(identity, source, target, rename),
      ),
    ),
    pageFindings: data.pageFindings.map((finding) => ({
      ...finding,
      allegations: finding.allegations.map(renameAllegation),
      notableQuotes: finding.notableQuotes.map(renameQuote),
      potentialWitnesses: mergeWitnesses(
        finding.potentialWitnesses.map(renameWitness),
      ),
      relevantEvents: finding.relevantEvents.map(renameEvent),
    })),
  };
}

function renameIdentity(
  identity: Identity,
  source: string,
  target: string,
  rename: (name: string) => string,
): Identity {
  const containsSource = [identity.canonicalName, ...identity.variants].some(
    (name) => isSameName(name, source),
  );
  const canonicalName = containsSource ? target : rename(identity.canonicalName);

  return {
    ...identity,
    canonicalName,
    variants: uniqueNames([
      ...identity.variants.map(rename),
      ...(containsSource ? [source] : []),
    ]).filter((variant) => !isSameName(variant, canonicalName)),
  };
}

function mergeWitnesses(witnesses: Witness[]): Witness[] {
  const merged = new Map<string, Witness>();

  for (const witness of witnesses) {
    const key = normalizeName(witness.name);
    const existing = merged.get(key);
    merged.set(
      key,
      existing
        ? {
            ...existing,
            relevance: mergeText(existing.relevance, witness.relevance),
            relatedAllegations: uniqueValues([
              ...existing.relatedAllegations,
              ...witness.relatedAllegations,
            ]),
            supportingQuotes: uniqueQuotes([
              ...existing.supportingQuotes,
              ...witness.supportingQuotes,
            ]),
            sourcePages: uniqueValues([
              ...existing.sourcePages,
              ...witness.sourcePages,
            ]),
          }
        : witness,
    );
  }

  return Array.from(merged.values());
}

function mergeConsolidatedWitnesses(
  witnesses: ConsolidatedWitness[],
): ConsolidatedWitness[] {
  const merged = new Map<string, ConsolidatedWitness>();

  for (const witness of witnesses) {
    const key = normalizeName(witness.name);
    const existing = merged.get(key);
    merged.set(
      key,
      existing
        ? {
            ...existing,
            whyTheyMatter: mergeText(
              existing.whyTheyMatter,
              witness.whyTheyMatter,
            ),
            relatedAllegations: uniqueValues([
              ...existing.relatedAllegations,
              ...witness.relatedAllegations,
            ]),
            mentionedInInterviews: uniqueValues([
              ...existing.mentionedInInterviews,
              ...witness.mentionedInInterviews,
            ]),
            priorityScore: Math.max(
              existing.priorityScore,
              witness.priorityScore,
            ),
            sourcePages: uniqueValues([
              ...existing.sourcePages,
              ...witness.sourcePages,
            ]),
          }
        : witness,
    );
  }

  return Array.from(merged.values());
}

function mergeIdentities(identities: Identity[]): Identity[] {
  const merged = new Map<string, Identity>();

  for (const identity of identities) {
    const key = normalizeName(identity.canonicalName);
    const existing = merged.get(key);
    merged.set(
      key,
      existing
        ? {
            ...existing,
            variants: uniqueNames([
              ...existing.variants,
              ...identity.variants,
            ]).filter(
              (variant) => !isSameName(variant, identity.canonicalName),
            ),
            role: existing.role ?? identity.role,
            sourcePages: uniqueValues([
              ...existing.sourcePages,
              ...identity.sourcePages,
            ]),
          }
        : identity,
    );
  }

  return Array.from(merged.values());
}

function uniqueQuotes(quotes: ExtractedQuote[]): ExtractedQuote[] {
  return Array.from(
    new Map(
      quotes.map((quote) => [
        quote.provenance?.id ?? `${quote.speaker ?? ""}|${quote.text}`,
        quote,
      ]),
    ).values(),
  );
}

function mergeText(first: string, second: string): string {
  if (!first.trim()) return second;
  if (!second.trim() || first.trim() === second.trim()) return first;
  return `${first.trim()} / ${second.trim()}`;
}

function uniqueNames(names: Array<string | null>): string[] {
  const unique = new Map<string, string>();

  for (const name of names) {
    const trimmed = name?.trim();
    if (trimmed && !unique.has(normalizeName(trimmed))) {
      unique.set(normalizeName(trimmed), trimmed);
    }
  }

  return Array.from(unique.values()).sort((first, second) =>
    first.localeCompare(second),
  );
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isSameName(first: string, second: string): boolean {
  return normalizeName(first) === normalizeName(second);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
