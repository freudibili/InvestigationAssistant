import { Badge } from "@/components/ui/badge";
import { CheckCircle2, FileText, Loader2, StopCircle, XCircle } from "lucide-react";
import type { DocumentStatus } from "@/lib/types";
import type { ComponentProps } from "react";

const CONFIG: Record<
  DocumentStatus,
  {
    label: string;
    variant: ComponentProps<typeof Badge>["variant"];
    icon: typeof FileText;
    spin?: boolean;
  }
> = {
  uploaded: { label: "Uploaded", variant: "secondary", icon: FileText },
  extracting: {
    label: "Extracting…",
    variant: "warning",
    icon: Loader2,
    spin: true,
  },
  extracted: { label: "Extracted", variant: "success", icon: CheckCircle2 },
  canceled: { label: "Canceled", variant: "secondary", icon: StopCircle },
  failed: { label: "Failed", variant: "destructive", icon: XCircle },
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const { label, variant, icon: Icon, spin } = CONFIG[status];
  return (
    <Badge variant={variant}>
      <Icon className={spin ? "animate-spin" : undefined} />
      {label}
    </Badge>
  );
}
