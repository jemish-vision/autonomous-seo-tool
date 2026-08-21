/**
 * React Query hook for a base->head run diff (Compare page).
 *   GET /api/crawls/:head/diff?base=:base   (server runs computeDiff)
 *
 * Base/head page lists come from the existing usePages hook; this only fetches the diff itself.
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { CrawlDiff } from "@/lib/data-compare";

export function useCompareDiff(baseRunId: string | null | undefined, headRunId: string | null | undefined) {
  return useQuery({
    queryKey: ["compare", baseRunId, headRunId],
    queryFn: () =>
      apiGet<CrawlDiff>(`/api/crawls/${headRunId}/diff?base=${encodeURIComponent(baseRunId as string)}`),
    enabled: Boolean(baseRunId && headRunId && baseRunId !== headRunId),
  });
}
