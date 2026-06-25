import { NextResponse } from "next/server";
import { createSignedUrl, getDocument } from "@/lib/db/documents";

export async function GET(
  request: Request,
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

    const page = new URL(request.url).searchParams.get("page");
    const pageNumber = page ? Number(page) : null;
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
