import { History } from "lucide-react";
import { useCurrentRun } from "@/api/current-run";
import { useImages } from "@/api/images";
import { EmptyState } from "@/components/ui/empty-state";
import { ImagesClient } from "@/components/images/images-client";

/** Images page — unique images captured for the current run. Old: app/images/page.tsx. */
export function ImagesRoute() {
  const { runId, runsLoading } = useCurrentRun();
  const imagesQuery = useImages(runId);

  if (runsLoading) return <p className="text-sm text-secondary">Loading…</p>;
  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl to see its images here." />;
  }
  if (imagesQuery.isLoading) return <p className="text-sm text-secondary">Loading…</p>;
  if (imagesQuery.error) {
    return <EmptyState icon={History} title="Couldn’t load images" description={(imagesQuery.error as Error).message} />;
  }

  const rows = imagesQuery.data ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Run <span className="font-medium text-foreground">{runId}</span> · {rows.length} unique image
        {rows.length === 1 ? "" : "s"}
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={History} title="No images recorded" description="This run has no images captured yet." />
      ) : (
        <ImagesClient rows={rows} runId={runId} />
      )}
    </div>
  );
}
