/**
 * React Query mutations for the server-side accepted-risk (mute) store.
 *   POST   /api/mutes  { runId, ruleId, note? }  -> { ok, mutedRuleIds, ... }
 *   DELETE /api/mutes  { runId, ruleId }          -> { ok, mutedRuleIds, ... }
 *
 * A mute never deletes a finding — it flips its status to "muted" and the health score recomputes.
 * The report's `mutedRuleIds` IS the source of truth, so on success we invalidate ["issues", runId]
 * and let useIssues refetch the fresh report (mutedRuleIds / findings / healthScore flow back down).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/lib/api";

export interface MuteResponse {
  ok: boolean;
  mutedRuleIds: string[];
}

export function useMuteRule(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, note }: { ruleId: string; note?: string }) =>
      apiSend<MuteResponse>("POST", "/api/mutes", { runId, ruleId, note }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["issues", runId] });
    },
  });
}

export function useUnmuteRule(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId }: { ruleId: string }) =>
      apiSend<MuteResponse>("DELETE", "/api/mutes", { runId, ruleId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["issues", runId] });
    },
  });
}
