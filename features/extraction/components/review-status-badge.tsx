import {
  AlertTriangle,
  CheckCircle2,
  CircleX,
  Pencil,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ExtractionReviewStatus } from "@/lib/types";

const reviewStatusLabels: Record<ExtractionReviewStatus, string> = {
  ai_generated: "AI",
  edited: "Edited by investigator",
  needs_review: "Needs review",
  approved: "Approved",
  excluded: "Excluded",
};

export function ReviewStatusBadge({
  status,
}: {
  status: ExtractionReviewStatus;
}) {
  const Icon = reviewStatusIcons[status];

  return (
    <Badge
      variant={reviewStatusVariants[status]}
      className={
        status === "ai_generated"
          ? "border-transparent bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
          : undefined
      }
    >
      <Icon />
      {reviewStatusLabels[status]}
    </Badge>
  );
}

const reviewStatusIcons: Record<ExtractionReviewStatus, typeof Sparkles> = {
  ai_generated: Sparkles,
  edited: Pencil,
  needs_review: AlertTriangle,
  approved: CheckCircle2,
  excluded: CircleX,
};

const reviewStatusVariants: Record<
  ExtractionReviewStatus,
  "secondary" | "warning" | "success" | "outline"
> = {
  ai_generated: "secondary",
  edited: "secondary",
  needs_review: "warning",
  approved: "success",
  excluded: "outline",
};
