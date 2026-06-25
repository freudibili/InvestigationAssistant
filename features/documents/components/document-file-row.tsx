"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/documents/status-badge";
import { useDeleteDocument } from "@/features/documents/hooks/use-documents";
import type { CaseDocument } from "@/lib/types";

/**
 * A single uploaded file in the Documents tab: name, status, and delete. File
 * management only — running AI extraction lives in the Extraction tab.
 */
export function DocumentFileRow({ document }: { document: CaseDocument }) {
  const remove = useDeleteDocument(document.caseId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isExtracting = document.status === "extracting";

  async function handleDelete() {
    try {
      await remove.mutateAsync(document.id);
      setConfirmOpen(false);
      toast.success("Document deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete document."
      );
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
      <div className="flex min-w-0 items-center gap-3">
        <FileText className="text-muted-foreground size-5 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{document.fileName}</p>
          <div className="mt-1">
            <StatusBadge status={document.status} />
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {document.status === "extracted" ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/cases/${document.caseId}/extraction/${document.id}`}>
              View Result
            </Link>
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={isExtracting || remove.isPending}
          aria-label="Delete document"
        >
          <Trash2 />
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document</DialogTitle>
            <DialogDescription>
              {`"${document.fileName}" and its extracted data will be permanently deleted. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={remove.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
