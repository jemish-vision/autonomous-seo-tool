/**
 * React Query hook for a run's redirect chains (Redirects page).
 *   GET /api/crawls/:runId/redirects   (server runs buildRedirectRows)
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { RedirectRow } from "@/lib/data-redirects";

export function useRedirects(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["redirects", runId],
    queryFn: () => apiGet<{ data: RedirectRow[] }>(`/api/crawls/${runId}/redirects?pageSize=200`).then((r) => r.data),
    enabled: Boolean(runId),
  });
}
