/**
 * React Query hook for cloud artifact storage config status.
 *   GET /api/artifacts/status  ->  { configured: boolean, reason?: string }
 *
 * Consumed by the page-replay UI (PageReplay) to decide whether to surface the
 * "artifact storage not configured" notice. Process-level config, so it is cached generously.
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export interface ArtifactStatus {
  configured: boolean;
  reason?: string;
}

export function useArtifactStatus() {
  return useQuery({
    queryKey: ["artifact-status"],
    queryFn: () => apiGet<ArtifactStatus>("/api/artifacts/status"),
    staleTime: 5 * 60_000,
  });
}
