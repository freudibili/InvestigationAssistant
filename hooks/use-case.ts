"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/fetcher";
import { queryKeys } from "@/lib/query-keys";
import type { Case, CaseDocument } from "@/lib/types";

interface CaseResponse {
  case: Case;
  documents: CaseDocument[];
}

export function useCase(caseId: string, initialData?: CaseResponse) {
  return useQuery({
    queryKey: queryKeys.case(caseId),
    queryFn: () => fetchJson<CaseResponse>(`/api/cases/${caseId}`),
    initialData,
    // Poll while any document is mid-extraction so the UI updates on completion.
    refetchInterval: (query) => {
      const docs = query.state.data?.documents ?? [];
      return docs.some((d) => d.status === "extracting") ? 2500 : false;
    },
  });
}
