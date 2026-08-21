import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { CancelledCrawlStatus } from "@/lib/crawl-control-client";

interface Props {
  runId: string;
  size?: "sm" | "md";
  label?: string;
  /** Kept for API compatibility with callers. Not invoked in this build: stopping a crawl is a
   *  crawler-worker action, and that worker isn't part of this deployment (see below). */
  onCancelled?: (crawl: CancelledCrawlStatus) => void;
  className?: string;
}

const UNAVAILABLE_TOOLTIP = "Crawl control requires the crawler worker, which isn't part of this build.";

/**
 * Shared Stop control for the new-crawl progress panel and every Queue-screen row.
 *
 * Cancelling an in-flight crawl means signalling the crawler worker (`seo-crawler-poc`) to kill the
 * process — a separate, disk-based service that is NOT in this deployment (this app only READS
 * results Supabase already holds). Rather than let the user click Stop and hit an honest-but-scary
 * 501/404, we render the control DISABLED with a tooltip that explains why. When the worker is wired
 * in, restore the inline-confirm + `requestCancelCrawl` flow (see crawl-control-client.ts, which
 * still handles the 202/409/501/404 outcomes for that future path).
 */
export function StopCrawlControl({ size = "md", label = "Stop crawl", className }: Props) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Button type="button" size={size} variant="outline" disabled title={UNAVAILABLE_TOOLTIP} aria-label={UNAVAILABLE_TOOLTIP}>
        <Ban size={13} strokeWidth={2} aria-hidden="true" />
        {label}
      </Button>
    </div>
  );
}
