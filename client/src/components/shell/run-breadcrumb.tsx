import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { hostnameFor, formatRunTimestamp } from "./run-label";
import type { RunListItem } from "@/lib/data";

interface Props {
  runs: RunListItem[];
  runId: string;
  current: string;
}

/** Slim site → run → current breadcrumb for the main data pages (Issues, Pages, Measurements) —
 *  one-click upward hops that the sidebar highlight can't give. Run label links to the run's
 *  overview; the page's own name is the terminal (non-link) crumb. */
export function RunBreadcrumb({ runs, runId, current }: Props) {
  const run = runs.find((r) => r.runId === runId) ?? null;
  if (!run) return null;
  const runHref = `/?run=${encodeURIComponent(run.runId)}`;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-secondary">
      <Link to="/runs" className="shrink-0 text-faint underline-offset-2 hover:text-foreground hover:underline">
        Runs
      </Link>
      <ChevronRight size={12} strokeWidth={2} className="shrink-0 text-faint" aria-hidden="true" />
      <Link to={runHref} className="shrink-0 truncate text-primary underline underline-offset-2 hover:opacity-80" title={run.runId}>
        {hostnameFor(run.startUrl)} · {formatRunTimestamp(run.startedAt)}
      </Link>
      <ChevronRight size={12} strokeWidth={2} className="shrink-0 text-faint" aria-hidden="true" />
      <span className="truncate font-medium text-foreground">{current}</span>
    </nav>
  );
}
