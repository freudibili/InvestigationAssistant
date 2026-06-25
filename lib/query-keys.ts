export const queryKeys = {
  cases: ["cases"] as const,
  case: (caseId: string) => ["cases", caseId] as const,
  analysis: (caseId: string) => ["cases", caseId, "analysis"] as const,
  document: (documentId: string) => ["documents", documentId] as const,
};
