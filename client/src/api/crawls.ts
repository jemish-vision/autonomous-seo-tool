/**
 * React Query hooks for crawl runs. This is the REFERENCE PATTERN every other api/* module
 * follows: a query key + a fetcher over apiGet, wrapped in useQuery.
 *
 * Old Next.js server-component read  ->  client hook here.
 *   listRuns()          -> useRuns()
 *   getRunDetail(runId) -> useRun(runId)
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { RunListItem, RunDetail } from "@/lib/data";

export function useRuns() {
  return useQuery({
    queryKey: ["runs"],
    queryFn: () => apiGet<{ runs: RunListItem[] }>("/api/crawls").then((r) => r.runs),
  });
}

export function useRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => apiGet<RunDetail>(`/api/crawls/${runId}`),
    enabled: Boolean(runId),
  });
}
