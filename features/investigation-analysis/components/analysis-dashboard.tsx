"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  CalendarClock,
  GitCompareArrows,
  HelpCircle,
  ScrollText,
  UserSearch,
  Users,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  SourceViewerProvider,
  useSourceViewer,
} from "@/components/pdf/source-viewer-dialog";
import type {
  InvestigationAnalysis,
  QuoteRef,
} from "@/features/investigation-analysis/types";

/** Lookup helpers resolving the model's id references back to evidence. */
interface Lookups {
  quoteById: Map<string, QuoteRef>;
  interviewNameById: Map<string, string>;
  allegationTitleById: Map<string, string>;
}

export function AnalysisDashboard({
  analysis,
}: {
  analysis: InvestigationAnalysis;
}) {
  return (
    <SourceViewerProvider>
      <DashboardBody analysis={analysis} />
    </SourceViewerProvider>
  );
}

function DashboardBody({ analysis }: { analysis: InvestigationAnalysis }) {
  const lookups = useMemo<Lookups>(
    () => ({
      quoteById: new Map(analysis.quotes.map((q) => [q.id, q])),
      interviewNameById: new Map(analysis.interviews.map((i) => [i.id, i.name])),
      allegationTitleById: new Map(
        analysis.allegations.map((a) => [a.id, a.title])
      ),
    }),
    [analysis]
  );

  return (
    <div className="space-y-6">
      <SummaryHeader analysis={analysis} />

      <Section icon={Users} title="Main parties">
        {analysis.mainParties.length === 0 ? (
          <Empty>No parties identified.</Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {analysis.mainParties.map((party) => (
              <Badge key={party.name} variant="outline" className="gap-1.5 py-1">
                <span className="font-medium">{party.name}</span>
                <span className="text-muted-foreground">· {party.role}</span>
              </Badge>
            ))}
          </div>
        )}
      </Section>

      <Section icon={ScrollText} title={`Allegations (${analysis.allegations.length})`}>
        {analysis.allegations.length === 0 ? (
          <Empty>No consolidated allegations.</Empty>
        ) : (
          <div className="space-y-3">
            {analysis.allegations.map((allegation) => (
              <Card key={allegation.id}>
                <CardHeader>
                  <CardTitle className="text-base">{allegation.title}</CardTitle>
                  {allegation.description ? (
                    <p className="text-muted-foreground text-sm">
                      {allegation.description}
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-3">
                  <PartyLine label="Claimants" names={allegation.claimants} />
                  <PartyLine label="Subjects" names={allegation.subjects} />
                  <QuoteList
                    label="Supporting evidence"
                    quoteIds={allegation.supportingQuoteIds}
                    lookups={lookups}
                  />
                  <QuoteList
                    label="Contradictory evidence"
                    quoteIds={allegation.contradictoryQuoteIds}
                    lookups={lookups}
                  />
                  {allegation.openQuestions.length > 0 ? (
                    <BulletList
                      label="Open questions"
                      items={allegation.openQuestions}
                    />
                  ) : null}
                  {allegation.timelineConsistency ? (
                    <NoteLine
                      label="Timeline"
                      value={allegation.timelineConsistency}
                    />
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section
        icon={AlertTriangle}
        title={`Patterns (${analysis.mobbingPatterns.length})`}
      >
        {analysis.mobbingPatterns.length === 0 ? (
          <Empty>No recurring patterns identified.</Empty>
        ) : (
          <div className="space-y-3">
            {analysis.mobbingPatterns.map((pattern) => (
              <Card key={pattern.id}>
                <CardHeader>
                  <CardTitle className="text-base">{pattern.title}</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{pattern.repetition}</Badge>
                    <Badge variant="secondary">{pattern.systematicity}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <PartyLine label="Targets" names={pattern.targets} />
                  <PartyLine label="Perpetrators" names={pattern.perpetrators} />
                  <QuoteList
                    label="Supporting evidence"
                    quoteIds={pattern.supportingQuoteIds}
                    lookups={lookups}
                  />
                  {pattern.missingEvidence.length > 0 ? (
                    <BulletList
                      label="Missing evidence"
                      items={pattern.missingEvidence}
                    />
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section
        icon={GitCompareArrows}
        title={`Contradictions (${analysis.contradictions.length})`}
      >
        {analysis.contradictions.length === 0 ? (
          <Empty>No contradictions between accounts.</Empty>
        ) : (
          <div className="space-y-3">
            {analysis.contradictions.map((contradiction) => (
              <Card key={contradiction.id}>
                <CardContent className="space-y-3 pt-6">
                  <p className="text-sm">{contradiction.description}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <QuoteList
                      label={
                        contradiction.interviewAId
                          ? lookups.interviewNameById.get(
                              contradiction.interviewAId
                            ) ?? "Account A"
                          : "Account A"
                      }
                      quoteIds={contradiction.quoteIdsA}
                      lookups={lookups}
                    />
                    <QuoteList
                      label={
                        contradiction.interviewBId
                          ? lookups.interviewNameById.get(
                              contradiction.interviewBId
                            ) ?? "Account B"
                          : "Account B"
                      }
                      quoteIds={contradiction.quoteIdsB}
                      lookups={lookups}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section
        icon={CalendarClock}
        title={`Timeline (${analysis.timeline.length})`}
      >
        {analysis.timeline.length === 0 ? (
          <Empty>No dated events.</Empty>
        ) : (
          <ol className="border-muted space-y-3 border-l pl-4">
            {analysis.timeline.map((event) => (
              <li key={event.id} className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {event.date ?? "Undated"}
                </p>
                <p className="text-sm">{event.description}</p>
                {event.participants.length > 0 ? (
                  <p className="text-muted-foreground text-xs">
                    {event.participants.join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <PeopleSection analysis={analysis} lookups={lookups} />

      <Section icon={Users} title={`Witnesses (${analysis.witnesses.length})`}>
        {analysis.witnesses.length === 0 ? (
          <Empty>No witnesses identified.</Empty>
        ) : (
          <div className="space-y-2">
            {analysis.witnesses.map((witness) => (
              <div key={witness.name} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{witness.name}</p>
                {witness.whyTheyMatter ? (
                  <p className="text-muted-foreground text-sm">
                    {witness.whyTheyMatter}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={HelpCircle} title="Evidence gaps">
        <div className="grid gap-4 sm:grid-cols-3">
          <BulletList
            label="Missing interviews"
            items={analysis.gaps.missingInterviews}
          />
          <BulletList
            label="Missing evidence"
            items={analysis.gaps.missingEvidence}
          />
          <BulletList
            label="Needs clarification"
            items={analysis.gaps.missingClarification}
          />
        </div>
      </Section>
    </div>
  );
}

/**
 * §7 People — one investigation dossier per person, linking them to the
 * allegations naming them and the quotes they spoke (clickable). People who are
 * only name-dropped (no allegations or quotes) are tucked behind a disclosure so
 * the section stays scannable on large cases.
 */
function PeopleSection({
  analysis,
  lookups,
}: {
  analysis: InvestigationAnalysis;
  lookups: Lookups;
}) {
  const withSignal = analysis.people.filter(
    (person) =>
      person.relatedAllegationIds.length > 0 ||
      person.supportingQuoteIds.length > 0
  );
  const mentionOnly = analysis.people.filter(
    (person) =>
      person.relatedAllegationIds.length === 0 &&
      person.supportingQuoteIds.length === 0
  );

  return (
    <Section icon={UserSearch} title={`People (${analysis.people.length})`}>
      {analysis.people.length === 0 ? (
        <Empty>No people identified.</Empty>
      ) : (
        <div className="space-y-2">
          {withSignal.map((person) => (
            <PersonProfile
              key={person.name}
              person={person}
              lookups={lookups}
            />
          ))}
          {mentionOnly.length > 0 ? (
            <details className="rounded-lg border p-3">
              <summary className="text-muted-foreground cursor-pointer text-sm">
                {mentionOnly.length} other mentioned{" "}
                {mentionOnly.length === 1 ? "person" : "people"}
              </summary>
              <p className="mt-2 text-sm">
                {mentionOnly.map((person) => person.name).join(", ")}
              </p>
            </details>
          ) : null}
        </div>
      )}
    </Section>
  );
}

function PersonProfile({
  person,
  lookups,
}: {
  person: InvestigationAnalysis["people"][number];
  lookups: Lookups;
}) {
  const allegationTitles = person.relatedAllegationIds
    .map((id) => lookups.allegationTitleById.get(id))
    .filter((title): title is string => Boolean(title));

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{person.name}</p>
        <p className="text-muted-foreground text-xs">
          Mentioned in {person.interviewIds.length} interview
          {person.interviewIds.length === 1 ? "" : "s"}
        </p>
      </div>
      {allegationTitles.length > 0 ? (
        <PartyLine label="Related allegations" names={allegationTitles} />
      ) : null}
      <QuoteList
        label="Supporting quotes"
        quoteIds={person.supportingQuoteIds}
        lookups={lookups}
      />
    </div>
  );
}

function SummaryHeader({ analysis }: { analysis: InvestigationAnalysis }) {
  const stats = [
    { label: "Interviews", value: analysis.interviewCount },
    { label: "Allegations", value: analysis.allegationCount },
    { label: "Witnesses", value: analysis.witnessCount },
    { label: "Events", value: analysis.eventCount },
  ];

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {analysis.scopeSummary ? (
          <p className="text-sm leading-relaxed">{analysis.scopeSummary}</p>
        ) : (
          <Empty>No scope summary.</Empty>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-semibold">{stat.value}</p>
              <p className="text-muted-foreground text-xs uppercase tracking-wide">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-muted-foreground size-4" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function PartyLine({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      {names.join(", ")}
    </p>
  );
}

function NoteLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      {value}
    </p>
  );
}

function BulletList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </p>
      {items.length === 0 ? (
        <p className="text-muted-foreground mt-1 text-sm italic">None</p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuoteList({
  label,
  quoteIds,
  lookups,
}: {
  label: string;
  quoteIds: string[];
  lookups: Lookups;
}) {
  const quotes = quoteIds
    .map((id) => lookups.quoteById.get(id))
    .filter((quote): quote is QuoteRef => Boolean(quote));

  if (quotes.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </p>
      <div className="space-y-1.5">
        {quotes.map((quote) => (
          <QuoteChip key={quote.id} quote={quote} />
        ))}
      </div>
    </div>
  );
}

/**
 * A verbatim quote rendered as evidence. When the quote carries a real page it
 * is clickable and opens the cited PDF page with the text highlighted; without a
 * page it stays as plain, non-clickable text rather than a dead link.
 */
function QuoteChip({ quote }: { quote: QuoteRef }) {
  const openSource = useSourceViewer();
  const clickable = openSource !== null && quote.page !== null;

  const body = (
    <span className="block text-sm">
      <span className="text-muted-foreground">“</span>
      {quote.text}
      <span className="text-muted-foreground">”</span>
      <span className="text-muted-foreground ml-1 text-xs">
        — {quote.speaker ?? "Unknown"}
        {quote.page !== null ? `, ${quote.documentName} p.${quote.page}` : ""}
      </span>
    </span>
  );

  if (!clickable) {
    return <div className="rounded-md border-l-2 border-muted pl-2">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() =>
        openSource({
          documentId: quote.documentId,
          documentName: quote.documentName,
          label: `Page ${quote.page}`,
          page: quote.page as number,
          quoteId: quote.provenanceId ?? undefined,
          quote: quote.text,
        })
      }
      className="hover:border-foreground block w-full rounded-md border-l-2 border-muted pl-2 text-left transition-colors"
    >
      {body}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
      {children}
    </p>
  );
}
