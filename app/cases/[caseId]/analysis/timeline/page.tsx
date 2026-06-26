import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCaseAnalysis } from "@/features/investigation-analysis/lib/db";
import type { TimelineEvent } from "@/features/investigation-analysis/types";

export const dynamic = "force-dynamic";

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const { analysis } = await getCaseAnalysis(caseId);
  if (!analysis) notFound();

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="px-0">
        <Link href={`/cases/${caseId}/analysis`}>
          <ArrowLeft />
          Investigation analysis
        </Link>
      </Button>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <CalendarClock className="text-muted-foreground size-5" />
          <h2 className="text-xl font-semibold tracking-tight">Timeline</h2>
        </div>
        <p className="text-muted-foreground text-sm">
          {analysis.timeline.length} event
          {analysis.timeline.length === 1 ? "" : "s"} from the saved analysis.
        </p>
      </div>

      {analysis.timeline.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No dated events.
        </p>
      ) : (
        <ol className="border-muted space-y-5 border-l pl-5">
          {analysis.timeline.map((event) => (
            <TimelineItem key={event.id} event={event} />
          ))}
        </ol>
      )}
    </div>
  );
}

function TimelineItem({ event }: { event: TimelineEvent }) {
  return (
    <li className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {event.date ?? "Undated"}
      </p>
      <p className="text-sm leading-relaxed">{event.description}</p>
      {event.participants.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {event.participants.join(", ")}
        </p>
      ) : null}
      {event.sources.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {event.sources.map((source) => (
            <Badge
              key={`${source.documentId}-${source.label}`}
              variant="outline"
              className="gap-1.5 font-normal"
            >
              <FileText className="size-3" />
              {source.label}
            </Badge>
          ))}
        </div>
      ) : null}
    </li>
  );
}
