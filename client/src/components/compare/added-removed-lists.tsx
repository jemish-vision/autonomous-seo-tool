import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { findPageIdByUrl } from "@/lib/data-explorer";
import type { CrawledPageWithId } from "@/lib/types";

function UrlList({ title, urls, runId, pages, tone }: { title: string; urls: string[]; runId: string; pages: CrawledPageWithId[]; tone: "ok" | "danger" }) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Badge tone={tone}>{urls.length}</Badge>
      </div>
      {urls.length === 0 ? (
        <p className="text-sm text-faint">None.</p>
      ) : (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
          {urls.map((url) => {
            const pageId = findPageIdByUrl(pages, url);
            return (
              <li key={url} className="border-b border-border pb-1.5 last:border-0">
                {pageId ? (
                  <Link to={`/pages/${pageId}?run=${encodeURIComponent(runId)}`} className="block truncate text-primary underline underline-offset-2">
                    {url}
                  </Link>
                ) : (
                  <span className="block truncate text-secondary">{url}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Added pages link into the HEAD run (where they now exist); removed pages link into the BASE
 * run (where they still exist) — never a dead link into the run that doesn't have the page. */
export function AddedRemovedLists({
  added,
  removed,
  baseRunId,
  headRunId,
  basePages,
  headPages,
}: {
  added: string[];
  removed: string[];
  baseRunId: string;
  headRunId: string;
  basePages: CrawledPageWithId[];
  headPages: CrawledPageWithId[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <UrlList title="Added since base" urls={added} runId={headRunId} pages={headPages} tone="ok" />
      <UrlList title="Removed since base" urls={removed} runId={baseRunId} pages={basePages} tone="danger" />
    </div>
  );
}
