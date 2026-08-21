/**
 * React Query mutation for generating AI content recommendations for a run.
 *   POST /api/crawls/:runId/ai-recommendations/generate  { ruleId?, pageId?, top? }
 *     -> { runId, totalGenerated, totalSkipped, model, intelligence? }
 *
 * On success we invalidate ["ai-recommendations", runId] so useAiRecommendations refetches the
 * freshly generated report and the inline cards appear without a manual reload.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/lib/api";

export interface IntelligencePayload {
  gscConnected: boolean;
  domain: string;
  topKeyword: string | null;
  impressions: number | null;
  clicks: number | null;
  competitorBenchmarks: string[];
}

export interface GenerateResponse {
  runId: string;
  totalGenerated: number;
  totalSkipped: number;
  model: string;
  intelligence?: IntelligencePayload | null;
}

export interface GenerateVars {
  /** Scope to one rule (the AI Suggestions panel / finding-row generate action). */
  ruleId?: string;
  /** Scope to one page (the page-detail per-issue generate action). */
  pageId?: string;
  /** Cap the number of instances generated in this batch. */
  top?: number;
}

export function useGenerateAiRecommendations(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: GenerateVars = {}) =>
      apiSend<GenerateResponse>("POST", `/api/crawls/${encodeURIComponent(runId)}/ai-recommendations/generate`, vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-recommendations", runId] });
    },
  });
}
