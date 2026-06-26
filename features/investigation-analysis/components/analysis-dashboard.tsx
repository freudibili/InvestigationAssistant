"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarClock,
  FileText,
  Gavel,
  HelpCircle,
  Loader2,
  RotateCcw,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query-keys";
import {
  assessConductAction,
  assessOverallConductAction,
} from "@/features/investigation-analysis/actions/analysis";
import type { CaseAnalysisResponse } from "@/features/investigation-analysis/hooks/use-analysis";
import {
  SourceViewerProvider,
  useSourceViewer,
} from "@/components/pdf/source-viewer-dialog";
import type { ConductAssessment } from "@/features/investigation-analysis/validation";
import type {
  InvestigationAnalysis,
  Party,
  QuoteRef,
  Reproche,
  ReprocheStatement,
} from "@/features/investigation-analysis/types";

interface Lookups {
  interviewNameById: Map<string, string>;
  quoteById: Map<string, QuoteRef>;
}

const MAIN_PARTY_ROLE_LABELS: Record<Party["caseRole"], string> = {
  claimant: "Claimant",
  accused: "Accused",
  reference_person: "Reference person",
  witness: "Witness",
  investigator: "Investigator",
};

const CONDUCT_CATEGORY_LABELS = [
  "Mobbing",
  "Sexual harassment",
  "Violence",
  "Racism",
];

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
  caseId,
  analysis,
}: {
  caseId: string;
  analysis: InvestigationAnalysis;
}) {
  return (
    <SourceViewerProvider>
      <DashboardBody caseId={caseId} analysis={analysis} />
    </SourceViewerProvider>
  );
}

function DashboardBody({
  caseId,
  analysis,
}: {
  caseId: string;
  analysis: InvestigationAnalysis;
}) {
  const lookups = useMemo<Lookups>(
    () => ({
      interviewNameById: new Map(analysis.interviews.map((i) => [i.id, i.name])),
      quoteById: new Map(analysis.quotes.map((quote) => [quote.id, quote])),
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
              <Badge
                key={party.personId}
                variant="outline"
                className="gap-1.5 py-1"
              >
                <span className="font-medium">{party.canonicalName}</span>
                <span className="text-muted-foreground">
                  · {mainPartyLabel(party)}
                </span>
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
                caseId={caseId}
                reproche={reproche}
                lookups={lookups}
              />
            ))}
          </div>
        )}
      </Section>

      {analysis.globalAssessment ? (
        <Section icon={FileText} title="Overall assessment">
          <OverallAssessmentCard caseId={caseId} analysis={analysis} />
        </Section>
      ) : null}

      <Section
        icon={CalendarClock}
        title={`Timeline (${analysis.timeline.length})`}
      >
        <Button asChild variant="outline">
          <Link href={`/cases/${caseId}/analysis/timeline`}>
            View all timeline
            <ArrowRight />
          </Link>
        </Button>
      </Section>

      <Section icon={Users} title={`Witnesses (${analysis.witnesses.length})`}>
        <Button asChild variant="outline">
          <Link href={`/cases/${caseId}/analysis/witnesses`}>
            View all witnesses
            <ArrowRight />
          </Link>
        </Button>
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

function OverallAssessmentCard({
  caseId,
  analysis,
}: {
  caseId: string;
  analysis: InvestigationAnalysis;
}) {
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const assessedCount = analysis.reproches.filter(
    (reproche) => reproche.conductAssessment
  ).length;
  const canCalculate =
    analysis.reproches.length > 0 && assessedCount === analysis.reproches.length;
  const assessment = analysis.overallConductAssessment;

  function handleAssessOverallConduct() {
    startTransition(async () => {
      const result = await assessOverallConductAction(caseId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => ({
          status: current?.status ?? "ready",
          generatedAt: current?.generatedAt ?? result.analysis.generatedAt,
          analysis: result.analysis,
        })
      );
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p className="text-sm leading-relaxed whitespace-pre-line">
          {analysis.globalAssessment}
        </p>
        <div className="space-y-3">
          {assessment ? (
            <ConductAssessmentPanel
              assessment={assessment}
              isPending={isPending}
              onReassess={handleAssessOverallConduct}
            />
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={handleAssessOverallConduct}
              disabled={!canCalculate || isPending}
              title={
                canCalculate
                  ? undefined
                  : `Run conduct assessment for all grievances first (${assessedCount}/${analysis.reproches.length}).`
              }
            >
              {isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              {isPending ? "Calculating..." : "Calculate global result"}
            </Button>
          )}
          {!canCalculate ? (
            <p className="text-muted-foreground text-xs">
              Conduct assessments completed: {assessedCount}/
              {analysis.reproches.length}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ReprocheCard({
  caseId,
  reproche,
  lookups,
}: {
  caseId: string;
  reproche: Reproche;
  lookups: Lookups;
}) {
  const [assessment, setAssessment] = useState<ConductAssessment | null>(
    reproche.conductAssessment
  );
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();

  function handleAssessConduct() {
    startTransition(async () => {
      const result = await assessConductAction(caseId, reproche);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setAssessment(result.assessment);
      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => ({
          status: current?.status ?? "ready",
          generatedAt: current?.generatedAt ?? result.analysis.generatedAt,
          analysis: result.analysis,
        })
      );
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">{reproche.title}</CardTitle>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={verdictVariant(reproche.verdict)}>
              {reproche.verdict}
            </Badge>
            <Badge variant="outline">{reproche.grievanceType}</Badge>
          </div>
        </div>
        {reproche.description ? (
          <p className="text-muted-foreground text-sm">{reproche.description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <StatementBlock
            label="Claimant"
            caseId={caseId}
            statement={reproche.claimantStatement}
            lookups={lookups}
          />
          <StatementBlock
            label="Accused"
            caseId={caseId}
            statement={reproche.accusedStatement}
            lookups={lookups}
          />
          {reproche.referenceStatements.map((statement, index) => (
            <StatementBlock
              key={index}
              label={`Reference person ${index + 1}`}
              caseId={caseId}
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

        <div className="space-y-3">
          {assessment ? (
            <ConductAssessmentPanel
              assessment={assessment}
              isPending={isPending}
              onReassess={handleAssessConduct}
            />
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={handleAssessConduct}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              {isPending ? "Analysing..." : "Analyse conduct"}
            </Button>
          )}
        </div>

        {reproche.openQuestions.length > 0 ? (
          <BulletList label="Open questions" items={reproche.openQuestions} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConductAssessmentPanel({
  assessment,
  isPending,
  onReassess,
}: {
  assessment: ConductAssessment;
  isPending: boolean;
  onReassess: () => void;
}) {
  const categories = CONDUCT_CATEGORY_LABELS.map((label) =>
    assessment.categories.find((item) => item.category === label)
  ).filter((item): item is ConductAssessment["categories"][number] =>
    Boolean(item && item.confidence > 0)
  );
  const missingInformation = uniqueStrings([
    ...assessment.missingInformation,
    ...categories.flatMap((item) => item.missingInformation),
  ]);

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      {assessment.overallCaution ? (
        <p className="text-sm leading-relaxed">{assessment.overallCaution}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onReassess}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <RotateCcw />
          )}
          {isPending ? "Re-analysing..." : "Re-analyse"}
        </Button>
        {categories.map((item) => (
          <Badge key={item.category} variant={conductStatusVariant(item.status)}>
            {item.category}: {item.status} ({item.confidence}%)
          </Badge>
        ))}
      </div>
      <MobbingFactorAssessment assessment={assessment} />
      <div className="space-y-2">
        {categories.map((item) => (
          <div key={item.category} className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-medium">{item.category}</p>
              <p className="text-muted-foreground text-xs">
                Confidence: {item.confidence}%
              </p>
            </div>
            {item.rationale ? (
              <p className="text-sm leading-relaxed">{item.rationale}</p>
            ) : null}
          </div>
        ))}
      </div>
      {missingInformation.length > 0 ? (
        <p className="text-muted-foreground border-t pt-2 text-xs">
          Missing elements: {missingInformation.join("; ")}
        </p>
      ) : null}
    </div>
  );
}

function MobbingFactorAssessment({
  assessment,
}: {
  assessment: ConductAssessment;
}) {
  const factors = assessment.mobbingFactorAssessments.filter(
    (item) => item.confidence > 0
  );

  if (factors.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        Assessment dimensions
      </p>
      <div className="space-y-2">
        {factors.map((item) => (
          <div key={item.factor} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{item.factor}</Badge>
              <span className="text-muted-foreground text-xs">
                {item.confidence}% confidence
              </span>
            </div>
            {item.rationale ? (
              <p className="text-sm leading-relaxed">{item.rationale}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function conductStatusVariant(
  status: string
): "default" | "secondary" | "outline" | "destructive" | "success" | "warning" {
  switch (status) {
    case "Likely indicated":
      return "destructive";
    case "Possible":
      return "warning";
    case "Not indicated":
      return "outline";
    default:
      return "secondary";
  }
}

function StatementBlock({
  label,
  caseId,
  statement,
  lookups,
}: {
  label: string;
  caseId: string;
  statement: ReprocheStatement;
  lookups: Lookups;
}) {
  const name = statement.interviewId
    ? lookups.interviewNameById.get(statement.interviewId)
    : null;
  const quotes = statement.quoteIds
    .map((quoteId) => lookups.quoteById.get(quoteId))
    .filter((quote): quote is QuoteRef =>
      Boolean(
        quote &&
          quote.documentId === statement.interviewId &&
          quote.provenanceId &&
          quote.page
      )
    );

  return (
    <div className="rounded-md border-l-2 border-muted pl-3 py-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {name ? ` — ${name}` : ""}
      </p>
      {statement.summary ? (
        <p className="mt-1 text-sm">
          <InlineEvidenceText
            caseId={caseId}
            text={statement.summary}
            quotes={quotes}
          />
        </p>
      ) : (
        <p className="mt-1 text-sm italic text-muted-foreground">
          No account on record.
        </p>
      )}
    </div>
  );
}

function InlineEvidenceText({
  caseId,
  text,
  quotes,
}: {
  caseId: string;
  text: string;
  quotes: QuoteRef[];
}) {
  const openViewer = useSourceViewer();
  const segments = buildInlineEvidenceSegments(text, quotes);

  return (
    <>
      {segments.map((segment, index) =>
        typeof segment === "string" ? (
          <span key={index}>{segment}</span>
        ) : (
          <button
            key={index}
            type="button"
            onClick={() =>
              openViewer?.({
                caseId,
                documentId: segment.quote.documentId,
                documentName: segment.quote.documentName,
                label: `Page ${segment.quote.page}`,
                page: segment.quote.page as number,
                quoteId: segment.quote.provenanceId ?? undefined,
                charStart: segment.quote.charStart,
                charEnd: segment.quote.charEnd,
                pageCharStart: segment.quote.pageCharStart,
                pageCharEnd: segment.quote.pageCharEnd,
                normalizedPageCharStart: segment.quote.normalizedPageCharStart,
                normalizedPageCharEnd: segment.quote.normalizedPageCharEnd,
                quote: segment.quote.text,
              })
            }
            className="rounded-sm bg-muted px-1 italic underline decoration-muted-foreground/50 underline-offset-2 hover:bg-muted/70 hover:decoration-foreground"
          >
            “{segment.fragment}”
          </button>
        )
      )}
    </>
  );
}

type InlineEvidenceSegment =
  | string
  | {
      fragment: string;
      quote: QuoteRef;
    };

function buildInlineEvidenceSegments(
  text: string,
  quotes: QuoteRef[]
): InlineEvidenceSegment[] {
  const segments: InlineEvidenceSegment[] = [];
  const pattern = /“([^”]{1,120})”|"([^"]{1,120})"/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const fragment = match[1] ?? match[2] ?? "";
    const quote = findQuoteForFragment(fragment, quotes);

    if (match.index > lastIndex) {
      segments.push(text.slice(lastIndex, match.index));
    }

    segments.push(quote ? { fragment, quote } : fragment);
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  return segments.length > 0 ? segments : [text];
}

function findQuoteForFragment(
  fragment: string,
  quotes: QuoteRef[]
): QuoteRef | null {
  const normalizedFragment = normalizeInlineQuote(fragment);
  if (normalizedFragment.length < 2) return null;

  return (
    quotes.find((quote) =>
      normalizeInlineQuote(quote.text).includes(normalizedFragment)
    ) ?? null
  );
}

function normalizeInlineQuote(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function mainPartyLabel(party: Party): string {
  return [MAIN_PARTY_ROLE_LABELS[party.caseRole], party.jobRole]
    .filter(Boolean)
    .join(" / ");
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

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
      {children}
    </p>
  );
}
