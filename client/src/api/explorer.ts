/**
 * React Query hook for the Pages explorer table rows (Pages page + page-detail prev/next context).
 *   GET /api/crawls/:runId/explorer   (server runs buildExplorerRows)
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { ExplorerRow } from "@/lib/explorer-shared";

export function useExplorerRows(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["explorer", runId],
    queryFn: () => apiGet<{ rows: ExplorerRow[] }>(`/api/crawls/${runId}/explorer`).then((r) => r.rows),
    enabled: Boolean(runId),
  });
}
