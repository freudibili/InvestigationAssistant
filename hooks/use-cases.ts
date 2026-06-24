"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/fetcher";
import { queryKeys } from "@/lib/query-keys";
import {
  createCaseAction,
  deleteCaseAction,
  setCaseTypeAction,
} from "@/app/actions/cases";
import type { Case, CaseType } from "@/lib/types";
import type { CreateCaseInput } from "@/lib/validation";

export function useCases(initialData?: Case[]) {
  return useQuery({
    queryKey: queryKeys.cases,
    queryFn: async () => {
      const { cases } = await fetchJson<{ cases: Case[] }>("/api/cases");
      return cases;
    },
    initialData,
  });
}

export function useCreateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCaseInput) => createCaseAction(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cases });
    },
  });
}

export function useDeleteCase(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteCaseAction(caseId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.case(caseId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.cases });
    },
  });
}

/** Confirm or override a case's type (null = unclassify). */
export function useSetCaseType(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (caseType: CaseType | null) =>
      setCaseTypeAction(caseId, { caseType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.case(caseId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.cases });
    },
  });
}
