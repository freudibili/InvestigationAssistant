import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { SourcePageViewer } from "@/components/pdf/source-page-viewer";
import { Button } from "@/components/ui/button";
import { getDocument } from "@/lib/db/documents";
import { findQuoteProvenanceById } from "@/features/extraction/lib/quote-grounding";

type SourcePageProps = {
  params: Promise<{ caseId: string; documentId: string }>;
  searchParams: Promise<{ quoteId?: string; page?: string }>;
};

export default async function SourcePage({
  params,
  searchParams,
}: SourcePageProps) {
  const [{ caseId, documentId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const document = await getDocument(documentId);

  if (!document || document.caseId !== caseId) {
    notFound();
  }

  const provenance = query.quoteId
    ? findQuoteProvenanceById(document.extractedData, query.quoteId)
    : null;
  const hasClickableQuote =
    Boolean(provenance?.verified && provenance.pageNumber) &&
    provenance?.charStart !== null &&
    provenance?.charEnd !== null;
  const queryPage = query.page ? Number(query.page) : null;
  const page =
    hasClickableQuote && provenance?.pageNumber
      ? provenance.pageNumber
      : queryPage && Number.isInteger(queryPage) && queryPage > 0
        ? queryPage
        : 1;

  return (
    <main className="flex h-dvh flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{document.fileName}</p>
          <p className="text-muted-foreground text-xs">
            {hasClickableQuote && provenance?.pageNumber
              ? `Page ${provenance.pageNumber}`
              : query.quoteId
                ? "No verified supporting quote available"
                : `Page ${page}`}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/cases/${caseId}/extraction/${documentId}`}>
            <ArrowLeft className="size-4" />
            Back to extraction
          </Link>
        </Button>
      </div>
      {query.quoteId && !hasClickableQuote ? (
        <div className="text-muted-foreground rounded-md border border-dashed p-6 text-sm">
          No verified supporting quote available.
        </div>
      ) : (
        <SourcePageViewer
          documentId={documentId}
          page={page}
          quoteId={provenance?.id}
          charStart={provenance?.charStart}
          charEnd={provenance?.charEnd}
          pageCharStart={provenance?.pageCharStart}
          pageCharEnd={provenance?.pageCharEnd}
          normalizedPageCharStart={provenance?.normalizedPageCharStart}
          normalizedPageCharEnd={provenance?.normalizedPageCharEnd}
          quote={provenance?.quoteText}
        />
      )}
    </main>
  );
}
