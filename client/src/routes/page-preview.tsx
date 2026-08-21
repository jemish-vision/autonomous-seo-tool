import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileSearch } from "lucide-react";
import { usePage } from "@/api/pages";
import { useArtifactStatus } from "@/api/artifacts";
import { useCurrentRun } from "@/api/current-run";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageReplay } from "@/components/preview/page-replay";
import { frameability } from "@/components/preview/frameability";
import { pageHasStaticHtml } from "@/lib/page-artifacts";

/** Full-page replay view. Old: app/pages/[id]/preview/page.tsx.
 *
 *  Same PageReplay component the detail page embeds, but full-width and shown even when no raw HTML
 *  was stored (the component self-manages its empty/not-found states). */
export function PagePreviewRoute() {
  const { id = "" } = useParams();
  const { runId } = useCurrentRun();

  const pageQuery = usePage(runId, id);
  const artifactStatus = useArtifactStatus();

  if (runId && pageQuery.isLoading) return <p className="text-sm text-secondary">Loading…</p>;

  const page = pageQuery.data ?? null;

  if (!runId || !page) {
    return (
      <EmptyState
        icon={FileSearch}
        title="Page record not found"
        description={
          <>
            No record for{" "}
            <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">{id}</code> under this run.{" "}
            <Link to="/pages" className="text-primary underline underline-offset-2">
              Back to Pages
            </Link>
          </>
        }
      />
    );
  }

  const hasStaticHtml = pageHasStaticHtml(page);
  const frame = frameability(page.headers, page.url);

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={`/pages/${encodeURIComponent(id)}?run=${encodeURIComponent(runId)}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-2"
        >
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
          Back to page evidence
        </Link>
      </div>

      <Card className="space-y-1 bg-subtle">
        <h1 className="text-base font-semibold text-foreground">Page replay</h1>
        <p className="text-xs text-secondary">
          What the crawler actually captured for this page — rendered from stored HTML, not re-fetched from the live site.
        </p>
      </Card>

      <PageReplay
        runId={runId}
        pageId={page.pageId}
        pageUrl={page.url}
        statusCode={page.statusCode}
        fetchedAt={page.fetchedAt}
        hasStaticHtml={hasStaticHtml}
        canFrameLive={frame.canFrameLive}
        frameBlockedBy={frame.frameBlockedBy}
        hasScreenshot={Boolean(page.screenshot?.full)}
        artifactStorageConfigured={artifactStatus.data?.configured}
        artifactStorageReason={artifactStatus.data?.reason}
      />
    </div>
  );
}
