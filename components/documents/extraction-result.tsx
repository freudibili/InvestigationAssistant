import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertTriangle, Quote } from "lucide-react";
import type { CaseDocument } from "@/lib/types";

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

export function ExtractionResult({ document }: { document: CaseDocument }) {
  const data = document.extractedData;

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

  return (
    <div className="space-y-6">
      {extractionWarnings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="text-amber-600 size-4" />
              Extraction Warnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1.5 text-sm">
              {extractionWarnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed">
            {data.summary?.trim() ? (
              data.summary
            ) : (
              <span className="text-muted-foreground italic">
                No summary produced.
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            People Mentioned{" "}
            <span className="text-muted-foreground font-normal">
              ({data.peopleMentioned.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.peopleMentioned.length > 0 ? (
            <ul className="list-inside list-disc space-y-1 text-sm">
              {data.peopleMentioned.map((person, i) => (
                <li key={i}>{person}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm italic">
              None mentioned.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Key Events{" "}
            <span className="text-muted-foreground font-normal">
              ({data.keyEvents.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.keyEvents.length > 0 ? (
            <ul className="list-inside list-disc space-y-1.5 text-sm">
              {data.keyEvents.map((event, i) => (
                <li key={i}>{event.description}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm italic">
              No key events identified.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Notable Quotes{" "}
            <span className="text-muted-foreground font-normal">
              ({data.notableQuotes.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.notableQuotes.length > 0 ? (
            <div className="space-y-3">
              {data.notableQuotes.map((quote, i) => (
                <blockquote
                  key={i}
                  className="border-muted-foreground/30 text-muted-foreground flex gap-2 border-l-2 pl-3 text-sm italic"
                >
                  <Quote className="size-3.5 shrink-0 translate-y-0.5" />
                  <span>{quote}</span>
                </blockquote>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm italic">
              No notable quotes captured.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
