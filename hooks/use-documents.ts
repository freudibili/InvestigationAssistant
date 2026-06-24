"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  extractDocumentAction,
  uploadDocumentAction,
} from "@/app/actions/documents";
import type { Case, CaseDocument } from "@/lib/types";

interface CaseResponse {
  case: Case;
  documents: CaseDocument[];
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
    },
  });
}
