/**
 * React Query hooks for connected CMS/e-commerce sources (Sources page).
 *
 * Backed by the Express /api/sources CRUD module (Supabase public.sources, per-user). Every mutation
 * goes through apiSend (which attaches the Supabase Bearer token) and invalidates ["sources"] so the
 * list re-fetches. The old Next.js app hit the same route shapes via raw fetch + router.refresh().
 *
 *   GET    /api/sources            -> SourceConfig[]
 *   POST   /api/sources            -> SourceConfig
 *   DELETE /api/sources/:id        -> { ok: true }
 *   POST   /api/sources/:id/connect-> { ok, status, capabilities }
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import type {
  SourceConfig,
  SourceStatus,
  SourceCapabilities,
  CreateSourceRequest,
  UpdateSourceRequest,
} from "@/lib/types-sources";

const SOURCES_KEY = ["sources"] as const;
const ACTIVE_SOURCE_KEY = ["sources", "active"] as const;

export function useSources() {
  return useQuery({
    queryKey: SOURCES_KEY,
    queryFn: () => apiGet<SourceConfig[]>("/api/sources"),
  });
}

/** The user's currently active source (Fix & Apply target), or null if none is active. */
export function useActiveSource() {
  return useQuery({
    queryKey: ACTIVE_SOURCE_KEY,
    queryFn: () => apiGet<{ active: SourceConfig | null }>("/api/sources/active"),
  });
}

/** Mark a source active (all others for this user become inactive), then refresh list + active. */
export function useActivateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiSend<{ ok: true; sources: SourceConfig[] }>("POST", `/api/sources/${id}/activate`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SOURCES_KEY });
      qc.invalidateQueries({ queryKey: ACTIVE_SOURCE_KEY });
    },
  });
}

/** Create a source, then refresh the list. */
export function useCreateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSourceRequest) => apiSend<SourceConfig>("POST", "/api/sources", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: SOURCES_KEY }),
  });
}

/** Edit a source's name / siteUrl / credentials, then refresh the list. */
export function useUpdateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSourceRequest }) =>
      apiSend<SourceConfig>("PATCH", `/api/sources/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: SOURCES_KEY }),
  });
}

/** Delete a source, then refresh the list. */
export function useDeleteSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<{ ok: true }>("DELETE", `/api/sources/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: SOURCES_KEY }),
  });
}

export interface ConnectResult {
  ok: boolean;
  error?: string;
  status?: SourceStatus;
  capabilities?: SourceCapabilities;
}

/** Health-check (connect) a source. Returns the persisted status + capabilities. Does NOT throw on a
 *  non-2xx connector result — the body still carries { ok:false, error, status } which the UI shows. */
export function useConnectSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<ConnectResult> => {
      try {
        return await apiSend<ConnectResult>("POST", `/api/sources/${id}/connect`, {});
      } catch (err) {
        // A 501/502 from the connector is an expected "not connected" outcome, not a hook error.
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, status: { sourceId: id, state: "error", lastCheckedAt: new Date().toISOString(), error: message } };
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SOURCES_KEY }),
  });
}
