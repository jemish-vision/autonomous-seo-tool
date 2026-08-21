import { History } from "lucide-react";
import { useCurrentRun } from "@/api/current-run";
import { useRedirects } from "@/api/redirects";
import { EmptyState } from "@/components/ui/empty-state";
import { RedirectsClient } from "@/components/redirects/redirects-client";

/** Redirects page — observed redirect chains for the current run. Old: app/redirects/page.tsx. */
export function RedirectsRoute() {
  const { runId, runsLoading } = useCurrentRun();
  const redirectsQuery = useRedirects(runId);

  if (runsLoading) return <p className="text-sm text-secondary">Loading…</p>;
  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl to see its redirects here." />;
  }
  if (redirectsQuery.isLoading) return <p className="text-sm text-secondary">Loading…</p>;
  if (redirectsQuery.error) {
    return <EmptyState icon={History} title="Couldn’t load redirects" description={(redirectsQuery.error as Error).message} />;
  }

  const rows = redirectsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Run <span className="font-medium text-foreground">{runId}</span> · {rows.length} redirect{rows.length === 1 ? "" : "s"}
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={History} title="No redirects recorded" description="This run has no redirect chains." />
      ) : (
        <RedirectsClient rows={rows} runId={runId} />
      )}
    </div>
  );
}
