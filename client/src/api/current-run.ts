/**
 * Shared "which run is showing?" resolver for every run-scoped route.
 *
 * Old Next.js pages called `resolveRunId(searchParams.run)` server-side. Here the same rule runs
 * client-side: the `?run=` query param wins; otherwise fall back to the newest substantial run via
 * `pickDefaultRun` (the single source of truth in lib/run-selection, shared with the topbar).
 */
import { useSearchParams } from "react-router-dom";
import { useRuns } from "./crawls";
import { pickDefaultRun } from "@/lib/run-selection";

export function useCurrentRun() {
  const [params] = useSearchParams();
  const explicit = params.get("run");
  const runsQuery = useRuns();
  const runs = runsQuery.data ?? [];
  const runId = explicit ?? (runs.length ? pickDefaultRun(runs)?.runId ?? null : null);
  return {
    runId,
    runs,
    runsLoading: runsQuery.isLoading,
    runsError: runsQuery.error,
  };
}
