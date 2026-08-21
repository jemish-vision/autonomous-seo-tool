/**
 * React Query hook for a run's unique images (Images page).
 *   GET /api/crawls/:runId/images   (server runs buildImageRows)
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { ImageRow } from "@/lib/data-images";

export function useImages(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["images", runId],
    queryFn: () => apiGet<{ data: ImageRow[] }>(`/api/crawls/${runId}/images?pageSize=200`).then((r) => r.data),
    enabled: Boolean(runId),
  });
}
