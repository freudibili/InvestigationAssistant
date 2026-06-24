"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useUploadDocument } from "@/hooks/use-documents";

export function UploadDocument({ caseId }: { caseId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadDocument(caseId);
  const [dragging, setDragging] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const pdfs = Array.from(files).filter(
      (f) => f.type === "application/pdf"
    );
    if (pdfs.length === 0) {
      toast.error("Please select PDF files.");
      return;
    }

    // Upload sequentially so each gets its text extracted reliably.
    for (const file of pdfs) {
      try {
        await upload.mutateAsync(file);
        toast.success(`Uploaded ${file.name}`);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? `${file.name}: ${error.message}`
            : `Could not upload ${file.name}`
        );
      }
    }

    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center transition-colors ${
        dragging ? "border-foreground/40 bg-accent/50" : ""
      }`}
    >
      <Upload className="text-muted-foreground size-6" />
      <div>
        <p className="text-sm font-medium">Upload interview transcripts</p>
        <p className="text-muted-foreground text-xs">
          Drop PDF files here, or browse. Text is extracted automatically.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={upload.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {upload.isPending ? "Uploading…" : "Browse files"}
      </Button>
    </div>
  );
}
