"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  Eye,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Repeat,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  useCaseAnalysis,
  type CaseAnalysisResponse,
} from "@/features/investigation-analysis/hooks/use-analysis";
import type { InvestigationAnalysis } from "@/features/investigation-analysis/types";
import {
  deleteEditedReportDraftAction,
  generateReportDraftAction,
  saveEditedReportDraftAction,
} from "@/features/report-generation/actions/report";
import type {
  ReportLanguage,
  ReportDraft,
  ReportSection,
  reportCoherenceIssueSchema,
} from "@/features/report-generation/validation";

const reportGenerationSteps = [
  {
    title: "Build framework sections",
    description: "Create sections 1 to 4 from case metadata, documents, and reusable text.",
  },
  {
    title: "Format allegations",
    description: "Place dashboard allegations into section 5 without rewriting them.",
  },
  {
    title: "Format global assessment",
    description: "Place the global assessment into section 6.",
  },
  {
    title: "Remove dashboard-only content",
    description: "Strip badges, percentages, calculator labels, and UI-only text.",
  },
  {
    title: "Check draft",
    description: "Verify no dashboard-only content remains before saving.",
  },
  {
    title: "Save draft",
    description: "Store the editable draft on the case.",
  },
];

const reportGenerationStaleAfterMs = 10 * 60 * 1000;
type ReportDraftView = "edit" | "preview";

export function ReportDraftCard({
  caseId,
  analysis,
}: {
  caseId: string;
  analysis: InvestigationAnalysis;
}) {
  const [editedDraftText, setEditedDraftText] = useState(
    analysis.reportDraft?.editedContent ??
      analysis.reportDraft?.generatedContent ??
      ""
  );
  const [editableSections, setEditableSections] = useState<ReportSection[]>(
    analysis.reportDraft?.sections ?? []
  );
  const [draftView, setDraftView] = useState<ReportDraftView>("edit");
  const [issues, setIssues] = useState<
    z.infer<typeof reportCoherenceIssueSchema>[]
  >([]);
  const [reportLanguage, setReportLanguage] = useState<ReportLanguage>("en");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingEdit, setIsDeletingEdit] = useState(false);
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data } = useCaseAnalysis(caseId, {
    status: "ready",
    generatedAt: analysis.generatedAt,
    analysis,
  });
  const liveAnalysis = data?.analysis ?? analysis;
  const reportDraft = liveAnalysis.reportDraft;
  const reportGeneration = liveAnalysis.reportGeneration;
  const isPersistedGenerationRunning =
    reportGeneration.status === "generating" &&
    !isStaleReportGeneration(reportGeneration.updatedAt);
  const isGenerationRunning = isGenerating || isPersistedGenerationRunning;
  const stepStatus = toStepStatus(reportGeneration.status, isGenerationRunning);
  const activeStepIndex = isGenerationRunning
    ? isPersistedGenerationRunning
      ? reportGeneration.currentStepIndex
      : 0
    : reportGeneration.status === "complete"
      ? reportGenerationSteps.length - 1
      : -1;
  const savedEditedDraftText = reportDraft?.editedContent ?? "";
  const savedSections = reportDraft?.sections ?? [];
  const hasSectionDraft = editableSections.length > 0;
  const hasEditedDraft = Boolean(reportDraft?.editedContent);
  const usesSectionEditor =
    hasSectionDraft && (!hasEditedDraft || hasSectionEdits(editableSections));
  const hasUnsavedEdits =
    Boolean(reportDraft) &&
    (usesSectionEditor
      ? JSON.stringify(editableSections) !== JSON.stringify(savedSections)
      : editedDraftText !== savedEditedDraftText);

  function handleRequestGenerateReport() {
    if (hasUnsavedEdits) {
      setIsRegenerateDialogOpen(true);
      return;
    }

    void handleGenerateReport();
  }

  async function handleGenerateReport() {
    setIsRegenerateDialogOpen(false);
    setIssues([]);
    setIsGenerating(true);
    queryClient.setQueryData<CaseAnalysisResponse>(
      queryKeys.analysis(caseId),
      (current) => {
        const currentAnalysis = current?.analysis ?? liveAnalysis;

        return {
          status: current?.status ?? "ready",
          generatedAt: current?.generatedAt ?? liveAnalysis.generatedAt,
          analysis: {
            ...currentAnalysis,
            reportDraft: currentAnalysis.reportDraft
              ? {
                  ...currentAnalysis.reportDraft,
                  generatedContent: "",
                  sections: [],
                }
              : currentAnalysis.reportDraft,
            reportGeneration: {
              status: "generating",
              runId: null,
              currentStep: reportGenerationSteps[0]?.title ?? "Build framework sections",
              currentStepIndex: 0,
              totalSteps: reportGenerationSteps.length,
              errorMessage: null,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      }
    );

    try {
      const result = await generateReportDraftAction(caseId, reportLanguage);

      if (!result.ok) {
        setIssues(result.issues);
        toast.error(result.message);
        return;
      }

      setEditedDraftText(
        result.analysis.reportDraft?.editedContent ??
          result.reportDraft.generatedContent
      );
      setEditableSections(
        result.analysis.reportDraft?.sections ?? result.reportDraft.sections
      );
      setDraftView("edit");
      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => ({
          status: current?.status ?? "ready",
          generatedAt: current?.generatedAt ?? result.analysis.generatedAt,
          analysis: result.analysis,
        })
      );
      toast.success("Report draft generated.");
    } finally {
      setIsGenerating(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.analysis(caseId) });
    }
  }

  async function handleSaveEditedDraft() {
    if (!reportDraft) return;

    setIsSavingEdit(true);
    try {
      const result = await saveEditedReportDraftAction(
        caseId,
        usesSectionEditor ? editableSections : editedDraftText
      );

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => ({
          status: current?.status ?? "ready",
          generatedAt: current?.generatedAt ?? result.analysis.generatedAt,
          analysis: result.analysis,
        })
      );
      setEditedDraftText(
        result.analysis.reportDraft?.editedContent ?? editedDraftText
      );
      setEditableSections(result.analysis.reportDraft?.sections ?? editableSections);
      setDraftView("preview");
      toast.success("Edited report draft saved.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDeleteEditedDraft() {
    if (!reportDraft?.editedContent) return;

    setIsDeletingEdit(true);
    try {
      const result = await deleteEditedReportDraftAction(caseId);

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      queryClient.setQueryData<CaseAnalysisResponse>(
        queryKeys.analysis(caseId),
        (current) => ({
          status: current?.status ?? "ready",
          generatedAt: current?.generatedAt ?? result.analysis.generatedAt,
          analysis: result.analysis,
        })
      );
      setEditedDraftText(result.analysis.reportDraft?.generatedContent ?? "");
      setEditableSections(result.analysis.reportDraft?.sections ?? []);
      setDraftView("edit");
      toast.success("Edited report draft deleted.");
    } finally {
      setIsDeletingEdit(false);
    }
  }

  const draftContent = reportDraft ? (
    draftView === "preview" && usesSectionEditor ? (
      <ReportSectionPreview sections={editableSections} />
    ) : draftView === "preview" ? (
      <ReportTextPreview content={editedDraftText} />
    ) : usesSectionEditor ? (
      <ReportEditFrame>
        <ReportSectionDocumentEditor
          sections={editableSections}
          onChange={setEditableSections}
        />
      </ReportEditFrame>
    ) : (
      <ReportEditFrame>
        <textarea
          className="border-input bg-background ring-offset-background min-h-[520px] w-full resize-y rounded-md border px-3 py-2 font-mono text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={editedDraftText}
          onChange={(event) => {
            setEditedDraftText(event.target.value);
          }}
          placeholder="Edit the report draft here."
        />
      </ReportEditFrame>
    )
  ) : (
    <Empty>No draft report generated.</Empty>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ReportDraftMeta reportDraft={reportDraft} />
            <div className="flex flex-wrap gap-2">
              <select
                className="border-input bg-background h-8 rounded-md border px-2 text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                value={reportLanguage}
                onChange={(event) =>
                  setReportLanguage(event.target.value as ReportLanguage)
                }
                disabled={isGenerationRunning || isSavingEdit || isDeletingEdit}
                aria-label="Report language"
              >
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="de">German</option>
              </select>
              {reportDraft ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleSaveEditedDraft}
                  disabled={
                    !hasUnsavedEdits ||
                    isSavingEdit ||
                    isDeletingEdit ||
                    isGenerationRunning
                  }
                >
                  {isSavingEdit ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Save />
                  )}
                  {isSavingEdit ? "Saving..." : "Save edits"}
                </Button>
              ) : null}
              {hasEditedDraft ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={handleDeleteEditedDraft}
                  disabled={isDeletingEdit || isSavingEdit || isGenerationRunning}
                >
                  {isDeletingEdit ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
                  {isDeletingEdit ? "Deleting..." : "Delete edits"}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                onClick={handleRequestGenerateReport}
                disabled={
                  isGenerationRunning ||
                  isDeletingEdit ||
                  isSavingEdit ||
                  liveAnalysis.reproches.length === 0
                }
                title={
                  liveAnalysis.reproches.length === 0
                    ? "No reproaches are available for report generation."
                    : undefined
                }
              >
                {isGenerationRunning ? (
                  <Loader2 className="animate-spin" />
                ) : reportDraft ? (
                  <Repeat />
                ) : (
                  <Sparkles />
                )}
                {isGenerationRunning
                  ? "Generating..."
                  : reportDraft
                    ? "Regenerate draft"
                    : "Generate draft"}
              </Button>
            </div>
          </div>

          {liveAnalysis.reproches.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
              No reproaches are available for report generation.
            </p>
          ) : null}

          <ReportGenerationSteps
            activeStepIndex={activeStepIndex}
            hasReportDraft={Boolean(reportDraft)}
            status={stepStatus}
          />

          {issues.length > 0 ? <CoherenceIssues issues={issues} /> : null}

          {reportGeneration.status === "failed" && reportGeneration.errorMessage ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {reportGeneration.errorMessage}
            </p>
          ) : null}

          {reportDraft ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={draftView === "edit" ? "secondary" : "outline"}
                onClick={() => setDraftView("edit")}
              >
                <Pencil />
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant={draftView === "preview" ? "secondary" : "outline"}
                onClick={() => setDraftView("preview")}
              >
                <Eye />
                Preview
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {draftContent}

      <RegenerateReportDialog
        open={isRegenerateDialogOpen}
        onOpenChange={setIsRegenerateDialogOpen}
        onConfirm={handleGenerateReport}
        isGenerating={isGenerationRunning}
      />
    </div>
  );
}

function ReportEditFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background p-4 shadow-xs md:p-6">
      {children}
    </div>
  );
}

function RegenerateReportDialog({
  open,
  onOpenChange,
  onConfirm,
  isGenerating,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isGenerating: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate AI sections?</DialogTitle>
          <DialogDescription>
            Sections marked AI will be refreshed from the case analysis and
            global assessment. Saved manual and custom sections are kept.
            Unsaved edits will be discarded.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={isGenerating}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={onConfirm} disabled={isGenerating}>
            {isGenerating ? <Loader2 className="animate-spin" /> : <Repeat />}
            {isGenerating ? "Regenerating..." : "Regenerate AI sections"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportSectionPreview({ sections }: { sections: ReportSection[] }) {
  const sectionPageNumbers = getReportSectionPageNumbers(sections);
  const tableOfContents = flattenReportSections(sections).map((section) => ({
    ...section,
    pageNumber: sectionPageNumbers.get(section.id) ?? 1,
  }));
  const sideNavigationSections = tableOfContents.filter(
    (section) => section.depth <= 1
  );

  return (
    <div className="relative">
      <aside className="mb-4 lg:absolute lg:inset-y-0 lg:right-full lg:mr-5 lg:mb-0 lg:w-44">
        <ol className="max-h-[calc(100vh-2rem)] space-y-1.5 overflow-y-auto pr-1 text-xs lg:sticky lg:top-4">
          {sideNavigationSections.map((section) => (
            <li
              key={section.id}
              className={cn("min-w-0", section.depth > 0 && "pl-3")}
            >
              <a
                className="block truncate text-muted-foreground transition-colors hover:text-foreground"
                href={`#${section.id}`}
                title={`${section.number} ${section.title}`}
              >
                <span className="font-medium text-foreground">{section.number}</span>{" "}
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </aside>
      <article className="w-full space-y-6">
        <ReportDocumentPage pageNumber={1}>
          <ReportDocumentTableOfContents sections={tableOfContents} />
        </ReportDocumentPage>
        {sections.map((section, index) => (
          <ReportDocumentPage key={section.id} pageNumber={index + 2}>
            <ReportSectionPreviewBlock
              section={section}
              depth={0}
            />
          </ReportDocumentPage>
        ))}
      </article>
    </div>
  );
}

function ReportDocumentPage({
  children,
  pageNumber,
}: {
  children: React.ReactNode;
  pageNumber: number;
}) {
  return (
    <section className="min-h-[960px] rounded-md border bg-background px-6 py-7 shadow-xs md:px-10">
      <div className="mx-auto flex min-h-[904px] max-w-3xl flex-col">
        <div className="flex-1 space-y-8">{children}</div>
        <footer className="pt-8 text-center text-xs text-muted-foreground">
          {pageNumber}
        </footer>
      </div>
    </section>
  );
}

function ReportDocumentTableOfContents({
  sections,
}: {
  sections: Array<ReportSection & { depth: number; pageNumber: number }>;
}) {
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold tracking-normal">Table of contents</h2>
      </div>
      <ol className="space-y-1.5 text-sm leading-6">
        {sections.map((section) => (
          <li
            key={section.id}
            className={cn(
              "flex items-baseline gap-2 text-sm",
              section.depth === 1 && "pl-6",
              section.depth > 1 && "pl-12"
            )}
          >
            <span className="min-w-0 text-foreground">
              {section.number} {section.title}
            </span>
            <span className="min-w-4 flex-1 border-b border-dotted border-muted-foreground/50" />
            <span className="shrink-0 text-foreground">
              {section.pageNumber}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReportSectionPreviewBlock({
  section,
  depth,
}: {
  section: ReportSection;
  depth: number;
}) {
  const content = reportSectionContent(section);

  return (
    <section id={section.id} className={cn(depth === 0 ? "space-y-3" : "space-y-2")}>
      {depth === 0 ? (
        <h2 className="border-b pb-2 text-xl font-semibold tracking-normal">
          {section.number} {section.title}
        </h2>
      ) : (
        <h3 className="text-base font-semibold tracking-normal">
          {section.number} {section.title}
        </h3>
      )}
      {content ? <ReportPreviewText content={content} /> : null}
      {section.children && section.children.length > 0 ? (
        <div className={cn("space-y-5", depth === 0 && "pt-2")}>
          {section.children.map((child) => (
            <ReportSectionPreviewBlock
              key={child.id}
              section={child}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ReportTextPreview({ content }: { content: string }) {
  return (
    <article className="rounded-md border bg-background px-6 py-7 shadow-xs md:px-10">
      <div className="mx-auto max-w-3xl">
        <ReportPreviewText content={content} />
      </div>
    </article>
  );
}

function ReportPreviewText({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-sm leading-7 text-foreground">
      {content
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index} className="whitespace-pre-line">
            {paragraph}
          </p>
        ))}
    </div>
  );
}

function flattenReportSections(
  sections: ReportSection[],
  depth = 0
): Array<ReportSection & { depth: number }> {
  return sections.flatMap((section) => [
    { ...section, depth },
    ...flattenReportSections(section.children ?? [], depth + 1),
  ]);
}

function getReportSectionPageNumbers(sections: ReportSection[]): Map<string, number> {
  const pageNumbers = new Map<string, number>();

  sections.forEach((section, index) => {
    setReportSectionPageNumbers(section, index + 2, pageNumbers);
  });

  return pageNumbers;
}

function setReportSectionPageNumbers(
  section: ReportSection,
  pageNumber: number,
  pageNumbers: Map<string, number>
) {
  pageNumbers.set(section.id, pageNumber);

  for (const child of section.children ?? []) {
    setReportSectionPageNumbers(child, pageNumber, pageNumbers);
  }
}

function reportSectionContent(section: ReportSection): string {
  return (section.editedContent ?? section.content).trim();
}

function ReportSectionDocumentEditor({
  sections,
  onChange,
}: {
  sections: ReportSection[];
  onChange: (sections: ReportSection[]) => void;
}) {
  return (
    <div className="space-y-1">
      {sections.map((section) => (
        <ReportSectionEditor
          key={section.id}
          section={section}
          depth={0}
          onChange={(nextSection) =>
            onChange(
              sections.map((current) =>
                current.id === section.id ? nextSection : current
              )
            )
          }
        />
      ))}
    </div>
  );
}

function ReportSectionEditor({
  section,
  depth,
  onChange,
}: {
  section: ReportSection;
  depth: number;
  onChange: (section: ReportSection) => void;
}) {
  const content = section.editedContent ?? section.content;

  function handleChildChange(nextChild: ReportSection) {
    onChange({
      ...section,
      children: (section.children ?? []).map((child) =>
        child.id === nextChild.id ? nextChild : child
      ),
    });
  }

  function handleAddSubsection() {
    const children = section.children ?? [];
    onChange({
      ...section,
      children: [...children, createCustomSection(section, children.length + 1)],
    });
  }

  return (
    <section
      className={cn(
        "space-y-3 border-t py-5",
        depth > 0 && "ml-4 border-l pl-4"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {section.type === "custom" ? (
            <>
              <span className="text-sm font-medium">{section.number}</span>
              <input
                className="border-input bg-background ring-offset-background h-8 min-w-56 rounded-md border px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={section.title}
                onChange={(event) =>
                  onChange({ ...section, title: event.target.value })
                }
                aria-label={`Title for section ${section.number}`}
              />
            </>
          ) : (
            <h3
              className={cn(
                "font-medium leading-snug",
                depth === 0 ? "text-base" : "text-sm"
              )}
            >
              {section.number} {section.title}
            </h3>
          )}
          <SectionSourceBadge section={section} />
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={handleAddSubsection}>
          <Plus />
          Add subsection
        </Button>
      </div>
      <textarea
        className="border-input bg-background ring-offset-background w-full resize-none overflow-hidden rounded-md border px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        rows={sectionTextAreaRows(content)}
        value={content}
        onChange={(event) =>
          onChange({ ...section, editedContent: event.target.value })
        }
        placeholder={section.placeholder ?? "Write section content."}
      />
      {section.children && section.children.length > 0 ? (
        <div className="space-y-1">
          {section.children.map((child) => (
            <ReportSectionEditor
              key={child.id}
              section={child}
              depth={depth + 1}
              onChange={handleChildChange}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function isStaleReportGeneration(updatedAt: string | null): boolean {
  if (!updatedAt) return true;

  const updatedTime = Date.parse(updatedAt);
  if (Number.isNaN(updatedTime)) return true;

  return Date.now() - updatedTime > reportGenerationStaleAfterMs;
}

function toStepStatus(
  status: InvestigationAnalysis["reportGeneration"]["status"],
  isGenerationRunning: boolean
): "idle" | "running" | "complete" | "error" {
  if (isGenerationRunning) return "running";
  if (status === "complete") return "complete";
  if (status === "failed") return "error";
  return "idle";
}

function createCustomSection(
  parent: ReportSection,
  childIndex: number
): ReportSection {
  const number = `${parent.number}.${childIndex}`;

  return {
    id: `${number}-custom-${crypto.randomUUID()}`,
    number,
    title: "Custom subsection",
    type: "custom",
    content: "",
    editedContent: "",
    children: [],
  };
}

function sectionTextAreaRows(content: string): number {
  const rows = content.split("\n").reduce((total, line) => {
    return total + Math.max(1, Math.ceil(line.length / 110));
  }, 0);

  return Math.max(2, rows + 1);
}

function hasSectionEdits(sections: ReportSection[]): boolean {
  return sections.some(
    (section) =>
      section.type === "custom" ||
      typeof section.editedContent === "string" ||
      hasSectionEdits(section.children ?? [])
  );
}

function SectionSourceBadge({ section }: { section: ReportSection }) {
  if (section.type === "manual") return null;

  if (section.type === "generated") {
    return (
      <Badge
        variant="secondary"
        className="border-transparent bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
      >
        <Sparkles />
        AI
      </Badge>
    );
  }

  return (
    <Badge variant="outline">Custom</Badge>
  );
}

function ReportGenerationSteps({
  activeStepIndex,
  hasReportDraft,
  status,
}: {
  activeStepIndex: number;
  hasReportDraft: boolean;
  status: "idle" | "running" | "complete" | "error";
}) {
  const progress =
    status === "complete" || (hasReportDraft && status === "idle")
      ? 100
      : status === "running"
        ? Math.round(((activeStepIndex + 1) / reportGenerationSteps.length) * 100)
        : 0;
  const activeStep =
    activeStepIndex >= 0 ? reportGenerationSteps[activeStepIndex] : null;

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Report generation steps</h3>
      </div>

      {status === "running" || status === "complete" || hasReportDraft ? (
        <div className="mb-4 space-y-2">
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${Math.min(Math.max(progress, 8), 100)}%` }}
            />
          </div>
          <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
            <span className="truncate">
              {status === "running"
                ? activeStep?.title
                : hasReportDraft
                  ? "Report draft ready"
                  : "Ready to generate"}
            </span>
            {status === "running" ? (
              <span className="shrink-0 tabular-nums">
                {activeStepIndex + 1}/{reportGenerationSteps.length}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <ol className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {reportGenerationSteps.map((step, index) => {
          const isComplete =
            status === "complete" ||
            (hasReportDraft && status !== "running" && status !== "error") ||
            (status === "running" && index < activeStepIndex);
          const isActive = status === "running" && index === activeStepIndex;
          const isError = status === "error" && index === activeStepIndex;
          const StepIcon = isComplete ? CheckCircle2 : isActive ? Loader2 : Circle;

          return (
            <li
              key={step.title}
              className={cn(
                "flex min-h-28 flex-col gap-2 rounded-md border p-3 text-sm",
                isActive && "border-primary bg-primary/5",
                isComplete && "border-emerald-600/40 bg-emerald-50 text-emerald-950",
                isError && "border-destructive/50 bg-destructive/5"
              )}
            >
              <div className="flex items-center gap-2">
                <StepIcon
                  className={cn(
                    "size-4 shrink-0",
                    isActive && "animate-spin text-primary",
                    isComplete && "text-emerald-600",
                    isError && "text-destructive"
                  )}
                />
                <span className="font-medium leading-snug">{step.title}</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                {step.description}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ReportDraftMeta({ reportDraft }: { reportDraft: ReportDraft | null }) {
  if (!reportDraft) {
    return (
      <p className="text-muted-foreground text-sm">
        The draft will be saved after a coherent final check.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">Report draft</Badge>
      {reportDraft.editedContent ? <Badge variant="secondary">Edits saved</Badge> : null}
      <Badge variant="success">Coherent</Badge>
      <span className="text-muted-foreground text-xs">
        Generated {formatGeneratedAt(reportDraft.generatedAt)}
      </span>
    </div>
  );
}

// Fixed locale + format so server and client render identically (no hydration
// mismatch) regardless of the host/browser locale.
const generatedAtFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatGeneratedAt(generatedAt: string) {
  return generatedAtFormatter.format(new Date(generatedAt));
}

function CoherenceIssues({
  issues,
}: {
  issues: z.infer<typeof reportCoherenceIssueSchema>[];
}) {
  return (
    <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-sm font-medium">Coherence check issues</p>
      <div className="space-y-3">
        {issues.map((issue, index) => (
          <div key={index} className="space-y-1 text-sm">
            <p className="font-medium">{issue.subject}</p>
            <p>
              <span className="text-muted-foreground">Version A:</span>{" "}
              {issue.versionA}
            </p>
            <p>
              <span className="text-muted-foreground">Version B:</span>{" "}
              {issue.versionB}
            </p>
            <p>
              <span className="text-muted-foreground">Recommendation:</span>{" "}
              {issue.recommendation}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
      {children}
    </p>
  );
}
