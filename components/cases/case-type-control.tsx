"use client";

import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSetCaseType } from "@/hooks/use-cases";
import {
  CASE_TYPES,
  CASE_TYPE_LABELS,
  UNCLASSIFIED_LABEL,
  type Case,
  type CaseType,
} from "@/lib/types";

/**
 * Shows the case type and lets the investigator set, confirm, or override it.
 * Three states:
 *  - unclassified: prompt to pick a type (or wait for an AI suggestion)
 *  - suggested:    AI guess shown with a Confirm action
 *  - confirmed:    the type, with the option to change it
 */
export function CaseTypeControl({ investigationCase }: { investigationCase: Case }) {
  const setCaseType = useSetCaseType(investigationCase.id);
  const { caseType, caseTypeSource } = investigationCase;

  async function apply(next: CaseType | null) {
    try {
      await setCaseType.mutateAsync(next);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update case type."
      );
    }
  }

  const picker = (
    <Select
      value={caseType ?? ""}
      onValueChange={(v) => apply(v as CaseType)}
      disabled={setCaseType.isPending}
    >
      <SelectTrigger size="sm" className="w-[180px]">
        <SelectValue placeholder="Set case type" />
      </SelectTrigger>
      <SelectContent>
        {CASE_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            {CASE_TYPE_LABELS[type]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (!caseType) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-muted-foreground">
          {UNCLASSIFIED_LABEL}
        </Badge>
        {picker}
      </div>
    );
  }

  if (caseTypeSource === "suggested") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <Sparkles className="size-3" />
          Suggested: {CASE_TYPE_LABELS[caseType]}
        </Badge>
        <Button
          size="sm"
          variant="outline"
          onClick={() => apply(caseType)}
          disabled={setCaseType.isPending}
        >
          <Check />
          Confirm
        </Button>
        {picker}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">{CASE_TYPE_LABELS[caseType]}</Badge>
      {picker}
    </div>
  );
}
