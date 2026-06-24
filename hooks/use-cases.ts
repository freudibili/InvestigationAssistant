"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/fetcher";
import { queryKeys } from "@/lib/query-keys";
import { createCaseAction } from "@/app/actions/cases";
import type { Case } from "@/lib/types";
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
