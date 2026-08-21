import { Link } from "react-router-dom";
import type { CrawledPageWithId, CrawlSummary } from "@/lib/types";
import { buildStatusCounts } from "@/lib/data-overview";
import { cn } from "@/lib/cn";

/** `report.statusHistogram` counts pages ∪ failures (including failures that never became a page
 *  record, e.g. a request blocked after retries) — a broader population than /pages can ever
 *  render, so chips built from it could show a count their own destination can't reproduce.
 *
 *  /pages itself (lib/data-explorer.ts's buildExplorerRows) is its own explorer, not the plain
 *  page list lib/data-pages.ts backs for the JSON API — it renders ONE ROW PER page + ONE ROW PER
 *  failure + ONE ROW PER blocked URL, undeduplicated (a page that failed with a 4xx shows up
 *  twice: once bucketed "4xx" from its page record, once bucketed "failed" from its failure
 *  record). "All pages" (no status filter) must match that same total, not just pages.length —
 *  every status-bucketed chip (2xx/3xx/4xx/5xx) is still `pages`-only and safe, because only a
 *  page record ever gets bucketed into one of those four; failures always bucket "failed" and
 *  blocked URLs always bucket "blocked", so they can never leak into a 2xx–5xx filter's rows. */
export function FilterChips({
  report,
  runId,
  pages,
  failureCount,
  blockedCount,
}: {
  report: CrawlSummary;
  runId: string;
  pages: CrawledPageWithId[];
  failureCount: number;
  blockedCount: number;
}) {
  const counts = buildStatusCounts(pages);
  const q = `run=${encodeURIComponent(runId)}`;

  const chips: { label: string; count: number; href: string; danger?: boolean }[] = [
    { label: "All pages", count: pages.length + failureCount + blockedCount, href: `/pages?${q}` },
    { label: "Successful", count: counts["2xx"], href: `/pages?${q}&status=2xx` },
    { label: "Redirects", count: counts["3xx"], href: `/pages?${q}&status=3xx` },
    { label: "Client errors", count: counts["4xx"], href: `/pages?${q}&status=4xx`, danger: counts["4xx"] > 0 },
    { label: "Server errors", count: counts["5xx"], href: `/pages?${q}&status=5xx`, danger: counts["5xx"] > 0 },
    { label: "Blocked", count: report.blockedByRobots, href: `/sitemap?${q}#failures`, danger: report.blockedByRobots > 0 },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.label}
          to={chip.href}
          className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-subtle px-2.5 py-1 text-xs font-medium text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {chip.danger && <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />}
          {chip.label}
          <span className={cn("rounded-pill px-1.5 tabular-nums", chip.danger ? "bg-danger-bg text-danger" : "bg-elevated text-faint")}>{chip.count}</span>
        </Link>
      ))}
    </div>
  );
}
