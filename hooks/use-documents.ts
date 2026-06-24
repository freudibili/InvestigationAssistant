"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  extractDocumentAction,
  uploadDocumentAction,
} from "@/app/actions/documents";

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
    onSuccess: (document) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.case(caseId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.document(document.id),
      });
    },
  });
}
