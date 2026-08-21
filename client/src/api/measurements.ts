/**
 * React Query hook for a run's raw technical-SEO measurements blob.
 *   GET /api/crawls/:runId/measurements   (server runs buildMeasurements)
 *
 * The route adapts this to the view model client-side via adaptMeasurements (pure).
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { Measurements } from "@/lib/data-measurements";

export function useMeasurements(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["measurements", runId],
    queryFn: () => apiGet<Measurements | null>(`/api/crawls/${runId}/measurements`),
    enabled: Boolean(runId),
  });
}
