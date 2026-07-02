"use client";

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
  getCorrectedSourceAction,
  reviewExtractionAction,
  saveCorrectedSourceAction,
} from "@/features/extraction/actions/extraction";
import { CircleOff, ExternalLink, FilePenLine, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { CaseDocument, ContentVersion } from "@/lib/types";

export type ExtractionVersion = ContentVersion;

export function ExtractionReviewControls({
  document,
  version,
  onVersionChange,
}: {
  document: CaseDocument;
  version: ExtractionVersion;
  onVersionChange: (version: ExtractionVersion) => void;
}) {
  const router = useRouter();
  const [isSourceEditorOpen, setIsSourceEditorOpen] = useState(false);
  const [isExcludeDialogOpen, setIsExcludeDialogOpen] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [isPending, startTransition] = useTransition();

  function openSourceEditor() {
    startTransition(async () => {
      const result = await getCorrectedSourceAction(document.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      setSourceText(result.sourceText);
      setIsSourceEditorOpen(true);
    });
  }

  function saveSource() {
    startTransition(async () => {
      const result = await saveCorrectedSourceAction(
        document.id,
        sourceText,
        version,
        document.extractionRevision,
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      onVersionChange("edited");
      setIsSourceEditorOpen(false);
      router.refresh();
      toast.success("Corrected source saved. Unmatched evidence needs review.");
    });
  }

  function excludeDocument() {
    startTransition(async () => {
      const result = await reviewExtractionAction(
        document.id,
        "exclude",
        undefined,
        version,
        document.extractionRevision,
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      onVersionChange(
        result.document.investigatorExtractedData ? "edited" : "ai",
      );
      setIsExcludeDialogOpen(false);
      router.refresh();
      toast.success("Document excluded from downstream analysis.");
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <span className="text-muted-foreground text-xs">Viewing:</span>
        <VersionButton
          label="AI output"
          active={version === "ai"}
          disabled={!document.aiExtractedData}
          onClick={() => onVersionChange("ai")}
        />
        <VersionButton
          label="My adjustments"
          active={version === "edited"}
          disabled={!document.investigatorExtractedData}
          onClick={() => onVersionChange("edited")}
        />
        <VersionButton
          label="Approved"
          active={version === "approved"}
          disabled={!document.approvedExtractedData}
          onClick={() => onVersionChange("approved")}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={openSourceEditor}
          disabled={isPending}
        >
          <FilePenLine />
          {isPending && !isSourceEditorOpen ? "Loading source…" : "Correct source"}
        </Button>
        <Button asChild type="button" size="sm" variant="outline">
          <a
            href={`/api/documents/${document.id}/source?version=original&page=1`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink />
            Original upload
          </a>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setIsExcludeDialogOpen(true)}
          disabled={isPending || document.extractionReviewStatus === "excluded"}
        >
          <CircleOff />
          {document.extractionReviewStatus === "excluded"
            ? "Excluded"
            : "Exclude"}
        </Button>
      </div>

      {isSourceEditorOpen ? (
        <Dialog open onOpenChange={setIsSourceEditorOpen}>
          <DialogContent className="max-h-[90vh] sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>Correct source text</DialogTitle>
              <DialogDescription>
                This updates the editable duplicate. The original upload remains unchanged.
              </DialogDescription>
            </DialogHeader>
            <textarea
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              className="border-input bg-background min-h-[60vh] w-full resize-y rounded-md border p-3 font-mono text-sm"
              aria-label="Corrected source text"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsSourceEditorOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveSource} disabled={isPending}>
                <Save />
                {isPending ? "Saving…" : "Save corrected source"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      <Dialog open={isExcludeDialogOpen} onOpenChange={setIsExcludeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exclude this document?</DialogTitle>
            <DialogDescription>
              The extraction will not be used in analysis. Existing extraction
              versions and the original upload remain available.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsExcludeDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={excludeDocument}
              disabled={isPending}
            >
              <CircleOff />
              {isPending ? "Excluding…" : "Exclude document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function VersionButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
