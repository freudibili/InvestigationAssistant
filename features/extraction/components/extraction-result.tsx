"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CalendarClock,
  CircleHelp,
  FileText,
  ListChecks,
  MessageSquareQuote,
  ShieldAlert,
  UserCheck,
  Users,
} from "lucide-react";
import type * as React from "react";
import {
  SourceViewerProvider,
  useSourceViewer,
} from "@/components/pdf/source-viewer-dialog";
import { getExtension, getSupportedExtension } from "@/lib/documents";
import type { CaseDocument, ExtractedData } from "@/lib/types";

type QuoteItem = ExtractedData["notableQuotes"][number];
type WitnessItem = ExtractedData["potentialWitnesses"][number];
type SourceContext = {
  caseId: string;
  documentId: string;
  documentName: string;
  /**
   * Whether the stored source is a paginated PDF (native or converted). Drives
   * the empty-state wording: an uncited item on a paginated document just has no
   * source page, whereas an unpaginated source can never be cited.
   */
  paginationAvailable: boolean;
};
type PageReference = {
  label: string;
  pageStart: number;
};
type QuoteProvenance = NonNullable<QuoteItem["provenance"]>;

/** Collapse a section behind a <details> once it grows past this many items. */
const COLLAPSE_THRESHOLD = 12;
const NO_VERIFIED_QUOTE = "No verified supporting quote available.";

/**
 * The name to show for the cited source. When the stored object is a paginated
 * PDF but the upload was a non-PDF (converted at extraction time), display the
 * `.pdf` name we actually link to instead of the original `.docx`/`.txt` name.
 */
function sourceDisplayName(fileName: string, isPdfSource: boolean): string {
  const ext = getExtension(fileName);
  if (!isPdfSource || ext === ".pdf") return fileName;
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  return `${base}.pdf`;
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-0.5 text-sm">
        {value && value.trim().length > 0 ? (
          value
        ) : (
          <span className="text-muted-foreground italic">Not found</span>
        )}
      </p>
    </div>
  );
}

/**
 * The source evidence for an extracted item. Every quote (and every traceable
 * item) carries its own independent page badge — clicking it opens the PDF at
 * that page. When no reliable page is available we show a compact, non-clickable
 * "Source unavailable" badge rather than fabricating a page number.
 */
function SourceBadges({
  pages,
  source,
  quote,
  provenance,
}: {
  pages?: string[];
  source: SourceContext;
  /** When the cited item is a quote, its verbatim text — highlighted in the PDF. */
  quote?: string;
  provenance?: QuoteProvenance;
}) {
  if (provenance) {
    if (!isClickableQuoteProvenance(provenance)) {
      return (
        <Badge
          variant="outline"
          className="text-muted-foreground gap-1 text-xs font-normal"
        >
          <FileText className="size-3" />
          {NO_VERIFIED_QUOTE}
        </Badge>
      );
    }

    return (
      <SourcePageBadge
        page={{
          label: `Page ${provenance.pageNumber}`,
          pageStart: provenance.pageNumber,
        }}
        source={source}
        quote={quote}
        provenance={provenance}
      />
    );
  }

  if (quote) {
    return (
      <Badge
        variant="outline"
        className="text-muted-foreground gap-1 text-xs font-normal"
      >
        <FileText className="size-3" />
        {NO_VERIFIED_QUOTE}
      </Badge>
    );
  }

  const pageReferences = (pages ?? [])
    .map(parsePageReference)
    .filter((page): page is PageReference => Boolean(page));

  if (pageReferences.length === 0) {
    return (
      <Badge
        variant="outline"
        className="text-muted-foreground gap-1 text-xs font-normal"
      >
        <FileText className="size-3" />
        Source unavailable
      </Badge>
    );
  }

  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {pageReferences.map((page) => (
        <SourcePageBadge
          key={page.label}
          page={page}
          source={source}
          quote={quote}
          provenance={provenance}
        />
      ))}
    </span>
  );
}

type ClickableQuoteProvenance = QuoteProvenance & {
  pageNumber: number;
  charStart: number;
  charEnd: number;
};

function isClickableQuoteProvenance(
  provenance: QuoteProvenance
): provenance is ClickableQuoteProvenance {
  return (
    provenance.verified &&
    provenance.pageNumber !== null &&
    provenance.charStart !== null &&
    provenance.charEnd !== null &&
    (provenance.sourceStatus === "verified" ||
      provenance.sourceStatus === "fuzzy_verified")
  );
}

function SourcePageBadge({
  page,
  source,
  quote,
  provenance,
}: {
  page: PageReference;
  source: SourceContext;
  quote?: string;
  provenance?: QuoteProvenance;
}) {
  const openViewer = useSourceViewer();

  return (
    <button
      type="button"
      onClick={() =>
        openViewer?.({
          documentId: source.documentId,
          caseId: source.caseId,
          documentName: source.documentName,
          label: page.label,
          page: page.pageStart,
          quoteId: provenance?.id,
          charStart: provenance?.charStart,
          charEnd: provenance?.charEnd,
          pageCharStart: provenance?.pageCharStart,
          pageCharEnd: provenance?.pageCharEnd,
          normalizedPageCharStart: provenance?.normalizedPageCharStart,
          normalizedPageCharEnd: provenance?.normalizedPageCharEnd,
          quote,
        })
      }
      title={`Open ${source.documentName} at ${page.label}`}
      className="focus-visible:ring-ring rounded-md focus:outline-none focus-visible:ring-2"
    >
      <Badge
        variant="secondary"
        className="hover:bg-accent cursor-pointer gap-1 text-xs font-normal"
      >
        <FileText className="size-3" />
        {page.label}
      </Badge>
    </button>
  );
}

function parsePageReference(
  value: string | null | undefined
): PageReference | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (
    !normalized ||
    /^chunks?\b/i.test(normalized) ||
    /^internal segments?\b/i.test(normalized) ||
    /pagination unavailable|source location unavailable/i.test(normalized)
  ) {
    return null;
  }

  const pageMatch = normalized.match(
    /\bpages?\s+(\d+)(?:\s*[-–]\s*(\d+))?\b/i
  );
  if (pageMatch) {
    return {
      label: pageMatch[2]
        ? `Pages ${pageMatch[1]}-${pageMatch[2]}`
        : `Page ${pageMatch[1]}`,
      pageStart: Number(pageMatch[1]),
    };
  }

  const barePageNumber = normalized.match(/^(\d+)$/);
  if (barePageNumber) {
    return {
      label: `Page ${barePageNumber[1]}`,
      pageStart: Number(barePageNumber[1]),
    };
  }

  return null;
}

function EmptyState({ children }: { children: string }) {
  return <p className="text-muted-foreground text-sm italic">{children}</p>;
}

/**
 * A single quote rendered as evidence: the quoted text plus its own clickable
 * page badge. The quote is the evidence — the badge is attached to the quote,
 * never to a generic per-card "Sources" block.
 */
function Quote({
  quote,
  source,
}: {
  quote: QuoteItem;
  source: SourceContext;
}) {
  return (
    <blockquote className="border-muted-foreground/30 space-y-1.5 border-l-2 pl-3">
      <p className="text-sm italic leading-relaxed">
        {quote.speaker ? (
          <span className="text-muted-foreground not-italic">
            {quote.speaker}:{" "}
          </span>
        ) : null}
        “{quote.text}”
      </p>
      <SourceBadges
        pages={quote.sourcePages}
        source={source}
        quote={quote.text}
        provenance={quote.provenance}
      />
    </blockquote>
  );
}

function QuoteList({
  quotes,
  empty,
  source,
}: {
  quotes: QuoteItem[];
  empty: string;
  source: SourceContext;
}) {
  const verifiedQuotes = quotes.filter((quote) =>
    quote.provenance ? isClickableQuoteProvenance(quote.provenance) : false
  );

  if (verifiedQuotes.length === 0) return <EmptyState>{empty}</EmptyState>;

  return (
    <div className="space-y-3">
      {verifiedQuotes.map((quote, i) => (
        <Quote key={i} quote={quote} source={source} />
      ))}
    </div>
  );
}

function SectionCard({
  title,
  count,
  icon: Icon,
  children,
}: {
  title: string;
  count?: number;
  icon: typeof ListChecks;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4" />
          {title}
          {typeof count === "number" ? (
            <span className="text-muted-foreground font-normal">({count})</span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * A section that collapses behind a disclosure once it grows long, keeping the
 * page scannable. Open by default while short.
 */
function CollapsibleSectionCard({
  title,
  count,
  icon: Icon,
  collapsed,
  children,
}: {
  title: string;
  count: number;
  icon: typeof ListChecks;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <details open={!collapsed}>
        <summary className="cursor-pointer list-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="size-4" />
              {title}
              <span className="text-muted-foreground font-normal">
                ({count})
              </span>
            </CardTitle>
          </CardHeader>
        </summary>
        <CardContent>{children}</CardContent>
      </details>
    </Card>
  );
}

export function ExtractionResult({
  document,
}: {
  document: CaseDocument;
}) {
  const data = document.extractedData;
  // The stored object is a paginated PDF when it's a native PDF or has been
  // converted at extraction time; `fileUrl` (not `fileName`) reflects that.
  const isPdfSource = getSupportedExtension(document.fileUrl) === ".pdf";
  const source: SourceContext = {
    caseId: document.caseId,
    documentId: document.id,
    // A non-PDF upload is converted to a paginated PDF at extraction time and
    // the source link/viewer serves that PDF. The original `fileName` keeps its
    // `.docx`/`.txt` extension, so surface the `.pdf` name we actually open.
    documentName: sourceDisplayName(document.fileName, isPdfSource),
    paginationAvailable: isPdfSource,
  };

  if (!data) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-8 text-center text-sm">
          No extraction data available for this document.
        </CardContent>
      </Card>
    );
  }

  const interviewerNames = data.interviewerNames ?? [];
  const extractionWarnings = data.extractionWarnings ?? [];
  const allegations = data.allegations ?? [];
  const facts = data.factualStatements ?? [];
  const peopleMentioned = data.peopleMentioned ?? [];
  const events = data.keyEvents ?? [];
  const witnesses = data.potentialWitnesses ?? [];
  const notableQuotes = data.notableQuotes ?? [];
  const followUpQuestions = data.followUpQuestions ?? [];

  return (
    <SourceViewerProvider>
      <div className="space-y-6">
        {/* 1. Document Information */}
        <SectionCard title="Document Information" icon={FileText}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="File Name" value={source.documentName} />
            <Field label="Interviewee" value={data.intervieweeName} />
            <Field
              label="Interviewer"
              value={
                interviewerNames.length > 0 ? interviewerNames.join(", ") : null
              }
            />
            <Field label="Date" value={data.interviewDate} />
            <Field label="Role" value={data.role} />
          </div>
          {extractionWarnings.length > 0 ? (
            <div className="mt-4 border-t pt-4">
              <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
                <AlertTriangle className="size-3.5" />
                Extraction Warnings ({extractionWarnings.length})
              </p>
              <ul className="list-inside list-disc space-y-1 text-sm">
                {extractionWarnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </SectionCard>

        {/* 2. Allegations Mentioned */}
        <SectionCard
          title="Allegations Mentioned"
          count={allegations.length}
          icon={ShieldAlert}
        >
          {allegations.length > 0 ? (
            <div className="space-y-4">
              {allegations.map((allegation, i) => (
                <div key={i} className="bg-muted/30 space-y-3 rounded-lg border p-4">
                  <p className="text-sm font-semibold leading-relaxed">
                    {allegation.allegation || allegation.description}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Claimant" value={allegation.claimant} />
                    <Field label="Subject" value={allegation.subject} />
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                      Supporting Quotes
                    </p>
                    <QuoteList
                      quotes={allegation.relevantQuotes ?? []}
                      empty={NO_VERIFIED_QUOTE}
                      source={source}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No allegations mentioned in this document.</EmptyState>
          )}
        </SectionCard>

        {/* 3. Facts */}
        <SectionCard title="Facts" count={facts.length} icon={ListChecks}>
          {facts.length > 0 ? (
            <ul className="space-y-4 text-sm">
              {facts.map((fact, i) => (
                <li key={i} className="space-y-2 leading-relaxed">
                  <p>{fact.description}</p>
                  {(fact.supportingQuotes ?? []).length > 0 ? (
                    <QuoteList
                      quotes={fact.supportingQuotes}
                      empty={NO_VERIFIED_QUOTE}
                      source={source}
                    />
                  ) : (
                    <EmptyState>{NO_VERIFIED_QUOTE}</EmptyState>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No factual statements extracted.</EmptyState>
          )}
        </SectionCard>

        {/* 4. People Mentioned */}
        <CollapsibleSectionCard
          title="People Mentioned"
          count={peopleMentioned.length}
          icon={Users}
          collapsed={peopleMentioned.length > COLLAPSE_THRESHOLD}
        >
          {peopleMentioned.length > 0 ? (
            <ul className="flex flex-wrap gap-2 text-sm">
              {peopleMentioned.map((person, i) => (
                <li key={i}>
                  <Badge variant="outline" className="font-normal">
                    {person}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No people mentioned.</EmptyState>
          )}
        </CollapsibleSectionCard>

        {/* 5. Events */}
        <SectionCard title="Events" count={events.length} icon={CalendarClock}>
          {events.length > 0 ? (
            <ul className="space-y-3 text-sm">
              {events.map((event, i) => (
                <li key={i} className="space-y-1.5 leading-relaxed">
                  <p>
                    <span className="text-muted-foreground font-medium">
                      {event.date ?? "Undated"}:
                    </span>{" "}
                    {event.description}
                  </p>
                  {(event.participants ?? []).length > 0 ? (
                    <p className="text-muted-foreground text-xs">
                      Participants: {(event.participants ?? []).join(", ")}
                    </p>
                  ) : null}
                  {(event.supportingQuotes ?? []).length > 0 ? (
                    <QuoteList
                      quotes={event.supportingQuotes}
                      empty={NO_VERIFIED_QUOTE}
                      source={source}
                    />
                  ) : (
                    <EmptyState>{NO_VERIFIED_QUOTE}</EmptyState>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No concrete events mentioned.</EmptyState>
          )}
        </SectionCard>

        {/* 6. Witnesses Mentioned */}
        <CollapsibleSectionCard
          title="Witnesses Mentioned"
          count={witnesses.length}
          icon={UserCheck}
          collapsed={witnesses.length > COLLAPSE_THRESHOLD}
        >
          {witnesses.length > 0 ? (
            <ul className="space-y-4 text-sm">
              {witnesses.map((witness: WitnessItem, i) => (
                <li key={i} className="space-y-2 leading-relaxed">
                  <p>
                    <span className="font-medium">{witness.name}</span> —{" "}
                    {witness.relevance}
                  </p>
                  {(witness.supportingQuotes ?? []).length > 0 ? (
                    <QuoteList
                      quotes={witness.supportingQuotes}
                      empty={NO_VERIFIED_QUOTE}
                      source={source}
                    />
                  ) : (
                    <EmptyState>{NO_VERIFIED_QUOTE}</EmptyState>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No potential witnesses mentioned.</EmptyState>
          )}
        </CollapsibleSectionCard>

        {/* 7. Relevant Quotes */}
        <CollapsibleSectionCard
          title="Relevant Quotes"
          count={notableQuotes.length}
          icon={MessageSquareQuote}
          collapsed={notableQuotes.length > COLLAPSE_THRESHOLD}
        >
          <QuoteList
            quotes={notableQuotes}
            empty={NO_VERIFIED_QUOTE}
            source={source}
          />
        </CollapsibleSectionCard>

        {/* 8. Follow-up Questions */}
        <SectionCard
          title="Follow-up Questions"
          count={followUpQuestions.length}
          icon={CircleHelp}
        >
          {followUpQuestions.length > 0 ? (
            <ul className="list-inside list-disc space-y-2 text-sm leading-relaxed">
              {followUpQuestions.map((question, i) => (
                <li key={i}>{question.description}</li>
              ))}
            </ul>
          ) : (
            <EmptyState>No follow-up questions suggested.</EmptyState>
          )}
        </SectionCard>
      </div>
    </SourceViewerProvider>
  );
}
