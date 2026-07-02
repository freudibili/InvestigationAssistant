"use client";

import dynamic from "next/dynamic";
import { ExternalLink } from "lucide-react";
import { createContext, useContext, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SourcePdfViewer = dynamic(
  () => import("@/components/pdf/source-viewer").then((module) => module.SourcePdfViewer),
  { ssr: false },
);

export type SourceViewerTarget = {
  caseId?: string;
  documentId: string;
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
};

const SourceViewerContext = createContext<
  ((target: SourceViewerTarget) => void) | null
>(null);

export function useSourceViewer() {
  return useContext(SourceViewerContext);
}

export function SourceViewerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [target, setTarget] = useState<SourceViewerTarget | null>(null);

  return (
    <SourceViewerContext.Provider value={setTarget}>
      {children}
      <Dialog
        open={target !== null}
        onOpenChange={(isOpen) => !isOpen && setTarget(null)}
      >
        <DialogContent className="flex h-[88vh] max-w-[min(96vw,72rem)] flex-col gap-3 p-4 sm:max-w-[min(96vw,72rem)]">
          {target ? <SourceViewerContent target={target} /> : null}
        </DialogContent>
      </Dialog>
    </SourceViewerContext.Provider>
  );
}

function SourceViewerContent({ target }: { target: SourceViewerTarget }) {
  return (
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
        </DialogTitle>
      </DialogHeader>
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
      />
    </>
  );
}

function sourceHref(target: SourceViewerTarget): string {
  const searchParams = new URLSearchParams();
  if (target.quoteId) searchParams.set("quoteId", target.quoteId);
  else searchParams.set("page", String(target.page));

  return target.caseId
    ? `/cases/${target.caseId}/documents/${target.documentId}/source?${searchParams}`
    : `/api/documents/${target.documentId}/source?${searchParams}`;
}
