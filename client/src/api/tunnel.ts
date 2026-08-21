/**
 * React Query hooks for the WordPress tunnel / pairing flow.
 *
 * Backed by the Express /api/tunnel module (Supabase tunnel_* tables, per-user). Pairing creates a
 * source server-side, so usePairSource invalidates ["sources"] to refresh the Sources list. Mirrors
 * the shape of client/src/api/sources.ts.
 *
 *   POST /api/tunnel/pair   -> PairResponse         (create a pairing code; also creates the source)
 *   GET  /api/tunnel/sites  -> TunnelSitesResponse  (paired sites + online/offline counts)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import type { PairRequest, PairResponse, TunnelSitesResponse } from "@/lib/types-tunnel";

const SOURCES_KEY = ["sources"] as const;
const TUNNEL_SITES_KEY = ["tunnel", "sites"] as const;

/** Start a pairing — returns the code the user pastes into the WordPress plugin. */
export function usePairSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PairRequest) => apiSend<PairResponse>("POST", "/api/tunnel/pair", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: SOURCES_KEY }),
  });
}

/** List paired tunnel sites with recomputed online/offline status. */
export function useTunnelSites() {
  return useQuery({
    queryKey: TUNNEL_SITES_KEY,
    queryFn: () => apiGet<TunnelSitesResponse>("/api/tunnel/sites"),
  });
}
