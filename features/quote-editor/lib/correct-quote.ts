import "server-only";

import { convertMarkedTextToPdf } from "@/features/extraction/lib/pdf-convert";
import { resetExtractionReview } from "@/features/extraction/lib/review";
import {
  createRawOffsetMapper,
  findQuoteProvenanceById,
  groundExtractionQuotes,
} from "@/features/extraction/lib/quote-grounding";
import type { QuoteCorrection } from "@/features/quote-editor/validation";
import {
  getDocument,
  saveInvestigatorExtraction,
} from "@/lib/db/documents";
import type {
  CaseDocument,
  ContentVersion,
  ExtractedData,
} from "@/lib/types";
import { correctedSourceTextSchema } from "@/lib/validation";

export async function correctQuote(input: QuoteCorrection): Promise<{
  document: CaseDocument;
  sourceChanged: boolean;
}> {
  const currentDocument = await getDocument(input.documentId);
  if (!currentDocument) throw new Error("Document not found.");
  if (currentDocument.extractionRevision !== input.expectedRevision) {
    throw new Error("Extraction changed since it was opened. Reload and try again.");
  }
  if (!currentDocument.intervieweeRole) {
    throw new Error("Select the interviewee role first.");
  }
  if (currentDocument.status === "extracting") {
    throw new Error("Wait for extraction to finish before correcting a quote.");
  }

  const sourceVersion = quoteSourceVersion(
    currentDocument,
    input.quoteId,
    input.sourceVersion,
  );
  const extraction = extractionVersionData(currentDocument, sourceVersion);
  const sourceText = sourceTextForVersion(currentDocument, sourceVersion);
  const sourceFileUrl = sourceFileUrlForVersion(currentDocument, sourceVersion);
  if (!extraction || !sourceText || !sourceFileUrl) {
    throw new Error("The quote source is unavailable.");
  }

  const selectedExtraction = replaceExtractionQuote(
    extraction,
    input.quoteId,
    input.selectedText,
    input.page,
  );
  if (!selectedExtraction) throw new Error("The quote is no longer available.");

  const sourceBranchChanged =
    sourceText !== currentDocument.correctedRawText ||
    sourceFileUrl !== currentDocument.correctedFileUrl;
  const sourceTextChanged = input.correctedText !== input.selectedText;
  const sourceChanged = sourceBranchChanged || sourceTextChanged;
  const sourceRevision =
    currentDocument.correctedSourceRevision + (sourceChanged ? 1 : 0);
  const groundedSelection = await groundExtractionQuotes({
    documentId: currentDocument.id,
    rawText: sourceText,
    extractedData: selectedExtraction,
    preserveUnverifiedQuotes: true,
    sourceRevision,
  });
  const selectedProvenance = findQuoteProvenanceById(
    groundedSelection,
    input.quoteId,
  );
  if (!selectedProvenance || selectedProvenance.pageNumber !== input.page) {
    throw new Error("The selected PDF text could not be linked to this page.");
  }

  let correctedSourceText = sourceText;
  let correctedExtraction = groundedSelection;
  let correctedPdfBytes: Uint8Array | undefined;
  if (sourceTextChanged) {
    const sourceRange = createRawOffsetMapper(sourceText)(
      selectedProvenance.charStart,
      selectedProvenance.charEnd,
    );
    if (!sourceRange) {
      throw new Error(
        "The selected text crosses a page boundary and cannot be replaced.",
      );
    }
    correctedSourceText = correctedSourceTextSchema.parse(
      sourceText.slice(0, sourceRange.rawStart) +
        input.correctedText +
        sourceText.slice(sourceRange.rawEnd),
    );
    const editedExtraction = replaceExtractionQuote(
      extraction,
      input.quoteId,
      input.correctedText,
      input.page,
    );
    if (!editedExtraction) throw new Error("The quote is no longer available.");
    correctedExtraction = await groundExtractionQuotes({
      documentId: currentDocument.id,
      rawText: correctedSourceText,
      extractedData: editedExtraction,
      preserveUnverifiedQuotes: true,
      sourceRevision,
    });
    if (!findQuoteProvenanceById(correctedExtraction, input.quoteId)) {
      throw new Error(
        "The corrected quote could not be linked to the updated source.",
      );
    }
    correctedPdfBytes = await convertMarkedTextToPdf(correctedSourceText);
  }

  const document = await saveInvestigatorExtraction({
    documentId: currentDocument.id,
    extractedData: resetExtractionReview(correctedExtraction),
    intervieweeRole: currentDocument.intervieweeRole,
    sourceVersion,
    reason: "Quote corrected in the source viewer.",
    expectedRevision: currentDocument.extractionRevision,
    correctedSource: correctedPdfBytes
      ? { rawText: correctedSourceText, pdfBytes: correctedPdfBytes }
      : { rawText: correctedSourceText, fileUrl: sourceFileUrl },
  });
  return { document, sourceChanged };
}

function extractionVersionData(
  document: CaseDocument,
  version: ContentVersion,
): CaseDocument["extractedData"] {
  if (version === "approved") return document.approvedExtractedData;
  if (version === "edited") return document.investigatorExtractedData;
  return document.aiExtractedData ?? document.extractedData;
}

function quoteSourceVersion(
  document: CaseDocument,
  quoteId: string,
  requestedVersion?: ContentVersion,
): ContentVersion {
  const versions = requestedVersion
    ? [requestedVersion]
    : (["approved", "edited", "ai"] satisfies ContentVersion[]);
  return (
    versions.find((version) =>
      findQuoteProvenanceById(extractionVersionData(document, version), quoteId),
    ) ??
    requestedVersion ??
    "ai"
  );
}

function sourceTextForVersion(
  document: CaseDocument,
  version: ContentVersion,
): string | null {
  if (version === "approved") {
    return document.approvedRawText ?? document.correctedRawText;
  }
  if (version === "edited") return document.correctedRawText;
  return document.aiRawText ?? document.correctedRawText ?? document.rawText;
}

function sourceFileUrlForVersion(
  document: CaseDocument,
  version: ContentVersion,
): string | null {
  if (version === "approved") {
    return document.approvedFileUrl ?? document.correctedFileUrl;
  }
  if (version === "edited") return document.correctedFileUrl;
  return document.aiFileUrl ?? document.correctedFileUrl;
}

type ExtractionQuote = ExtractedData["notableQuotes"][number];

function replaceExtractionQuote(
  extraction: ExtractedData,
  quoteId: string,
  text: string,
  page: number,
): ExtractedData | null {
  let replacementCount = 0;
  const replaceQuotes = (quotes: ExtractionQuote[]) =>
    quotes.map((quote) => {
      if (quote.provenance?.id !== quoteId) return quote;
      replacementCount += 1;
      const { provenance: _provenance, ...quoteWithoutProvenance } = quote;
      return {
        ...quoteWithoutProvenance,
        text,
        sourcePages: [`Page ${page}`],
        sourceReviewStatus: "unlinked" as const,
      };
    });
  const updateEvidenceStatus = (quotes: ExtractionQuote[]) =>
    quotes.length === 0
      ? ("unsupported" as const)
      : quotes.every(
            (quote) =>
              quote.sourceReviewStatus === "verified" &&
              quote.provenance?.verified,
          )
        ? ("supported" as const)
        : ("needs_review" as const);

  const notableQuotes = replaceQuotes(extraction.notableQuotes);
  const factualStatements = extraction.factualStatements.map((fact) => {
    const supportingQuotes = replaceQuotes(fact.supportingQuotes);
    return {
      ...fact,
      supportingQuotes,
      evidenceStatus: updateEvidenceStatus(supportingQuotes),
    };
  });
  const keyEvents = extraction.keyEvents.map((event) => {
    const supportingQuotes = replaceQuotes(event.supportingQuotes);
    return {
      ...event,
      supportingQuotes,
      evidenceStatus: updateEvidenceStatus(supportingQuotes),
    };
  });
  const potentialWitnesses = extraction.potentialWitnesses.map((witness) => ({
    ...witness,
    supportingQuotes: replaceQuotes(witness.supportingQuotes),
  }));
  const allegations = extraction.allegations.map((allegation) => ({
    ...allegation,
    relevantQuotes: replaceQuotes(allegation.relevantQuotes),
    witnesses: allegation.witnesses.map((witness) => ({
      ...witness,
      supportingQuotes: replaceQuotes(witness.supportingQuotes),
    })),
  }));
  const pageFindings = extraction.pageFindings.map((pageFinding) => ({
    ...pageFinding,
    notableQuotes: replaceQuotes(pageFinding.notableQuotes),
    allegations: pageFinding.allegations.map((allegation) => ({
      ...allegation,
      relevantQuotes: replaceQuotes(allegation.relevantQuotes),
    })),
    potentialWitnesses: pageFinding.potentialWitnesses.map((witness) => ({
      ...witness,
      supportingQuotes: replaceQuotes(witness.supportingQuotes),
    })),
    relevantEvents: pageFinding.relevantEvents.map((event) => ({
      ...event,
      supportingQuotes: replaceQuotes(event.supportingQuotes),
    })),
  }));

  if (replacementCount === 0) return null;
  return {
    ...extraction,
    notableQuotes,
    factualStatements,
    keyEvents,
    potentialWitnesses,
    allegations,
    pageFindings,
  };
}
