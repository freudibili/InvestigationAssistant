import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  BadgeCheck,
  CircleHelp,
  ClipboardList,
  Eye,
  FileQuestion,
  Gavel,
  ListChecks,
  MessageSquareQuote,
  ShieldAlert,
  Target,
  UserCheck,
  Users,
} from "lucide-react";
import type * as React from "react";
import type { CaseDocument, ExtractedData } from "@/lib/types";

type EvidenceItem = ExtractedData["factualStatements"][number];
type QuoteItem = ExtractedData["notableQuotes"][number];
type WitnessItem = ExtractedData["potentialWitnesses"][number];
type ConsolidatedWitnessItem = ExtractedData["consolidatedWitnesses"][number];
type DisplayQuote = QuoteItem | string;
type SourceContext = {
  documentName: string;
  originalDocumentUrl: string | null;
};
type PageReference = {
  label: string;
  pageStart: number | null;
};

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

function SourcePages({
  pages,
  source,
}: {
  pages?: string[];
  source: SourceContext;
}) {
  const pageReferences = (pages ?? [])
    .map(parsePageReference)
    .filter((page): page is PageReference => Boolean(page));
  if (pageReferences.length === 0) {
    return <Badge variant="outline">No source page</Badge>;
  }

  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {pageReferences.map((page) => {
        const badge = (
          <Badge
            variant="outline"
            className="max-w-full whitespace-normal text-left leading-snug"
          >
            Source: {source.documentName} · {page.label}
          </Badge>
        );
        const href =
          source.originalDocumentUrl && page.pageStart
            ? `${source.originalDocumentUrl}#page=${page.pageStart}`
            : source.originalDocumentUrl;

        return href ? (
          <a
            key={page.label}
            href={href}
            target="_blank"
            rel="noreferrer"
            title={`Open ${source.documentName} at ${page.label}`}
          >
            {badge}
          </a>
        ) : (
          <span key={page.label}>{badge}</span>
        );
      })}
    </span>
  );
}

function parsePageReference(
  value: string | null | undefined
): PageReference | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized || /^chunks?\b/i.test(normalized)) return null;

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

  return {
    label: normalized,
    pageStart: null,
  };
}

function EmptyState({ children }: { children: string }) {
  return <p className="text-muted-foreground text-sm italic">{children}</p>;
}

function EvidenceList({
  items,
  empty,
  source,
}: {
  items: EvidenceItem[];
  empty: string;
  source: SourceContext;
}) {
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>;

  return (
    <ul className="space-y-2 text-sm">
      {items.map((item, i) => (
        <li key={i} className="space-y-1 leading-relaxed">
          <p>{item.description}</p>
          <SourcePages pages={item.sourcePages} source={source} />
        </li>
      ))}
    </ul>
  );
}

function WitnessList({
  witnesses,
  source,
}: {
  witnesses: WitnessItem[];
  source: SourceContext;
}) {
  if (witnesses.length === 0) {
    return <EmptyState>No potential witnesses identified.</EmptyState>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {witnesses.map((witness, i) => (
        <li key={i} className="space-y-1 leading-relaxed">
          <p>
            <span className="font-medium">{witness.name}:</span>{" "}
            {witness.relevance}
          </p>
          <SourcePages pages={witness.sourcePages} source={source} />
        </li>
      ))}
    </ul>
  );
}

function ConsolidatedWitnessList({
  witnesses,
  source,
}: {
  witnesses: ConsolidatedWitnessItem[];
  source: SourceContext;
}) {
  if (witnesses.length === 0) {
    return <EmptyState>No consolidated witnesses generated.</EmptyState>;
  }

  return (
    <div className="space-y-4 text-sm">
      {witnesses.map((witness, i) => (
        <div key={i} className="space-y-2 border-b pb-4 last:border-0 last:pb-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium leading-relaxed">{witness.name}</p>
            <Badge variant="secondary">
              Priority {Math.round(witness.priorityScore)}
            </Badge>
          </div>
          <p className="leading-relaxed">{witness.whyTheyMatter}</p>
          {(witness.relatedAllegations ?? []).length > 0 ? (
            <p className="text-muted-foreground leading-relaxed">
              Allegations: {(witness.relatedAllegations ?? []).join("; ")}
            </p>
          ) : null}
          {(witness.mentionedInInterviews ?? []).length > 0 ? (
            <p className="text-muted-foreground leading-relaxed">
              Mentioned in: {(witness.mentionedInInterviews ?? []).join(", ")}
            </p>
          ) : null}
          <SourcePages pages={witness.sourcePages} source={source} />
        </div>
      ))}
    </div>
  );
}

function QuoteList({
  quotes,
  source,
}: {
  quotes: DisplayQuote[];
  source: SourceContext;
}) {
  if (quotes.length === 0) return <EmptyState>No notable quotes captured.</EmptyState>;

  return (
    <div className="space-y-3">
      {quotes.map((quote, i) => {
        const text = typeof quote === "string" ? quote : quote.text;
        const speaker = typeof quote === "string" ? null : quote.speaker;
        const sourcePages = typeof quote === "string" ? [] : quote.sourcePages;

        return (
          <blockquote
            key={i}
            className="border-muted-foreground/30 text-muted-foreground space-y-1 border-l-2 pl-3 text-sm italic"
          >
            <p>
              {speaker ? `${speaker}: ` : ""}
              {text}
            </p>
            <SourcePages pages={sourcePages} source={source} />
          </blockquote>
        );
      })}
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
  icon: typeof ClipboardList;
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

export function ExtractionResult({
  document,
  originalDocumentUrl,
}: {
  document: CaseDocument;
  originalDocumentUrl?: string | null;
}) {
  const data = document.extractedData;
  const source: SourceContext = {
    documentName: document.fileName,
    originalDocumentUrl: originalDocumentUrl ?? null,
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
  const investigationScope = data.investigationScope;
  const allegations = data.allegations ?? [];
  const keyEvents = data.keyEvents ?? [];
  const peopleMentioned = data.peopleMentioned ?? [];
  const canonicalIdentities = data.canonicalIdentities ?? [];
  const notableQuotes = (data.notableQuotes ?? []) as DisplayQuote[];
  const evidenceAssessment = data.evidenceAssessment ?? [];
  const factualStatements = data.factualStatements ?? [];
  const opinions = data.opinions ?? [];
  const assumptions = data.assumptions ?? [];
  const hearsay = data.hearsay ?? [];
  const observations = data.observations ?? [];
  const consolidatedWitnesses = data.consolidatedWitnesses ?? [];
  const missingInformation = data.missingInformation ?? [];
  const followUpQuestions = data.followUpQuestions ?? [];
  const recommendedNextInterviews = data.recommendedNextInterviews ?? [];
  const riskAreas = data.riskAreas ?? [];
  const findingReadiness = data.findingReadiness;
  const potentialWitnesses = data.potentialWitnesses ?? [];
  const pageFindings = data.pageFindings ?? [];
  const position = data.interviewPosition;

  return (
    <div className="space-y-6">
      {extractionWarnings.length > 0 ? (
        <SectionCard
          title="Extraction Warnings"
          count={extractionWarnings.length}
          icon={AlertTriangle}
        >
          <ul className="list-inside list-disc space-y-1.5 text-sm">
            {extractionWarnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Metadata</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <Field label="Interviewee Name" value={data.intervieweeName} />
          <Field
            label="Interviewer"
            value={
              interviewerNames.length > 0 ? interviewerNames.join(", ") : null
            }
          />
          <Field label="Role" value={data.role} />
          <Field label="Date" value={data.interviewDate} />
        </CardContent>
      </Card>

      <SectionCard title="Investigation Impact" icon={Gavel}>
        <p className="text-sm leading-relaxed">
          {data.investigationImpact?.trim() || data.summary?.trim() || (
            <span className="text-muted-foreground italic">
              No investigation impact produced.
            </span>
          )}
        </p>
      </SectionCard>

      <SectionCard title="Investigation Scope" icon={Target}>
        {investigationScope ? (
          <div className="space-y-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Primary Claimants"
                value={
                  investigationScope.primaryClaimants.length > 0
                    ? investigationScope.primaryClaimants.join(", ")
                    : null
                }
              />
              <Field
                label="Primary Accused"
                value={
                  investigationScope.primaryAccused.length > 0
                    ? investigationScope.primaryAccused.join(", ")
                    : null
                }
              />
            </div>
            <p className="leading-relaxed">
              {investigationScope.scopeSummary || (
                <span className="text-muted-foreground italic">
                  No scope summary generated.
                </span>
              )}
            </p>
            {(investigationScope.primaryAllegations ?? []).length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide">
                  Primary Allegations
                </p>
                <ul className="list-inside list-disc space-y-1">
                  {(investigationScope.primaryAllegations ?? []).map(
                    (item, index) => (
                      <li key={index}>{item}</li>
                    )
                  )}
                </ul>
              </div>
            ) : null}
            {(investigationScope.secondaryObservations ?? []).length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide">
                  Secondary Observations
                </p>
                <ul className="list-inside list-disc space-y-1">
                  {(investigationScope.secondaryObservations ?? []).map(
                    (item, index) => (
                      <li key={index}>{item}</li>
                    )
                  )}
                </ul>
              </div>
            ) : null}
            <SourcePages pages={investigationScope.sourcePages} source={source} />
          </div>
        ) : (
          <EmptyState>No investigation scope generated.</EmptyState>
        )}
      </SectionCard>

      <SectionCard title="Finding Readiness" icon={ListChecks}>
        {findingReadiness ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide">
                Supportable
              </p>
              <EvidenceList
                items={findingReadiness.supportableFindings ?? []}
                empty="No supportable findings identified."
                source={source}
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide">
                Unproven
              </p>
              <EvidenceList
                items={findingReadiness.unprovenFindings ?? []}
                empty="No unproven findings identified."
                source={source}
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide">
                Evidence To Collect
              </p>
              <EvidenceList
                items={findingReadiness.evidenceToCollect ?? []}
                empty="No evidence collection needs identified."
                source={source}
              />
            </div>
          </div>
        ) : (
          <EmptyState>No finding readiness generated.</EmptyState>
        )}
      </SectionCard>

      <SectionCard title="Interview Position" icon={BadgeCheck}>
        {position ? (
          <div className="space-y-2 text-sm">
            <Badge variant="secondary">{position.classification}</Badge>
            <p className="leading-relaxed">{position.rationale}</p>
            <SourcePages pages={position.sourcePages} source={source} />
          </div>
        ) : (
          <EmptyState>No interview position assessed.</EmptyState>
        )}
      </SectionCard>

      <SectionCard title="Allegations" count={allegations.length} icon={ShieldAlert}>
        {allegations.length > 0 ? (
          <div className="space-y-5">
            {allegations.map((allegation, i) => (
              <div key={i} className="space-y-3 border-b pb-5 last:border-0 last:pb-0">
                <div className="space-y-1 text-sm">
                  <p className="font-medium leading-relaxed">
                    {allegation.allegation || allegation.description}
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    {allegation.classification === "secondary"
                      ? "Secondary"
                      : "Primary"}{" "}
                    /{" "}
                    Claimant: {allegation.claimant ?? "Unknown"} / Subject:{" "}
                    {allegation.subject ?? "Unknown"} / Date:{" "}
                    {allegation.date ?? "Unknown"}
                  </p>
                  <SourcePages pages={allegation.sourcePages} source={source} />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide">
                      Supporting Evidence
                    </p>
                    <EvidenceList
                      items={allegation.supportingEvidence ?? []}
                      empty="No supporting evidence extracted."
                      source={source}
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide">
                      Contradictory Evidence
                    </p>
                    <EvidenceList
                      items={allegation.contradictoryEvidence ?? []}
                      empty="No contradictory evidence extracted."
                      source={source}
                    />
                  </div>
                </div>

                {(allegation.missingEvidence ?? []).length > 0 ? (
                  <div className="text-sm">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide">
                      Missing Evidence
                    </p>
                    <ul className="list-inside list-disc space-y-1">
                      {(allegation.missingEvidence ?? []).map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide">
                      Witnesses
                    </p>
                    <WitnessList
                      witnesses={allegation.witnesses ?? []}
                      source={source}
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide">
                      Relevant Quotes
                    </p>
                    <QuoteList
                      quotes={allegation.relevantQuotes ?? []}
                      source={source}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No separate allegations identified.</EmptyState>
        )}
      </SectionCard>

      <SectionCard
        title="Evidence Assessment"
        count={evidenceAssessment.length}
        icon={ClipboardList}
      >
        {evidenceAssessment.length > 0 ? (
          <div className="space-y-4 text-sm">
            {evidenceAssessment.map((assessment, i) => (
              <div key={i} className="space-y-2 border-b pb-4 last:border-0 last:pb-0">
                <p className="font-medium">{assessment.allegation}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field
                    label="Support"
                    value={assessment.strengthOfSupportingEvidence}
                  />
                  <Field
                    label="Contradiction"
                    value={assessment.strengthOfContradictoryEvidence}
                  />
                  <Field label="Confidence" value={assessment.confidenceLevel} />
                </div>
                <SourcePages pages={assessment.sourcePages} source={source} />
                <div className="grid gap-3 lg:grid-cols-3">
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide">
                      Supportable Findings
                    </p>
                    <ul className="list-inside list-disc space-y-1">
                      {(assessment.supportableFindings ?? []).map(
                        (item, index) => (
                          <li key={index}>{item}</li>
                        )
                      )}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide">
                      Unproven Findings
                    </p>
                    <ul className="list-inside list-disc space-y-1">
                      {(assessment.unprovenFindings ?? []).map(
                        (item, index) => (
                          <li key={index}>{item}</li>
                        )
                      )}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide">
                      Evidence To Collect
                    </p>
                    <ul className="list-inside list-disc space-y-1">
                      {(assessment.evidenceToCollect ?? []).map(
                        (item, index) => (
                          <li key={index}>{item}</li>
                        )
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No evidence assessment produced.</EmptyState>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Factual Statements"
          count={factualStatements.length}
          icon={Eye}
        >
          <EvidenceList
            items={factualStatements}
            empty="No factual statements extracted."
            source={source}
          />
        </SectionCard>

        <SectionCard
          title="Opinions And Assumptions"
          count={opinions.length + assumptions.length + hearsay.length}
          icon={CircleHelp}
        >
          <div className="space-y-4">
            <EvidenceList
              items={opinions}
              empty="No opinions extracted."
              source={source}
            />
            <EvidenceList
              items={assumptions}
              empty="No assumptions extracted."
              source={source}
            />
            <EvidenceList
              items={hearsay}
              empty="No hearsay extracted."
              source={source}
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Observations"
        count={observations.length}
        icon={Eye}
      >
        <EvidenceList
          items={observations}
          empty="No direct observations extracted."
          source={source}
        />
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Missing Info And Follow-Up"
          count={
            missingInformation.length +
            followUpQuestions.length +
            recommendedNextInterviews.length
          }
          icon={FileQuestion}
        >
          <div className="space-y-4">
            <EvidenceList
              items={missingInformation}
              empty="No missing information identified."
              source={source}
            />
            <EvidenceList
              items={followUpQuestions}
              empty="No follow-up questions proposed."
              source={source}
            />
            <EvidenceList
              items={recommendedNextInterviews}
              empty="No next interviews recommended."
              source={source}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Risk Areas"
          count={riskAreas.length}
          icon={ShieldAlert}
        >
          <EvidenceList
            items={riskAreas}
            empty="No risk areas identified."
            source={source}
          />
        </SectionCard>
      </div>

      <SectionCard title="Potential Witnesses" count={potentialWitnesses.length} icon={Users}>
        <WitnessList witnesses={potentialWitnesses} source={source} />
      </SectionCard>

      <SectionCard
        title="Consolidated Witnesses"
        count={consolidatedWitnesses.length}
        icon={UserCheck}
      >
        <ConsolidatedWitnessList
          witnesses={consolidatedWitnesses}
          source={source}
        />
      </SectionCard>

      <SectionCard title="Key Events" count={keyEvents.length} icon={ClipboardList}>
        {keyEvents.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {keyEvents.map((event, i) => (
              <li key={i} className="space-y-1 leading-relaxed">
                <p>
                  <span className="text-muted-foreground font-medium">
                    {event.date ?? "Unknown date"}:
                  </span>{" "}
                  {event.description}
                </p>
                {(event.participants ?? []).length > 0 ? (
                  <p className="text-muted-foreground">
                    Participants: {(event.participants ?? []).join(", ")}
                  </p>
                ) : null}
                <SourcePages pages={event.sourcePages} source={source} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No key events identified.</EmptyState>
        )}
      </SectionCard>

      <SectionCard title="Notable Quotes" count={notableQuotes.length} icon={MessageSquareQuote}>
        <QuoteList quotes={notableQuotes} source={source} />
      </SectionCard>

      <Card>
        <details>
          <summary className="cursor-pointer list-none">
            <CardHeader>
              <CardTitle className="text-base">
                Page-Level Findings{" "}
                <span className="text-muted-foreground font-normal">
                  ({pageFindings.length})
                </span>
              </CardTitle>
            </CardHeader>
          </summary>
          <CardContent className="space-y-4 pt-6">
            {pageFindings.length > 0 ? (
              pageFindings.map((page) => (
                <div key={page.sourcePage} className="space-y-2 border-b pb-4 text-sm last:border-0">
                  <SourcePages pages={[page.sourcePage]} source={source} />
                  <p className="text-muted-foreground">
                    {page.allegations.length} allegations /{" "}
                    {page.factualStatements.length} facts /{" "}
                    {page.opinions.length} opinions /{" "}
                    {(page.hearsay ?? []).length} hearsay /{" "}
                    {(page.observations ?? []).length} observations /{" "}
                    {page.notableQuotes.length} quotes /{" "}
                    {page.relevantEvents.length} events
                  </p>
                </div>
              ))
            ) : (
              <EmptyState>No page-level findings stored.</EmptyState>
            )}
          </CardContent>
        </details>
      </Card>

      <Card>
        <details>
          <summary className="cursor-pointer list-none">
            <CardHeader>
              <CardTitle className="text-base">
                People Mentioned{" "}
                <span className="text-muted-foreground font-normal">
                  ({peopleMentioned.length})
                </span>
              </CardTitle>
            </CardHeader>
          </summary>
          <CardContent className="pt-6">
            {peopleMentioned.length > 0 ? (
              <ul className="list-inside list-disc space-y-1 text-sm">
                {peopleMentioned.map((person, i) => (
                  <li key={i}>{person}</li>
                ))}
              </ul>
            ) : (
              <EmptyState>None mentioned.</EmptyState>
            )}
          </CardContent>
        </details>
      </Card>

      <Card>
        <details>
          <summary className="cursor-pointer list-none">
            <CardHeader>
              <CardTitle className="text-base">
                Canonical Identities{" "}
                <span className="text-muted-foreground font-normal">
                  ({canonicalIdentities.length})
                </span>
              </CardTitle>
            </CardHeader>
          </summary>
          <CardContent className="space-y-3 pt-6">
            {canonicalIdentities.length > 0 ? (
              canonicalIdentities.map((identity, i) => (
                <div key={i} className="space-y-1 text-sm">
                  <p className="font-medium">{identity.canonicalName}</p>
                  <p className="text-muted-foreground">
                    Role: {identity.role ?? "Unknown"}
                    {(identity.variants ?? []).length > 0
                      ? ` / Variants: ${(identity.variants ?? []).join(", ")}`
                      : ""}
                  </p>
                  <SourcePages pages={identity.sourcePages} source={source} />
                </div>
              ))
            ) : (
              <EmptyState>No canonical identities stored.</EmptyState>
            )}
          </CardContent>
        </details>
      </Card>
    </div>
  );
}
