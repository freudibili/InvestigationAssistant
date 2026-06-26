"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { fetchJson } from "@/lib/api/fetcher";
import type { AnalysisStatus } from "@/lib/types";
import {
  analyzeCaseAction,
  cancelAnalysisAction,
} from "@/features/investigation-analysis/actions/analysis";
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
    staleTime: initialData?.status === "ready" ? Infinity : 0,
    refetchOnMount: (query) => query.state.data?.status === "analyzing",
    refetchOnWindowFocus: false,
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
      if (!result.ok) {
        const error = new Error(result.message);
        if (result.canceled) error.name = "AnalysisCanceledError";
        throw error;
      }
      return result.analysis;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.analysis(caseId) });
      const previousAnalysisState =
        queryClient.getQueryData<CaseAnalysisResponse>(queryKeys.analysis(caseId));

      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        () => ({
          status: "analyzing",
          generatedAt: null,
          analysis: null,
        })
      );

      return { previousAnalysisState };
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
    onError: (error, _variables, context) => {
      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => {
          if (
            current?.status === "analyzing" &&
            error instanceof Error &&
            error.name === "AnalysisCanceledError"
          ) {
            return current;
          }

          const status =
            current?.status === "canceled" ||
            (error instanceof Error && error.name === "AnalysisCanceledError")
              ? "canceled"
              : "failed";

          return {
            status,
            generatedAt:
              context?.previousAnalysisState?.generatedAt ??
              current?.generatedAt ??
              null,
            analysis:
              context?.previousAnalysisState?.analysis ??
              current?.analysis ??
              null,
          };
        }
      );
    },
    onSettled: (_data, error) => {
      if (error) {
        queryClient.invalidateQueries({ queryKey: queryKeys.analysis(caseId) });
      }
    },
  });
}

export function useCancelAnalysis(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => cancelAnalysisAction(caseId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.analysis(caseId) });

      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => ({
          status: "canceled",
          generatedAt: current?.generatedAt ?? null,
          analysis: current?.analysis ?? null,
        })
      );
    },
    onSuccess: (state) => {
      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => ({
          status: state.status,
          generatedAt: state.generatedAt,
          analysis: current?.analysis ?? null,
        })
      );
    },
    onSettled: (_data, error) => {
      if (error) {
        queryClient.invalidateQueries({ queryKey: queryKeys.analysis(caseId) });
      }
    },
  });
}
