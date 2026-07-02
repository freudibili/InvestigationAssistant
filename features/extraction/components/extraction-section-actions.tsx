"use client";

import { Check, Pencil, Save } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ReviewStatusBadge } from "@/features/extraction/components/review-status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  reviewExtractionAction,
  saveExtractionCorrectionAction,
} from "@/features/extraction/actions/extraction";
import {
  ExtractionCorrectionForm,
  type ExtractionCorrectionSection,
} from "@/features/extraction/components/extraction-correction-form";
import type { ExtractionVersion } from "@/features/extraction/components/extraction-review-controls";
import type { CaseDocument, ExtractedData } from "@/lib/types";
import {
  isExtractionReviewComplete,
  resetExtractionReview,
} from "@/features/extraction/lib/review";

export function ExtractionSectionActions({
  document,
  data,
  version,
  section,
  title,
  allegationIndex,
  onVersionChange,
}: {
  document: CaseDocument;
  data: ExtractedData;
  version: ExtractionVersion;
  section: ExtractionCorrectionSection;
  title: string;
  allegationIndex?: number;
  onVersionChange: (version: ExtractionVersion) => void;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(data);
  const [isPending, startTransition] = useTransition();
  const status = sectionStatus(data, section, allegationIndex);

  function openEditor() {
    setDraft(data);
    setIsOpen(true);
  }

  function persist(nextData: ExtractedData, successMessage: string) {
    if (!document.intervieweeRole) {
      toast.error("Select the interviewee role before adjusting extraction.");
      return;
    }
    const intervieweeRole = document.intervieweeRole;
    startTransition(async () => {
      const result = await saveExtractionCorrectionAction(
        document.id,
        nextData,
        undefined,
        intervieweeRole,
        version,
        document.extractionRevision,
      );
      if (!result.ok) {
        toast.error(result.message);
        if (/changed since/i.test(result.message)) {
          setIsOpen(false);
          router.refresh();
        }
        return;
      }

      const correctedData = result.document.investigatorExtractedData;
      if (correctedData && isExtractionReviewComplete(correctedData)) {
        const approval = await reviewExtractionAction(
          document.id,
          "approve",
          undefined,
          "edited",
          result.document.extractionRevision,
        );
        if (approval.ok) {
          onVersionChange("approved");
          setIsOpen(false);
          router.refresh();
          toast.success("Extraction approved.");
          return;
        }
        toast.error(approval.message);
        onVersionChange("edited");
        setIsOpen(false);
        router.refresh();
        return;
      }

      onVersionChange("edited");
      setIsOpen(false);
      router.refresh();
      const unverifiedQuoteCount =
        section === "quotes" && correctedData
          ? countUnverifiedQuotes(correctedData)
          : 0;
      if (unverifiedQuoteCount > 0) {
        toast.warning(
          `${successMessage} ${unverifiedQuoteCount} quote${unverifiedQuoteCount === 1 ? " could" : "s could"} not be matched to the PDF.`,
        );
        return;
      }
      toast.success(successMessage);
    });
  }

  function saveEdit() {
    const reviewableDraft = ["people", "quotes"].includes(section)
      ? resetExtractionReview(draft)
      : draft;
    const nextData =
      section === "allegations" &&
      reviewableDraft.allegations.length !== data.allegations.length
        ? reviewableDraft
        : markSection(reviewableDraft, section, allegationIndex, "edited");
    persist(nextData, `${title} saved.`);
  }

  function approve() {
    persist(
      markSection(data, section, allegationIndex, "approved"),
      `${title} approved.`,
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ReviewStatusBadge status={status} />
        <Button type="button" size="sm" variant="outline" onClick={openEditor}>
          <Pencil />
          Edit
        </Button>
        <Button
          type="button"
          size="sm"
          variant={status === "approved" ? "secondary" : "default"}
          onClick={approve}
          disabled={isPending || status === "approved"}
        >
          <Check />
          {status === "approved" ? "Approved" : "Approve"}
        </Button>
      </div>

      {isOpen ? (
        <Dialog open onOpenChange={setIsOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Edit {title}</DialogTitle>
              <DialogDescription>
                Only this section is being adjusted. Other extraction data is
                preserved.
              </DialogDescription>
            </DialogHeader>
            <ExtractionCorrectionForm
              data={draft}
              onChange={setDraft}
              section={section}
              allegationIndex={allegationIndex}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveEdit} disabled={isPending}>
                <Save />
                {isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function sectionStatus(
  data: ExtractedData,
  section: ExtractionCorrectionSection,
  allegationIndex?: number,
): "ai_generated" | "edited" | "approved" {
  if (section === "allegations" && allegationIndex !== undefined) {
    return data.allegations[allegationIndex]?.reviewStatus ?? "ai_generated";
  }
  return data.sectionReviewStates[section] ?? "ai_generated";
}

function markSection(
  data: ExtractedData,
  section: ExtractionCorrectionSection,
  allegationIndex: number | undefined,
  status: "edited" | "approved",
): ExtractedData {
  if (section === "allegations" && allegationIndex !== undefined) {
    return {
      ...data,
      allegations: data.allegations.map((allegation, index) =>
        index === allegationIndex
          ? { ...allegation, reviewStatus: status }
          : allegation,
      ),
    };
  }
  return {
    ...data,
    sectionReviewStates: { ...data.sectionReviewStates, [section]: status },
  };
}

function countUnverifiedQuotes(data: ExtractedData): number {
  const quotes = [
    ...data.notableQuotes,
    ...data.allegations.flatMap((item) => item.relevantQuotes),
    ...data.allegations.flatMap((item) =>
      item.witnesses.flatMap((witness) => witness.supportingQuotes),
    ),
    ...data.factualStatements.flatMap((item) => item.supportingQuotes),
    ...data.keyEvents.flatMap((item) => item.supportingQuotes),
    ...data.potentialWitnesses.flatMap((item) => item.supportingQuotes),
  ];
  return new Set(
    quotes
      .filter((quote) => !quote.provenance?.verified)
      .map((quote) => `${quote.speaker ?? ""}|${quote.text}`),
  ).size;
}
