"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchJson } from "@/lib/api/fetcher";
import {
  cancelExtractionAction,
  deleteDocumentAction,
  extractDocumentAction,
  uploadDocumentAction,
} from "@/app/actions/documents";
import type { Case, CaseDocument } from "@/lib/types";

interface CaseResponse {
  case: Case;
  documents: CaseDocument[];
}

interface DocumentResponse {
  document: CaseDocument;
}

export function useUploadDocument(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("caseId", caseId);
      formData.append("file", file);
      return uploadDocumentAction(formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.case(caseId) });
    },
  });
}

export function useDeleteDocument(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => deleteDocumentAction(documentId),
    onMutate: async (documentId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.case(caseId) });
      queryClient.setQueryData<CaseResponse>(
        queryKeys.case(caseId),
        (current) => {
          if (!current) return current;

          return {
            ...current,
            documents: current.documents.filter(
              (document) => document.id !== documentId
            ),
          };
        }
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.case(caseId) });
    },
  });
}

export function useExtractDocument(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => extractDocumentAction(documentId),
    onMutate: async (documentId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.case(caseId) });

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
                    status: "extracting",
                    extractionCurrentStep: 0,
                    extractionTotalSteps: 0,
                    extractionStep: "Preparing document",
                  }
                : document
            ),
          };
        }
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
    refetchInterval: (query) =>
      query.state.data?.status === "extracting" ? 1000 : false,
  });
}
