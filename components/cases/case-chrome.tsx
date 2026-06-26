"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CaseTypeControl } from "@/components/cases/case-type-control";
import { DeleteCaseDialog } from "@/components/cases/delete-case-dialog";
import { useCase } from "@/hooks/use-case";
import { cn } from "@/lib/utils";
import type { Case, CaseDocument } from "@/lib/types";

/**
 * Shared chrome for every case sub-page: a live header (case type, title,
 * delete) plus the case tab bar. Rendered once in the case layout so the tabs
 * stay independent route subtrees while sharing one header.
 */
export function CaseChrome({
  caseId,
  initialCase,
  initialDocuments,
  children,
}: {
  caseId: string;
  initialCase: Case;
  initialDocuments: CaseDocument[];
  children: React.ReactNode;
}) {
  const { data } = useCase(caseId, {
    case: initialCase,
    documents: initialDocuments,
  });
  const investigationCase = data?.case ?? initialCase;
  const pathname = usePathname();

  const tabs = [
    { href: `/cases/${caseId}/extraction`, label: "Extraction" },
    { href: `/cases/${caseId}/analysis`, label: "Investigation Analysis" },
    { href: `/cases/${caseId}/report`, label: "Report Draft" },
  ];

  function isActive(tab: { href: string; exact?: boolean }) {
    if (tab.exact) return pathname === tab.href;
    return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
  }

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        All cases
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CaseTypeControl investigationCase={investigationCase} />
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {investigationCase.title}
          </h1>
          <p className="text-muted-foreground text-sm">
            {investigationCase.companyName}
          </p>
        </div>
        <DeleteCaseDialog caseId={caseId} caseTitle={investigationCase.title} />
      </div>

      <nav className="border-b">
        <ul className="-mb-px flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={cn(
                  "inline-flex items-center border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  isActive(tab)
                    ? "border-foreground text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                )}
              >
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div>{children}</div>
    </div>
  );
}
