"use client";

import { Merge, Pencil, Plus, Trash2 } from "lucide-react";
import type React from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PeopleEditor } from "@/features/people/components/people-editor";
import {
  collectEditablePeople,
  renamePersonReferences,
} from "@/features/people/lib/extracted-people";
import type { ExtractedData } from "@/lib/types";

type Allegation = ExtractedData["allegations"][number];
type Event = ExtractedData["keyEvents"][number];
type Witness = ExtractedData["potentialWitnesses"][number];
type Quote = ExtractedData["notableQuotes"][number];
type Fact = ExtractedData["factualStatements"][number];
type WarningStatus =
  ExtractedData["extractionWarningReviews"][number]["status"];

const warningStatuses: { value: WarningStatus; label: string }[] = [
  { value: "needs_correction", label: "Needs correction" },
  { value: "accepted", label: "Accepted despite warning" },
  { value: "not_relevant", label: "Not relevant" },
  { value: "fixed", label: "Fixed" },
];

export function ExtractionCorrectionForm({
  data,
  onChange,
  section,
  allegationIndex,
}: {
  data: ExtractedData;
  onChange: (data: ExtractedData) => void;
  section?: ExtractionCorrectionSection;
  allegationIndex?: number;
}) {
  function update<K extends keyof ExtractedData>(
    key: K,
    value: ExtractedData[K],
  ) {
    onChange({ ...data, [key]: value });
  }

  return (
    <div className="space-y-5">
      <EditorSection
        title="Document metadata"
        open
        isHidden={!isVisible(section, "metadata")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NullableTextField
            label="Interviewee name"
            value={data.intervieweeName}
            onChange={(value) => update("intervieweeName", value)}
          />
          <NullableTextField
            label="Interview date"
            value={data.interviewDate}
            onChange={(value) => update("interviewDate", value)}
          />
          <NullableTextField
            label="Interviewee job role"
            value={data.role}
            onChange={(value) => update("role", value)}
          />
          <StringListField
            label="Interviewers"
            values={data.interviewerNames}
            onChange={(values) => update("interviewerNames", values)}
          />
        </div>
      </EditorSection>

      <EditorSection
        title="People and roles"
        open
        isHidden={!isVisible(section, "people")}
      >
        <PeopleEditor
          people={collectEditablePeople(data)}
          onRename={(currentName, nextName) =>
            onChange(renamePersonReferences(data, currentName, nextName))
          }
        />
        <StringListField
          label="People mentioned"
          values={data.peopleMentioned}
          onChange={(values) => update("peopleMentioned", values)}
        />
        <StringListField
          label="Claimants"
          values={data.investigationScope.primaryClaimants}
          onChange={(primaryClaimants) =>
            update("investigationScope", {
              ...data.investigationScope,
              primaryClaimants,
            })
          }
        />
        <StringListField
          label="Accused persons"
          values={data.investigationScope.primaryAccused}
          onChange={(primaryAccused) =>
            update("investigationScope", {
              ...data.investigationScope,
              primaryAccused,
            })
          }
        />
      </EditorSection>

      <EditorSection
        title={`Allegations (${data.allegations.length})`}
        open
        isHidden={!isVisible(section, "allegations")}
      >
        <div className="space-y-3">
          {data.allegations.map((allegation, index) =>
            allegationIndex === undefined || allegationIndex === index ? (
              <ItemCard
                key={index}
                removeLabel="Remove allegation"
                onRemove={() => onChange(removeAllegation(data, index))}
                secondaryAction={
                  data.allegations.length > 1 ? (
                    <AllegationMergeControl
                      allegations={data.allegations}
                      currentIndex={index}
                      onMerge={(targetIndex) =>
                        onChange(mergeAllegations(data, index, targetIndex))
                      }
                    />
                  ) : null
                }
              >
                <AllegationEditor
                  allegation={allegation}
                  availableQuotes={collectQuotes(data)}
                  onChange={(nextAllegation) =>
                    onChange(updateAllegation(data, index, nextAllegation))
                  }
                />
              </ItemCard>
            ) : null,
          )}
          {allegationIndex === undefined ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                update("allegations", [...data.allegations, createAllegation()])
              }
            >
              <Plus />
              Add allegation
            </Button>
          ) : null}
        </div>
      </EditorSection>

      <EditorSection
        title={`Facts (${data.factualStatements.length})`}
        open
        isHidden={!isVisible(section, "facts")}
      >
        <SimpleItemList
          items={data.factualStatements}
          addLabel="Add fact"
          createItem={createFact}
          onChange={(items) => update("factualStatements", items)}
          renderItem={(fact, change) => (
            <FactEditor
              fact={fact}
              availableQuotes={collectQuotes(data)}
              onChange={change}
            />
          )}
        />
      </EditorSection>

      <EditorSection
        title={`Events (${data.keyEvents.length})`}
        open
        isHidden={!isVisible(section, "events")}
      >
        <SimpleItemList
          items={data.keyEvents}
          addLabel="Add event"
          createItem={createEvent}
          onChange={(items) => update("keyEvents", items)}
          renderItem={(event, change) => (
            <EventEditor
              event={event}
              availableQuotes={collectQuotes(data)}
              onChange={change}
            />
          )}
        />
      </EditorSection>

      <EditorSection
        title={`Witnesses (${data.potentialWitnesses.length})`}
        open
        isHidden={!isVisible(section, "witnesses")}
      >
        <SimpleItemList
          items={data.potentialWitnesses}
          addLabel="Add witness"
          createItem={createWitness}
          onChange={(items) => update("potentialWitnesses", items)}
          renderItem={(witness, change) => (
            <WitnessEditor
              witness={witness}
              allegationTitles={data.allegations.map(allegationTitle)}
              onChange={change}
            />
          )}
        />
      </EditorSection>

      <EditorSection
        title={`Quotes (${collectQuotes(data).length})`}
        open
        isHidden={!isVisible(section, "quotes")}
      >
        <QuoteCorrectionList data={data} onChange={onChange} />
      </EditorSection>

      <EditorSection
        title={`Extraction warnings (${data.extractionWarnings.length})`}
        isHidden={!isVisible(section, "warnings")}
      >
        {data.extractionWarnings.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No extraction warnings.
          </p>
        ) : (
          <div className="space-y-3">
            {data.extractionWarnings.map((warning) => (
              <div
                key={warning}
                className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_220px] sm:items-center"
              >
                <p className="text-sm">{warning}</p>
                <Select
                  value={warningStatus(data, warning)}
                  onValueChange={(status) =>
                    updateWarningStatus(
                      data,
                      warning,
                      status as WarningStatus,
                      onChange,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {warningStatuses.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </EditorSection>
    </div>
  );
}

function AllegationEditor({
  allegation,
  availableQuotes,
  onChange,
}: {
  allegation: Allegation;
  availableQuotes: Quote[];
  onChange: (allegation: Allegation) => void;
}) {
  return (
    <div className="space-y-3">
      <TextField
        label="Allegation"
        value={allegationTitle(allegation)}
        onChange={(allegationTitleValue) =>
          onChange({
            ...allegation,
            allegation: allegationTitleValue,
          })
        }
      />
      <TextAreaField
        label="Description"
        value={allegation.description}
        onChange={(description) => onChange({ ...allegation, description })}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <NullableTextField
          label="Claimant"
          value={allegation.claimant}
          onChange={(claimant) => onChange({ ...allegation, claimant })}
        />
        <NullableTextField
          label="Subject"
          value={allegation.subject}
          onChange={(subject) => onChange({ ...allegation, subject })}
        />
        <div className="space-y-2">
          <Label>Use in analysis</Label>
          <Select
            value={allegation.relevance}
            onValueChange={(relevance) =>
              onChange({
                ...allegation,
                relevance: relevance as Allegation["relevance"],
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="relevant">Relevant</SelectItem>
              <SelectItem value="not_relevant">Not relevant</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <QuoteAttachmentField
        quotes={availableQuotes}
        selectedQuotes={allegation.relevantQuotes}
        onChange={(relevantQuotes) =>
          onChange({ ...allegation, relevantQuotes })
        }
      />
    </div>
  );
}

function FactEditor({
  fact,
  availableQuotes,
  onChange,
}: {
  fact: Fact;
  availableQuotes: Quote[];
  onChange: (fact: Fact) => void;
}) {
  return (
    <div className="space-y-3">
      <TextAreaField
        label="Fact"
        value={fact.description}
        onChange={(description) => onChange({ ...fact, description })}
      />
      <QuoteAttachmentField
        quotes={availableQuotes}
        selectedQuotes={fact.supportingQuotes}
        onChange={(supportingQuotes) =>
          onChange({
            ...fact,
            supportingQuotes,
            evidenceStatus: evidenceStatus(supportingQuotes),
          })
        }
      />
      <EvidenceStatus quotes={fact.supportingQuotes} />
    </div>
  );
}

function AllegationMergeControl({
  allegations,
  currentIndex,
  onMerge,
}: {
  allegations: Allegation[];
  currentIndex: number;
  onMerge: (targetIndex: number) => void;
}) {
  const targets = allegations
    .map((allegation, index) => ({ index, title: allegationTitle(allegation) }))
    .filter((target) => target.index !== currentIndex);
  const [targetIndex, setTargetIndex] = useState(
    String(targets[0]?.index ?? 0),
  );

  return (
    <div className="flex items-center gap-2">
      <Select value={targetIndex} onValueChange={setTargetIndex}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Merge into…" />
        </SelectTrigger>
        <SelectContent>
          {targets.map((target) => (
            <SelectItem key={target.index} value={String(target.index)}>
              {target.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          onMerge(
            targets.some((target) => target.index === Number(targetIndex))
              ? Number(targetIndex)
              : (targets[0]?.index ?? currentIndex),
          )
        }
      >
        <Merge />
        Merge
      </Button>
    </div>
  );
}

function EventEditor({
  event,
  availableQuotes,
  onChange,
}: {
  event: Event;
  availableQuotes: Quote[];
  onChange: (event: Event) => void;
}) {
  return (
    <div className="space-y-3">
      <TextField
        label="Event title"
        value={event.title}
        onChange={(title) => onChange({ ...event, title })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <NullableTextField
          label="Event date"
          value={event.date}
          onChange={(date) => onChange({ ...event, date })}
        />
        <StringListField
          label="Participants"
          values={event.participants}
          onChange={(participants) => onChange({ ...event, participants })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={event.approximateDate}
          onChange={(changeEvent) =>
            onChange({ ...event, approximateDate: changeEvent.target.checked })
          }
        />
        Date is approximate
      </label>
      <TextAreaField
        label="Short description"
        value={event.description}
        onChange={(description) => onChange({ ...event, description })}
      />
      <QuoteAttachmentField
        quotes={availableQuotes}
        selectedQuotes={event.supportingQuotes}
        onChange={(supportingQuotes) =>
          onChange({
            ...event,
            supportingQuotes,
            evidenceStatus: evidenceStatus(supportingQuotes),
          })
        }
      />
      <EvidenceStatus quotes={event.supportingQuotes} />
    </div>
  );
}

function WitnessEditor({
  witness,
  allegationTitles,
  onChange,
}: {
  witness: Witness;
  allegationTitles: string[];
  onChange: (witness: Witness) => void;
}) {
  return (
    <div className="space-y-3">
      <TextField
        label="Witness name"
        value={witness.name}
        onChange={(name) => onChange({ ...witness, name })}
      />
      <div className="space-y-2">
        <Label>Related allegations</Label>
        {allegationTitles.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Add an allegation first.
          </p>
        ) : (
          <div className="space-y-2 rounded-md border p-3">
            {allegationTitles.map((title) => (
              <label key={title} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={witness.relatedAllegations.includes(title)}
                  onChange={(event) =>
                    onChange({
                      ...witness,
                      relatedAllegations: event.target.checked
                        ? uniqueValues([...witness.relatedAllegations, title])
                        : witness.relatedAllegations.filter(
                            (allegation) => allegation !== title,
                          ),
                    })
                  }
                />
                {title}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuoteEditor({
  quote,
  onChange,
}: {
  quote: Quote;
  onChange: (quote: Quote) => void;
}) {
  const [isReplacingText, setIsReplacingText] = useState(false);
  const isVerified = Boolean(quote.provenance?.verified);

  return (
    <div className="space-y-3">
      <NullableTextField
        label="Speaker"
        value={quote.speaker}
        onChange={(speaker) => onChange({ ...quote, speaker })}
      />
      <TextAreaField
        label="Quote"
        value={quote.text}
        onChange={(text) => onChange({ ...quote, text })}
        isReadOnly={isVerified && !isReplacingText}
      />
      <StringListField
        label="Source pages"
        values={quote.sourcePages}
        onChange={(sourcePages) => onChange({ ...quote, sourcePages })}
      />
      {isVerified && !isReplacingText ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            Verified PDF text is locked so its page highlight remains valid.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setIsReplacingText(true)}
          >
            <Pencil />
            Replace quote text
          </Button>
        </div>
      ) : isReplacingText || !quote.provenance ? (
        <p className="text-muted-foreground text-xs">
          Saving relinks this quote against the corrected source. Edit the source
          separately when the transcript itself is wrong.
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        Source status: {quoteSourceStatusLabel(quote)}
      </p>
    </div>
  );
}

function QuoteAttachmentField({
  quotes,
  selectedQuotes,
  onChange,
}: {
  quotes: Quote[];
  selectedQuotes: Quote[];
  onChange: (quotes: Quote[]) => void;
}) {
  if (quotes.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Add a quote in the quotes section before linking evidence.
      </p>
    );
  }

  const selectedKeys = new Set(selectedQuotes.map(quoteKey));
  return (
    <div className="space-y-2">
      <Label>Linked quotes</Label>
      <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
        {quotes.map((quote) => {
          const key = quoteKey(quote);
          return (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedKeys.has(key)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? uniqueQuotes([...selectedQuotes, quote])
                      : selectedQuotes.filter(
                          (selectedQuote) => quoteKey(selectedQuote) !== key,
                        ),
                  )
                }
              />
              <span>
                {quote.text || "Empty quote"}
                <span className="text-muted-foreground block text-xs">
                  {quote.speaker ?? "Unknown speaker"}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function EvidenceStatus({ quotes }: { quotes: Quote[] }) {
  const status = evidenceStatus(quotes);
  const label =
    status === "supported"
      ? "Supported by verified source quote"
      : status === "needs_review"
        ? "Linked evidence needs review"
        : "Unsupported / no linked quote";
  return <p className="text-muted-foreground text-xs">{label}</p>;
}

function evidenceStatus(quotes: Quote[]): Fact["evidenceStatus"] {
  if (quotes.length === 0) return "unsupported";
  return quotes.every(
    (quote) =>
      quote.sourceReviewStatus === "verified" && quote.provenance?.verified,
  )
    ? "supported"
    : "needs_review";
}

function quoteSourceStatusLabel(quote: Quote): string {
  if (quote.sourceReviewStatus === "verified" && quote.provenance?.verified) {
    return `Verified on page ${quote.provenance.pageNumber}`;
  }
  if (quote.sourceReviewStatus === "needs_review") return "Needs review";
  return "Not linked";
}

function uniqueQuotes(quotes: Quote[]): Quote[] {
  return Array.from(new Map(quotes.map((quote) => [quoteKey(quote), quote])).values());
}

function QuoteCorrectionList({
  data,
  onChange,
}: {
  data: ExtractedData;
  onChange: (data: ExtractedData) => void;
}) {
  const quotes = collectQuotes(data);
  return (
    <div className="space-y-3">
      {quotes.map((quote) => {
        const key = quoteKey(quote);
        return (
          <ItemCard
            key={key}
            removeLabel="Remove quote"
            onRemove={() => onChange(updateQuote(data, key, null))}
          >
            <QuoteEditor
              quote={quote}
              onChange={(nextQuote) =>
                onChange(updateQuote(data, key, nextQuote))
              }
            />
          </ItemCard>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          onChange({
            ...data,
            notableQuotes: [...data.notableQuotes, createQuote()],
          })
        }
      >
        <Plus />
        Add quote
      </Button>
    </div>
  );
}

function SimpleItemList<T>({
  items,
  addLabel,
  createItem,
  onChange,
  renderItem,
}: {
  items: T[];
  addLabel: string;
  createItem: () => T;
  onChange: (items: T[]) => void;
  renderItem: (item: T, onChange: (item: T) => void) => React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <ItemCard
          key={index}
          removeLabel="Remove item"
          onRemove={() =>
            onChange(items.filter((_, currentIndex) => currentIndex !== index))
          }
        >
          {renderItem(item, (nextItem) =>
            onChange(replaceItem(items, index, nextItem)),
          )}
        </ItemCard>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...items, createItem()])}
      >
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}

function ItemCard({
  children,
  secondaryAction,
  removeLabel,
  onRemove,
}: {
  children: React.ReactNode;
  secondaryAction?: React.ReactNode;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3 rounded-md border bg-background p-4">
      <div className="flex justify-end gap-2">
        {secondaryAction}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onRemove}
          aria-label={removeLabel}
        >
          <Trash2 />
        </Button>
      </div>
      {children}
    </div>
  );
}

function EditorSection({
  title,
  open = false,
  isHidden = false,
  children,
}: {
  title: string;
  open?: boolean;
  isHidden?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} hidden={isHidden} className="rounded-lg border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        {title}
      </summary>
      <div className="space-y-4 border-t p-4">{children}</div>
    </details>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function NullableTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <TextField
      label={label}
      value={value ?? ""}
      onChange={(nextValue) => onChange(nextValue.trim() ? nextValue : null)}
    />
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  isReadOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isReadOnly?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={isReadOnly}
        className="border-input bg-background min-h-20 w-full rounded-md border p-3 text-sm"
      />
    </div>
  );
}

function StringListField({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        value={values.join(", ")}
        onChange={(event) => onChange(parseList(event.target.value))}
      />
    </div>
  );
}

function mergeAllegations(
  data: ExtractedData,
  sourceIndex: number,
  targetIndex: number,
): ExtractedData {
  const first = data.allegations[targetIndex];
  const second = data.allegations[sourceIndex];
  if (!first || !second) return data;
  const firstTitle = allegationTitle(first);
  const secondTitle = allegationTitle(second);
  const mergedTitle = `${firstTitle} / ${secondTitle}`;
  const merged: Allegation = {
    ...first,
    allegation: mergedTitle,
    description: mergedTitle,
    claimant: first.claimant ?? second.claimant,
    subject: first.subject ?? second.subject,
    relevance:
      first.relevance === "relevant" || second.relevance === "relevant"
        ? "relevant"
        : "not_relevant",
    reviewStatus: "edited",
    supportingEvidence: [
      ...first.supportingEvidence,
      ...second.supportingEvidence,
    ],
    contradictoryEvidence: [
      ...first.contradictoryEvidence,
      ...second.contradictoryEvidence,
    ],
    missingEvidence: uniqueValues([
      ...first.missingEvidence,
      ...second.missingEvidence,
    ]),
    relevantQuotes: [...first.relevantQuotes, ...second.relevantQuotes],
    witnesses: [...first.witnesses, ...second.witnesses],
    followUpQuestions: uniqueValues([
      ...first.followUpQuestions,
      ...second.followUpQuestions,
    ]),
    riskAreas: uniqueValues([...first.riskAreas, ...second.riskAreas]),
    sourcePages: uniqueValues([...first.sourcePages, ...second.sourcePages]),
  };
  const allegations = data.allegations.flatMap((allegation, index) => {
    if (index === sourceIndex) return [];
    return [index === targetIndex ? merged : allegation];
  });
  return {
    ...data,
    allegations,
    potentialWitnesses: data.potentialWitnesses.map((witness) => ({
      ...witness,
      relatedAllegations: uniqueValues(
        witness.relatedAllegations.map((title) =>
          title === firstTitle || title === secondTitle ? mergedTitle : title,
        ),
      ),
    })),
  };
}

function updateAllegation(
  data: ExtractedData,
  index: number,
  allegation: Allegation,
): ExtractedData {
  const previous = data.allegations[index];
  if (!previous) return data;
  const previousTitle = allegationTitle(previous);
  const nextTitle = allegationTitle(allegation);
  return {
    ...data,
    allegations: replaceItem(data.allegations, index, allegation),
    potentialWitnesses: data.potentialWitnesses.map((witness) => ({
      ...witness,
      relatedAllegations: witness.relatedAllegations.map((title) =>
        title === previousTitle ? nextTitle : title,
      ),
    })),
  };
}

function removeAllegation(data: ExtractedData, index: number): ExtractedData {
  const removed = data.allegations[index];
  if (!removed) return data;
  const removedTitle = allegationTitle(removed);
  return {
    ...data,
    allegations: data.allegations.filter(
      (_, currentIndex) => currentIndex !== index,
    ),
    potentialWitnesses: data.potentialWitnesses.map((witness) => ({
      ...witness,
      relatedAllegations: witness.relatedAllegations.filter(
        (title) => title !== removedTitle,
      ),
    })),
  };
}

function updateWarningStatus(
  data: ExtractedData,
  warning: string,
  status: WarningStatus,
  onChange: (data: ExtractedData) => void,
) {
  const remaining = data.extractionWarningReviews.filter(
    (review) => review.warning !== warning,
  );
  onChange({
    ...data,
    extractionWarningReviews: [...remaining, { warning, status }],
  });
}

function collectQuotes(data: ExtractedData): Quote[] {
  const quotes = [
    ...data.notableQuotes,
    ...data.factualStatements.flatMap((fact) => fact.supportingQuotes),
    ...data.keyEvents.flatMap((event) => event.supportingQuotes),
    ...data.potentialWitnesses.flatMap((witness) => witness.supportingQuotes),
    ...data.allegations.flatMap((allegation) => [
      ...allegation.relevantQuotes,
      ...allegation.witnesses.flatMap((witness) => witness.supportingQuotes),
    ]),
  ];
  const byKey = new Map(quotes.map((quote) => [quoteKey(quote), quote]));
  return Array.from(byKey.values());
}

function updateQuote(
  data: ExtractedData,
  key: string,
  replacement: Quote | null,
): ExtractedData {
  const updateList = (quotes: Quote[]) =>
    quotes.flatMap((quote) => {
      if (quoteKey(quote) !== key) return [quote];
      return replacement ? [replacement] : [];
    });

  return {
    ...data,
    notableQuotes: updateList(data.notableQuotes),
    factualStatements: data.factualStatements.map((fact) => {
      const supportingQuotes = updateList(fact.supportingQuotes);
      return {
        ...fact,
        supportingQuotes,
        evidenceStatus: evidenceStatus(supportingQuotes),
      };
    }),
    keyEvents: data.keyEvents.map((event) => {
      const supportingQuotes = updateList(event.supportingQuotes);
      return {
        ...event,
        supportingQuotes,
        evidenceStatus: evidenceStatus(supportingQuotes),
      };
    }),
    potentialWitnesses: data.potentialWitnesses.map((witness) => ({
      ...witness,
      supportingQuotes: updateList(witness.supportingQuotes),
    })),
    allegations: data.allegations.map((allegation) => ({
      ...allegation,
      relevantQuotes: updateList(allegation.relevantQuotes),
      witnesses: allegation.witnesses.map((witness) => ({
        ...witness,
        supportingQuotes: updateList(witness.supportingQuotes),
      })),
    })),
  };
}

function quoteKey(quote: Quote): string {
  return quote.provenance?.id ?? `${quote.speaker ?? ""}|${quote.text}`;
}

function warningStatus(data: ExtractedData, warning: string): WarningStatus {
  return (
    data.extractionWarningReviews.find((review) => review.warning === warning)
      ?.status ?? "needs_correction"
  );
}

function allegationTitle(allegation: Allegation): string {
  return allegation.allegation?.trim() || allegation.description;
}

function replaceItem<T>(items: T[], index: number, item: T): T[] {
  return items.map((current, currentIndex) =>
    currentIndex === index ? item : current,
  );
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

function createQuote(): Quote {
  return {
    speaker: null,
    text: "",
    sourcePages: [],
    sourceReviewStatus: "unlinked",
  };
}

function createAllegation(): Allegation {
  return {
    date: null,
    claimant: null,
    subject: null,
    classification: "primary",
    relevance: "relevant",
    reviewStatus: "ai_generated",
    allegation: "",
    description: "",
    supportingEvidence: [],
    contradictoryEvidence: [],
    missingEvidence: [],
    relevantQuotes: [],
    witnesses: [],
    followUpQuestions: [],
    riskAreas: [],
    sourcePages: [],
  };
}

function createEvent(): Event {
  return {
    title: "",
    date: null,
    approximateDate: false,
    description: "",
    participants: [],
    supportingQuotes: [],
    sourcePages: [],
    evidenceStatus: "unsupported",
  };
}

function createWitness(): Witness {
  return {
    name: "",
    relevance: "",
    relatedAllegations: [],
    supportingQuotes: [],
    sourcePages: [],
  };
}

function createFact(): Fact {
  return {
    description: "",
    supportingQuotes: [],
    sourcePages: [],
    evidenceStatus: "unsupported",
  };
}

export type ExtractionCorrectionSection =
  | "metadata"
  | "people"
  | "allegations"
  | "facts"
  | "events"
  | "witnesses"
  | "quotes"
  | "warnings";

function isVisible(
  selected: ExtractionCorrectionSection | undefined,
  section: ExtractionCorrectionSection,
): boolean {
  return selected === undefined || selected === section;
}
