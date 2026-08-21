/**
 * React Query hook for the crawled-site list that anchors the Search Console view (GSC page).
 *   GET /api/gsc/sites   ->  { sites: GscSite[] }
 *
 * The GscClient component fetches connection status / metrics itself via its own gsc-api helpers;
 * this hook only supplies the initial site list the page is organised around.
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { GscSite } from "@/components/gsc/gsc-api";

export function useGscSites() {
  return useQuery({
    queryKey: ["gsc-sites"],
    queryFn: () => apiGet<{ sites: GscSite[] }>("/api/gsc/sites").then((r) => r.sites ?? []),
  });
}
