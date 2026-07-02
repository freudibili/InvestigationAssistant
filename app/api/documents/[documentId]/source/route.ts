import { NextResponse } from "next/server";
import {
  createSignedUrl,
  getDocument,
  getDocumentExtractionVersion,
  getDocumentSourceUrl,
  type DocumentSourceVersion,
} from "@/lib/db/documents";
import { findQuoteProvenanceById } from "@/features/extraction/lib/quote-grounding";
import { CONTENT_VERSIONS, type ContentVersion } from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await params;
    const document = await getDocument(documentId);
    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    const searchParams = new URL(request.url).searchParams;
    const requestedVersion = searchParams.get("version");
    const version: DocumentSourceVersion | undefined =
      requestedVersion === "original" ||
      CONTENT_VERSIONS.includes(requestedVersion as ContentVersion)
        ? (requestedVersion as DocumentSourceVersion)
        : undefined;
    const signedUrl = await createSignedUrl(
      getDocumentSourceUrl(document, version),
    );
    if (!signedUrl) {
      return NextResponse.json(
        { error: "Could not open source document" },
        { status: 500 },
      );
    }

    const quoteId = searchParams.get("quoteId");
    const quoteProvenance = quoteId
      ? findQuoteProvenanceById(
          getDocumentExtractionVersion(
            document,
            version === "original" ? undefined : version,
          ),
          quoteId,
        )
      : null;

    if (
      quoteId &&
      (!quoteProvenance?.verified ||
        !quoteProvenance.pageNumber ||
        quoteProvenance.charStart === null ||
        quoteProvenance.charEnd === null)
    ) {
      return NextResponse.json(
        { error: "No verified supporting quote available" },
        { status: 404 },
      );
    }

    const page = searchParams.get("page");
    const pageNumber =
      quoteProvenance?.pageNumber ?? (page ? Number(page) : null);
    const pageFragment =
      pageNumber && Number.isInteger(pageNumber) && pageNumber > 0
        ? `#page=${pageNumber}`
        : "";

    return NextResponse.redirect(`${signedUrl}${pageFragment}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
