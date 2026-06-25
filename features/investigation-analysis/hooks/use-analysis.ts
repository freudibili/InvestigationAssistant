"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { fetchJson } from "@/lib/api/fetcher";
import type { AnalysisStatus } from "@/lib/types";
import { analyzeCaseAction } from "@/features/investigation-analysis/actions/analysis";
import type { InvestigationAnalysis } from "@/features/investigation-analysis/validation";

/** Client mirror of the server `CaseAnalysis` read (lib/db is server-only). */
export interface CaseAnalysisResponse {
  status: AnalysisStatus;
  generatedAt: string | null;
  analysis: InvestigationAnalysis | null;
}

export function useCaseAnalysis(
  caseId: string,
  initialData?: CaseAnalysisResponse
) {
  return useQuery({
    queryKey: queryKeys.analysis(caseId),
    queryFn: () =>
      fetchJson<CaseAnalysisResponse>(`/api/cases/${caseId}/analysis`),
    initialData,
    // Poll while the analysis is running so the dashboard appears on completion.
    refetchInterval: (query) =>
      query.state.data?.status === "analyzing" ? 2000 : false,
  });
}

export function useAnalyzeCase(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // The action returns failures instead of throwing (so the real message
      // survives in production); re-throw on the client for react-query.
      const result = await analyzeCaseAction(caseId);
      if (!result.ok) throw new Error(result.message);
      return result.analysis;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.analysis(caseId) });

      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => ({
          status: "analyzing",
          generatedAt: current?.generatedAt ?? null,
          analysis: current?.analysis ?? null,
        })
      );
    },
    onSuccess: (analysis) => {
      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        {
          status: "ready",
          generatedAt: analysis.generatedAt,
          analysis,
        }
      );
    },
    onError: () => {
      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => ({
          status: "failed",
          generatedAt: current?.generatedAt ?? null,
          analysis: current?.analysis ?? null,
        })
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.analysis(caseId) });
    },
  });
}
