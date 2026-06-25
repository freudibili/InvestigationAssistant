import { NextResponse } from "next/server";
import { createSignedUrl, getDocument } from "@/lib/db/documents";

/**
 * Stream the document's stored PDF bytes through our own origin. The PDF.js
 * viewer loads from here (rather than the Supabase signed URL directly) so the
 * fetch is same-origin and never blocked by storage CORS. The `…/source` route
 * still 302-redirects to the signed URL for "open in new tab".
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    const document = await getDocument(documentId);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const signedUrl = await createSignedUrl(document.fileUrl);
    if (!signedUrl) {
      return NextResponse.json(
        { error: "Could not open source document" },
        { status: 500 }
      );
    }

    const upstream = await fetch(signedUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: "Could not read source document" },
        { status: 502 }
      );
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
