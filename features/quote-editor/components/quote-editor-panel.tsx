"use client";

import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";

export function QuoteEditorPanel({
  selectedText,
  correctedText,
  isSaving,
  onCorrectedTextChange,
  onSave,
}: {
  selectedText: string;
  correctedText: string;
  isSaving: boolean;
  onCorrectedTextChange: (text: string) => void;
  onSave: () => void;
}) {
  const isSourceCorrection = correctedText.trim() !== selectedText.trim();

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 rounded-md border p-3 lg:w-80">
      <div>
        <p className="text-sm font-medium">Adjust quote</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Select text on the PDF to extend or reduce the quote.
        </p>
      </div>
      <label className="space-y-1.5">
        <span className="text-xs font-medium">PDF selection</span>
        <textarea
          value={selectedText}
          readOnly
          className="border-input bg-muted min-h-24 w-full resize-none rounded-md border p-2 text-xs"
        />
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium">Saved quote text</span>
        <textarea
          value={correctedText}
          onChange={(event) => onCorrectedTextChange(event.target.value)}
          className="border-input bg-background min-h-32 w-full resize-y rounded-md border p-2 text-sm"
        />
      </label>
      {isSourceCorrection ? (
        <p className="text-muted-foreground text-xs">
          The selected source wording will be replaced and a corrected PDF will
          be created.
        </p>
      ) : null}
      <Button
        type="button"
        className="mt-auto"
        onClick={onSave}
        disabled={isSaving || !selectedText.trim() || !correctedText.trim()}
      >
        <Save />
        {isSaving ? "Saving…" : "Save quote"}
      </Button>
    </aside>
  );
}
