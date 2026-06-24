"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateCase } from "@/hooks/use-cases";
import { createCaseSchema } from "@/lib/validation";
import { CASE_TYPES, CASE_TYPE_LABELS, type CaseType } from "@/lib/types";

export function CreateCaseDialog() {
  const router = useRouter();
  const createCase = useCreateCase();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [caseType, setCaseType] = useState<CaseType | "">("");

  function reset() {
    setTitle("");
    setCompanyName("");
    setCaseType("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const parsed = createCaseSchema.safeParse({
      title,
      companyName,
      caseType: caseType || undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }

    try {
      const created = await createCase.mutateAsync(parsed.data);
      toast.success("Case created.");
      setOpen(false);
      reset();
      router.push(`/cases/${created.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create case."
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New Case
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create a new case</DialogTitle>
            <DialogDescription>
              Start an investigation workspace for interview transcripts.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Case title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Engineering team complaint"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Acme Corp"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="case-type">Case type (optional)</Label>
              <Select
                value={caseType}
                onValueChange={(v) => setCaseType(v as CaseType)}
              >
                <SelectTrigger id="case-type" className="w-full">
                  <SelectValue placeholder="Not sure yet" />
                </SelectTrigger>
                <SelectContent>
                  {CASE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {CASE_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Leave blank if unknown — the assistant will suggest a type once
                you extract a document.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={createCase.isPending}>
              {createCase.isPending ? "Creating…" : "Create case"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
