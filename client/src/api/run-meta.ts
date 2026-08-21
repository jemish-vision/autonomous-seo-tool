/**
 * React Query mutation for editing a run's dashboard metadata (label / notes / tags).
 *   PATCH /api/crawls/:runId/meta  { label?, notes?, tags? }  -> updated CrawlMeta
 *
 * label maps to Crawl.label; notes + tags live under Crawl.notes.dashboard (see the vendored
 * db/crawl/crawlMeta.ts). On success we invalidate ["runs"] and ["run", runId] so the runs hub and
 * the run detail reflect the edit immediately.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/lib/api";

export interface CrawlMeta {
  label: string | null;
  notes: string | null;
  tags: string[];
}

export interface UpdateMetaVars {
  label?: string | null;
  notes?: string | null;
  tags?: string[];
}

export function useUpdateRunMeta(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateMetaVars) =>
      apiSend<CrawlMeta>("PATCH", `/api/crawls/${encodeURIComponent(runId)}/meta`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
  });
}
