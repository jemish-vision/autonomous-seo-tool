/**
 * React Query hook for a run's analyzer report (What to Fix / issues page).
 *   GET /api/crawls/:runId/issues
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { AnalysisReport } from "@/lib/data";

export function useIssues(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["issues", runId],
    queryFn: () => apiGet<{ report: AnalysisReport }>(`/api/crawls/${runId}/issues`).then((r) => r.report),
    enabled: Boolean(runId),
  });
}

/**
 * Per-rule issue counts of this run's previous same-site analyzed crawl, for the "Since the last
 * crawl" delta view. Resolves to a `{ [ruleId]: number }` map, or `null` when there is no earlier
 * analyzed run (the UI then shows its "no earlier crawl to compare" state).
 *   GET /api/crawls/:runId/previous-rule-counts
 */
export function usePreviousRuleCounts(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["issues", runId, "previous-rule-counts"],
    queryFn: () =>
      apiGet<{ previousRuleCounts: Record<string, number> | null }>(
        `/api/crawls/${runId}/previous-rule-counts`,
      ).then((r) => r.previousRuleCounts),
    enabled: Boolean(runId),
  });
}
