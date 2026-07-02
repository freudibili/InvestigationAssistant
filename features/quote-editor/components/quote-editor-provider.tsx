"use client";

import { createContext, useContext, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { ExternalLink, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveQuoteCorrectionAction } from "@/features/quote-editor/actions/quote-editor";
import { QuoteEditorPanel } from "@/features/quote-editor/components/quote-editor-panel";
import type { ContentVersion } from "@/lib/types";

const SourcePdfViewer = dynamic(
  () => import("@/components/pdf/source-viewer").then((m) => m.SourcePdfViewer),
  { ssr: false },
);

export type QuoteEditorTarget = {
  caseId?: string;
  documentId: string;
  expectedRevision: number;
  documentName: string;
  label: string;
  page: number;
  quoteId?: string;
  charStart?: number | null;
  charEnd?: number | null;
  pageCharStart?: number | null;
  pageCharEnd?: number | null;
  normalizedPageCharStart?: number | null;
  normalizedPageCharEnd?: number | null;
  quote?: string | null;
  version?: ContentVersion;
};

const QuoteEditorContext = createContext<
  ((target: QuoteEditorTarget) => void) | null
>(null);

export function useQuoteEditor() {
  return useContext(QuoteEditorContext);
}

function sourceHref(target: QuoteEditorTarget) {
  const params = new URLSearchParams();
  if (target.quoteId) params.set("quoteId", target.quoteId);
  else params.set("page", String(target.page));
  if (target.version) params.set("version", target.version);
  if (target.caseId) {
    return `/cases/${target.caseId}/documents/${target.documentId}/source?${params.toString()}`;
  }
  return `/api/documents/${target.documentId}/source?${params.toString()}`;
}

export function QuoteEditorProvider({
  children,
  onQuoteSaved,
}: {
  children: React.ReactNode;
  onQuoteSaved?: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<QuoteEditorTarget | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [correctedText, setCorrectedText] = useState("");
  const [isPending, startTransition] = useTransition();

  function openTarget(nextTarget: QuoteEditorTarget) {
    setIsEditing(false);
    setSelectedText(nextTarget.quote ?? "");
    setCorrectedText(nextTarget.quote ?? "");
    setTarget(nextTarget);
  }

  function selectQuoteText(text: string) {
    setSelectedText(text);
    setCorrectedText(text);
  }

  function saveQuote() {
    if (!target?.quoteId) return;
    startTransition(async () => {
      const result = await saveQuoteCorrectionAction({
        documentId: target.documentId,
        expectedRevision: target.expectedRevision,
        quoteId: target.quoteId as string,
        page: target.page,
        selectedText,
        correctedText,
        sourceVersion: target.version,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setTarget(null);
      onQuoteSaved?.();
      router.refresh();
      toast.success(
        result.sourceChanged
          ? "Quote and corrected PDF saved."
          : "Quote selection saved.",
      );
    });
  }

  return (
    <QuoteEditorContext.Provider value={openTarget}>
      {children}
      <Dialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
      >
        <DialogContent className="flex h-[88vh] max-w-[min(96vw,80rem)] flex-col gap-3 p-4 sm:max-w-[min(96vw,80rem)]">
          {target ? (
            <>
              <DialogHeader className="pr-8">
                <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span className="truncate">{target.documentName}</span>
                  <span className="text-muted-foreground font-normal">
                    · {target.label}
                  </span>
                  <a
                    href={sourceHref(target)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-normal"
                  >
                    <ExternalLink className="size-3.5" />
                    Open in new tab
                  </a>
                  {target.quoteId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={isEditing ? "secondary" : "outline"}
                      onClick={() => setIsEditing((current) => !current)}
                    >
                      <Pencil />
                      {isEditing ? "Editing quote" : "Edit quote"}
                    </Button>
                  ) : null}
                </DialogTitle>
              </DialogHeader>
              <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
                <SourcePdfViewer
                  documentId={target.documentId}
                  page={target.page}
                  quoteId={target.quoteId}
                  charStart={target.charStart}
                  charEnd={target.charEnd}
                  pageCharStart={target.pageCharStart}
                  pageCharEnd={target.pageCharEnd}
                  normalizedPageCharStart={target.normalizedPageCharStart}
                  normalizedPageCharEnd={target.normalizedPageCharEnd}
                  quote={target.quote}
                  version={target.version}
                  onTextSelection={isEditing ? selectQuoteText : undefined}
                />
                {isEditing ? (
                  <QuoteEditorPanel
                    selectedText={selectedText}
                    correctedText={correctedText}
                    isSaving={isPending}
                    onCorrectedTextChange={setCorrectedText}
                    onSave={saveQuote}
                  />
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </QuoteEditorContext.Provider>
  );
}
