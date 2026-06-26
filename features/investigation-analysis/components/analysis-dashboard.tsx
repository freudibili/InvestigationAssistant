"use client";

import { useMemo } from "react";
import {
  CalendarClock,
  FileText,
  Gavel,
  HelpCircle,
  UserSearch,
  Users,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  SourceViewerProvider,
  useSourceViewer,
} from "@/components/pdf/source-viewer-dialog";
import { INTERVIEWEE_ROLE_LABELS } from "@/lib/types";
import type {
  InvestigationAnalysis,
  QuoteRef,
  Reproche,
  ReprocheStatement,
} from "@/features/investigation-analysis/types";

/** Lookup helpers resolving the model's id references back to evidence. */
interface Lookups {
  quoteById: Map<string, QuoteRef>;
  interviewNameById: Map<string, string>;
  reprocheTitleById: Map<string, string>;
}

/** Badge variant per verdict — supported reads strong, unproven reads muted. */
function verdictVariant(
  verdict: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (verdict) {
    case "Supported":
      return "default";
    case "Partially supported":
      return "secondary";
    case "Not established":
      return "outline";
    default:
      return "secondary";
  }
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
      reprocheTitleById: new Map(
        analysis.reproches.map((r) => [r.id, r.title])
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

      <Section
        icon={Gavel}
        title={`Grievances (${analysis.reproches.length})`}
      >
        {analysis.reproches.length === 0 ? (
          <Empty>No grievances triangulated.</Empty>
        ) : (
          <div className="space-y-3">
            {analysis.reproches.map((reproche) => (
              <ReprocheCard
                key={reproche.id}
                reproche={reproche}
                lookups={lookups}
              />
            ))}
          </div>
        )}
      </Section>

      {analysis.globalAssessment ? (
        <Section icon={FileText} title="Overall assessment">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm leading-relaxed whitespace-pre-line">
                {analysis.globalAssessment}
              </p>
            </CardContent>
          </Card>
        </Section>
      ) : null}

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
 * One grievance, triangulated across the parties — the report's Section 5 unit.
 * Renders the claimant's, accused's, and each reference person's account (each
 * with clickable quotes), then a findings/evaluation block reaching a verdict.
 */
function ReprocheCard({
  reproche,
  lookups,
}: {
  reproche: Reproche;
  lookups: Lookups;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">{reproche.title}</CardTitle>
          <Badge variant={verdictVariant(reproche.verdict)}>
            {reproche.verdict}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{reproche.grievanceType}</Badge>
        </div>
        {reproche.description ? (
          <p className="text-muted-foreground text-sm">{reproche.description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <StatementBlock
            label="Claimant"
            statement={reproche.claimantStatement}
            lookups={lookups}
          />
          <StatementBlock
            label="Accused"
            statement={reproche.accusedStatement}
            lookups={lookups}
          />
          {reproche.referenceStatements.map((statement, index) => (
            <StatementBlock
              key={index}
              label={`Reference person ${index + 1}`}
              statement={statement}
              lookups={lookups}
            />
          ))}
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide">
            Findings and evaluation
          </p>
          {reproche.findings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {reproche.findings.map((finding, index) => (
                <li key={index}>{finding}</li>
              ))}
            </ul>
          ) : null}
          {reproche.evaluation ? (
            <p className="text-sm leading-relaxed whitespace-pre-line">
              {reproche.evaluation}
            </p>
          ) : null}
        </div>

        {reproche.openQuestions.length > 0 ? (
          <BulletList label="Open questions" items={reproche.openQuestions} />
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * One party's account within a grievance. Labelled with the role and (when the
 * party was interviewed) the interviewee's name. A role with no interview on
 * record still renders, so a missing account reads as a visible gap.
 */
function StatementBlock({
  label,
  statement,
  lookups,
}: {
  label: string;
  statement: ReprocheStatement;
  lookups: Lookups;
}) {
  const name = statement.interviewId
    ? lookups.interviewNameById.get(statement.interviewId)
    : null;
  const hasContent =
    Boolean(statement.summary) || statement.quoteIds.length > 0;

  return (
    <div className="rounded-md border-l-2 border-muted pl-3 py-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {name ? ` — ${name}` : ""}
      </p>
      {statement.summary ? (
        <p className="mt-1 text-sm">{statement.summary}</p>
      ) : !hasContent ? (
        <p className="mt-1 text-sm italic text-muted-foreground">
          No account on record.
        </p>
      ) : null}
      {statement.quoteIds.length > 0 ? (
        <div className="mt-1.5">
          <QuoteList
            label="Evidence"
            quoteIds={statement.quoteIds}
            lookups={lookups}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * People — one investigation dossier per person, linking them to the grievances
 * naming them and the quotes they spoke (clickable). People who are only
 * name-dropped (no grievances or quotes) are tucked behind a disclosure so the
 * section stays scannable on large cases.
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
      person.relatedReprocheIds.length > 0 ||
      person.supportingQuoteIds.length > 0
  );
  const mentionOnly = analysis.people.filter(
    (person) =>
      person.relatedReprocheIds.length === 0 &&
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
  const reprocheTitles = person.relatedReprocheIds
    .map((id) => lookups.reprocheTitleById.get(id))
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
      {reprocheTitles.length > 0 ? (
        <PartyLine label="Related grievances" names={reprocheTitles} />
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
    { label: "Grievances", value: analysis.reprocheCount },
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
  const roleLabel = quote.intervieweeRole
    ? INTERVIEWEE_ROLE_LABELS[quote.intervieweeRole]
    : null;
  const sourceLabel = [
    quote.intervieweeName ?? quote.documentName,
    roleLabel,
    quote.page !== null ? `Page ${quote.page}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <span className="block space-y-1.5">
      <span className="block text-sm">
        <span className="text-muted-foreground">“</span>
        {quote.text}
        <span className="text-muted-foreground">”</span>
        <span className="text-muted-foreground ml-1 text-xs">
          — {quote.speaker ?? "Unknown"}
        </span>
      </span>
      <Badge
        variant={clickable ? "secondary" : "outline"}
        className="gap-1 text-xs font-normal"
      >
        <FileText className="size-3" />
        {sourceLabel}
      </Badge>
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
          charStart: quote.charStart,
          charEnd: quote.charEnd,
          pageCharStart: quote.pageCharStart,
          pageCharEnd: quote.pageCharEnd,
          normalizedPageCharStart: quote.normalizedPageCharStart,
          normalizedPageCharEnd: quote.normalizedPageCharEnd,
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
