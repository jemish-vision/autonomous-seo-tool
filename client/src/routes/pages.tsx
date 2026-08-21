import { History, FileText } from "lucide-react";
import { useCurrentRun } from "@/api/current-run";
import { useExplorerRows } from "@/api/explorer";
import { EmptyState } from "@/components/ui/empty-state";
import { RunBreadcrumb } from "@/components/shell/run-breadcrumb";
import { PagesExplorerClient } from "@/components/explorer/pages-explorer-client";

/** Pages explorer table for the current run. Old: app/pages/page.tsx. */
export function PagesRoute() {
  const { runId, runs, runsLoading } = useCurrentRun();
  const rowsQuery = useExplorerRows(runId);

  if (runsLoading) return <p className="text-sm text-secondary">Loading…</p>;
  if (!runId) {
    return (
      <EmptyState
        icon={History}
        title="No crawl runs yet"
        description="Pages explorer reads a run's crawled pages — run a crawl first."
      />
    );
  }
  if (rowsQuery.isLoading) return <p className="text-sm text-secondary">Loading…</p>;
  if (rowsQuery.error) {
    return <EmptyState icon={FileText} title="Couldn’t load pages" description={(rowsQuery.error as Error).message} />;
  }

  const rows = rowsQuery.data ?? [];
  if (rows.length === 0) {
    return <EmptyState icon={FileText} title="No pages recorded for this run" />;
  }

  return (
    <div className="space-y-4">
      <RunBreadcrumb runs={runs} runId={runId} current="Pages" />
      <PagesExplorerClient rows={rows} runId={runId} />
    </div>
  );
}
