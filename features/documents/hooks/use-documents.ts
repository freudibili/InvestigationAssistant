"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  deleteDocumentAction,
  setIntervieweeRoleAction,
  uploadDocumentAction,
} from "@/features/documents/actions/documents";
import type { Case, CaseDocument, IntervieweeRole } from "@/lib/types";

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

export function useSetIntervieweeRole(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      intervieweeRole,
    }: {
      documentId: string;
      intervieweeRole: IntervieweeRole;
    }) => setIntervieweeRoleAction(documentId, intervieweeRole),
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
