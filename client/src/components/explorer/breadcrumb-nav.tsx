import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, ChevronRight as Sep } from "lucide-react";
import { sectionOf } from "@/lib/explorer-shared";

const LINK_BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-control border border-border bg-transparent px-2.5 text-xs font-medium text-foreground transition-colors duration-150 ease-out hover:bg-subtle outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";
const LINK_BUTTON_DISABLED_CLASS =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-control border border-border bg-transparent px-2.5 text-xs font-medium text-faint opacity-50";

/** query string carries the SAME filter context the list used (run/q/status/etc) so "section"
 *  and prev/next stay inside the set the user was actually looking at (Law 1: shareable state). */
export function BreadcrumbNav({
  url,
  runId,
  listQuery,
  prevHref,
  nextHref,
}: {
  url: string;
  runId: string;
  listQuery: string;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const section = sectionOf(url);
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // keep full url
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-secondary">
        <Link to={`/pages?run=${encodeURIComponent(runId)}`} className="shrink-0 text-primary underline underline-offset-2">
          Pages
        </Link>
        <Sep size={12} strokeWidth={2} className="shrink-0 text-faint" aria-hidden="true" />
        <Link to={`/pages?run=${encodeURIComponent(runId)}&section=${encodeURIComponent(section)}`} className="shrink-0 text-primary underline underline-offset-2">
          {section}
        </Link>
        <Sep size={12} strokeWidth={2} className="shrink-0 text-faint" aria-hidden="true" />
        <span className="truncate text-faint">{path}</span>
      </nav>

      <div className="flex shrink-0 items-center gap-1.5">
        {prevHref ? (
          <Link to={`${prevHref}${listQuery}`} className={LINK_BUTTON_CLASS} aria-label="Previous page in this filtered set">
            <ChevronLeft size={14} strokeWidth={1.75} aria-hidden="true" />
            Prev
          </Link>
        ) : (
          <span className={LINK_BUTTON_DISABLED_CLASS} aria-disabled="true">
            <ChevronLeft size={14} strokeWidth={1.75} aria-hidden="true" />
            Prev
          </span>
        )}
        {nextHref ? (
          <Link to={`${nextHref}${listQuery}`} className={LINK_BUTTON_CLASS} aria-label="Next page in this filtered set">
            Next
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        ) : (
          <span className={LINK_BUTTON_DISABLED_CLASS} aria-disabled="true">
            Next
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );
}
