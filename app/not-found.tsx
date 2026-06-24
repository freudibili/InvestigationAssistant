import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-muted-foreground text-sm">
        The page or resource you’re looking for doesn’t exist.
      </p>
      <Button asChild>
        <Link href="/">Back to cases</Link>
      </Button>
    </div>
  );
}
