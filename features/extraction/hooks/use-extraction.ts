"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchJson } from "@/lib/api/fetcher";
import {
  cancelExtractionAction,
  extractDocumentAction,
} from "@/features/extraction/actions/extraction";
import type { Case, CaseDocument } from "@/lib/types";

interface CaseResponse {
  case: Case;
  documents: CaseDocument[];
}

interface DocumentResponse {
  document: CaseDocument;
}

export function useExtractDocument(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      // The action returns failures instead of throwing (so the real message
      // survives in production). Re-throw on the client, where react-query's
      // error handling and the caller's try/catch expect a rejection.
      const result = await extractDocumentAction(documentId);
      if (!result.ok) {
        const error = new Error(result.message);
        if (result.canceled) error.name = "ExtractionCanceledError";
        throw error;
      }
      return result.document;
    },
    onMutate: async (documentId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.case(caseId) });
      await queryClient.cancelQueries({
        queryKey: queryKeys.document(documentId),
      });

      const optimisticProgress = {
        status: "extracting" as const,
        extractionCurrentStep: 0,
        extractionTotalSteps: 0,
        extractionStep: "Preparing document",
      };

      queryClient.setQueryData<CaseResponse>(
        queryKeys.case(caseId),
        (current) => {
          if (!current) return current;

          return {
            ...current,
            documents: current.documents.map((document) =>
              document.id === documentId
                ? { ...document, ...optimisticProgress }
                : document
            ),
          };
        }
      );

      // The progress UI reads `useDocumentProgress` (the per-document cache)
      // first, so without this a re-extraction would show the previous run's
      // stale terminal status until the first poll lands. Mark it extracting
      // now so the steps appear the instant the button is pressed.
      queryClient.setQueryData<CaseDocument>(
        queryKeys.document(documentId),
        (current) =>
          current ? { ...current, ...optimisticProgress } : current
      );
    },
    onSuccess: (document) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.case(caseId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.document(document.id),
      });
      queryClient.setQueryData(queryKeys.document(document.id), document);
    },
  });
}

export function useCancelExtraction(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => cancelExtractionAction(documentId),
    onMutate: async (documentId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.case(caseId) });
      await queryClient.cancelQueries({
        queryKey: queryKeys.document(documentId),
      });

      queryClient.setQueryData<CaseResponse>(
        queryKeys.case(caseId),
        (current) => {
          if (!current) return current;

          return {
            ...current,
            documents: current.documents.map((document) =>
              document.id === documentId
                ? {
                    ...document,
                    status: "canceled",
                    extractionStep: "Extraction canceled",
                  }
                : document
            ),
          };
        }
      );
      queryClient.setQueryData<CaseDocument>(
        queryKeys.document(documentId),
        (current) =>
          current
            ? {
                ...current,
                status: "canceled",
                extractionStep: "Extraction canceled",
              }
            : current
      );
    },
    onSuccess: (document) => {
      queryClient.setQueryData<CaseResponse>(
        queryKeys.case(caseId),
        (current) => {
          if (!current) return current;

          return {
            ...current,
            documents: current.documents.map((currentDocument) =>
              currentDocument.id === document.id ? document : currentDocument
            ),
          };
        }
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.document(document.id),
      });
      queryClient.setQueryData(queryKeys.document(document.id), document);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.case(caseId) });
    },
  });
}

export function useDocumentProgress(
  caseId: string,
  documentId: string,
  enabled: boolean
) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: queryKeys.document(documentId),
    queryFn: async () => {
      const { document } = await fetchJson<DocumentResponse>(
        `/api/documents/${documentId}`
      );

      queryClient.setQueryData<CaseResponse>(
        queryKeys.case(caseId),
        (current) => {
          if (!current) return current;

          return {
            ...current,
            documents: current.documents.map((currentDocument) =>
              currentDocument.id === document.id ? document : currentDocument
            ),
          };
        }
      );

      return document;
    },
    enabled,
    // Poll until the run reaches a terminal state. We can't key solely on
    // "extracting": the first poll often lands before the server has flipped the
    // status from "uploaded", and returning false there kills polling for good —
    // so the live steps never appear until a manual refresh.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "extracted" || status === "failed" || status === "canceled") {
        return false;
      }
      return 1000;
    },
  });
}
