/**
 * React Query hook for a run's unique link destinations (Links page).
 *   GET /api/crawls/:runId/links   (server runs buildLinkRows)
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { LinkRow } from "@/lib/data-links";

export function useLinks(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["links", runId],
    queryFn: () => apiGet<{ data: LinkRow[] }>(`/api/crawls/${runId}/links?pageSize=200`).then((r) => r.data),
    enabled: Boolean(runId),
  });
}
