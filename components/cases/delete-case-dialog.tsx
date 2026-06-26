"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useDeleteCase } from "@/hooks/use-cases";

export function DeleteCaseDialog({
  caseId,
  caseTitle,
}: {
  caseId: string;
  caseTitle: string;
}) {
  const router = useRouter();
  const deleteCase = useDeleteCase(caseId);
  const [open, setOpen] = useState(false);

  async function handleDelete() {
    try {
      await deleteCase.mutateAsync();
      toast.success("Case deleted.");
      setOpen(false);
      router.push("/");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete case."
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm" className="self-start">
          <Trash2 />
          Delete case
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this case?</DialogTitle>
          <DialogDescription>
            {`"${caseTitle}" and all documents in the case will be permanently deleted.`}
          </DialogDescription>
        </DialogHeader>
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex gap-3 rounded-md border p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>This cannot be undone.</p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={deleteCase.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={deleteCase.isPending}
            onClick={() => void handleDelete()}
          >
            {deleteCase.isPending ? "Deleting..." : "Delete case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
