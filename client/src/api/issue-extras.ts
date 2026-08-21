/**
 * React Query hooks for the auxiliary reports the Issues + page-detail views layer on top of the
 * core analyzer report (useIssues). Each is a separate endpoint and may not exist yet on a fresh
 * backend — callers default gracefully (null / empty) so the page still renders.
 *
 *   GET /api/crawls/:runId/automation         -> AutomationReport | null
 *   GET /api/crawls/:runId/fix-plan           -> FixPlan | null
 *   GET /api/crawls/:runId/ai-recommendations -> AiRecommendationReport | null
 *   GET /api/crawls/:runId/applied-fixes      -> { fixes: AppliedFix[] }
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { AutomationReport } from "@/lib/data-issue-extras";
import type { FixPlan } from "@/lib/types";
import type { AiRecommendationReport } from "@/lib/data-ai-recommendations";
import type { AppliedFix } from "@/lib/data-applied-fixes";

export function useAutomation(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["automation", runId],
    queryFn: () => apiGet<AutomationReport | null>(`/api/crawls/${runId}/automation`),
    enabled: Boolean(runId),
    retry: false,
  });
}

export function useFixPlan(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["fix-plan", runId],
    queryFn: () => apiGet<FixPlan | null>(`/api/crawls/${runId}/fix-plan`),
    enabled: Boolean(runId),
    retry: false,
  });
}

export function useAiRecommendations(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["ai-recommendations", runId],
    queryFn: () => apiGet<AiRecommendationReport | null>(`/api/crawls/${runId}/ai-recommendations`),
    enabled: Boolean(runId),
    retry: false,
  });
}

export function useAppliedFixes(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["applied-fixes", runId],
    queryFn: () => apiGet<{ fixes: AppliedFix[] }>(`/api/crawls/${runId}/applied-fixes`).then((r) => r.fixes ?? []),
    enabled: Boolean(runId),
    retry: false,
  });
}
