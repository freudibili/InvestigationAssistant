"use client";

import Link from "next/link";
import { ArrowRight, Briefcase } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCases } from "@/hooks/use-cases";
import { CASE_TYPE_LABELS, type Case } from "@/lib/types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function CaseList({ initialCases }: { initialCases: Case[] }) {
  const { data: cases = [] } = useCases(initialCases);

  if (cases.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Briefcase className="text-muted-foreground size-8" />
          <p className="font-medium">No cases yet</p>
          <p className="text-muted-foreground text-sm">
            Create your first case to start uploading interview transcripts.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cases.map((c) => (
        <Link key={c.id} href={`/cases/${c.id}`} className="group">
          <Card className="h-full transition-colors group-hover:border-foreground/20">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline">{CASE_TYPE_LABELS[c.caseType]}</Badge>
                <ArrowRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
              </div>
              <CardTitle className="mt-2">{c.title}</CardTitle>
              <CardDescription>{c.companyName}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">
                Created {formatDate(c.createdAt)}
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
