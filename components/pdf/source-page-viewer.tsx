"use client";

import dynamic from "next/dynamic";

import type { SourcePdfViewerProps } from "@/components/pdf/source-viewer";

const SourcePdfViewer = dynamic(
  () => import("@/components/pdf/source-viewer").then((m) => m.SourcePdfViewer),
  { ssr: false }
);

export function SourcePageViewer(props: SourcePdfViewerProps) {
  return <SourcePdfViewer {...props} />;
}
