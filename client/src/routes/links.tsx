import { History } from "lucide-react";
import { useCurrentRun } from "@/api/current-run";
import { useLinks } from "@/api/links";
import { usePages } from "@/api/pages";
import { EmptyState } from "@/components/ui/empty-state";
import { LinksClient } from "@/components/links/links-client";

/** Links page — unique outbound destinations for the current run. Old: app/links/page.tsx. */
export function LinksRoute() {
  const { runId, runsLoading } = useCurrentRun();
  const linksQuery = useLinks(runId);
  const pagesQuery = usePages(runId);

  if (runsLoading) return <p className="text-sm text-secondary">Loading…</p>;
  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl to see its link graph here." />;
  }
  if (linksQuery.isLoading || pagesQuery.isLoading) return <p className="text-sm text-secondary">Loading…</p>;
  if (linksQuery.error) {
    return <EmptyState icon={History} title="Couldn’t load links" description={(linksQuery.error as Error).message} />;
  }

  const rows = linksQuery.data ?? [];
  const pages = pagesQuery.data ?? [];
  const pageIdByTarget: Record<string, string> = {};
  for (const p of pages) pageIdByTarget[p.normalizedUrl] = p.pageId;

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Run <span className="font-medium text-foreground">{runId}</span> · {rows.length} unique link destination
        {rows.length === 1 ? "" : "s"}
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={History} title="No links recorded" description="This run has no outbound links captured yet." />
      ) : (
        <LinksClient rows={rows} runId={runId} pageIdByTarget={pageIdByTarget} />
      )}
    </div>
  );
}
