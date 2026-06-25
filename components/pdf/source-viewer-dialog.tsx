"use client";

import { createContext, useContext, useState } from "react";
import dynamic from "next/dynamic";
import { ExternalLink } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// pdf.js is heavy and browser-only — load the viewer lazily, client-side only.
const SourcePdfViewer = dynamic(
  () => import("@/components/pdf/source-viewer").then((m) => m.SourcePdfViewer),
  { ssr: false }
);

export type SourceViewerTarget = {
  caseId?: string;
  documentId: string;
  documentName: string;
  /** Human label for the page, e.g. "Page 4". */
  label: string;
  /** 1-based page to open. */
  page: number;
  quoteId?: string;
  charStart?: number | null;
  charEnd?: number | null;
  pageCharStart?: number | null;
  pageCharEnd?: number | null;
  normalizedPageCharStart?: number | null;
  normalizedPageCharEnd?: number | null;
  /** Verbatim quote to highlight on the page, when the source is a quote. */
  quote?: string | null;
};

const SourceViewerContext = createContext<
  ((target: SourceViewerTarget) => void) | null
>(null);

/** Returns an opener for the source viewer, or null when no provider is mounted. */
export function useSourceViewer() {
  return useContext(SourceViewerContext);
}

function sourceHref(target: SourceViewerTarget) {
  const params = new URLSearchParams();
  if (target.quoteId) params.set("quoteId", target.quoteId);
  else params.set("page", String(target.page));
  if (target.caseId) {
    return `/cases/${target.caseId}/documents/${target.documentId}/source?${params.toString()}`;
  }
  return `/api/documents/${target.documentId}/source?${params.toString()}`;
}

/**
 * Provides the source-PDF viewer to its subtree. Any descendant can open the
 * dialog via {@link useSourceViewer}; the dialog renders the cited PDF page with
 * the exact quote highlighted. Shared by the Extraction result and the
 * Investigation Analysis dashboard so traceability behaves identically.
 */
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
        onOpenChange={(open) => !open && setTarget(null)}
      >
        <DialogContent className="flex h-[88vh] max-w-[min(96vw,72rem)] flex-col gap-3 p-4 sm:max-w-[min(96vw,72rem)]">
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
          ) : null}
        </DialogContent>
      </Dialog>
    </SourceViewerContext.Provider>
  );
}
