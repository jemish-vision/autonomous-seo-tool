import { useCallback, useState } from "react";
import { useMuteRule, useUnmuteRule } from "@/api/mutes";

/**
 * Server-side accepted-risk store (POST/DELETE /api/mutes). Findings are never deleted: a mute
 * flips the finding's status to "muted" and the health score recomputes — this hook's job is just
 * to call the API and let React Query refetch the issues report so the fresh
 * report.mutedRuleIds/findings/healthScore flow back down as props. No local mute list is kept —
 * `mutedRuleIds` below IS the server's answer, read from the current report.
 */
export function useMutes(runId: string, mutedRuleIds: string[]) {
  const muteRule = useMuteRule(runId);
  const unmuteRule = useUnmuteRule(runId);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const isMuted = useCallback((ruleId: string) => mutedRuleIds.includes(ruleId), [mutedRuleIds]);
  const isPending = useCallback((ruleId: string) => pending.has(ruleId), [pending]);

  const run = useCallback(
    async (kind: "mute" | "unmute", ruleId: string, note?: string) => {
      setPending((prev) => new Set(prev).add(ruleId));
      try {
        if (kind === "mute") await muteRule.mutateAsync({ ruleId, note });
        else await unmuteRule.mutateAsync({ ruleId });
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(ruleId);
          return next;
        });
      }
    },
    [muteRule, unmuteRule],
  );

  const mute = useCallback((ruleId: string, note: string) => void run("mute", ruleId, note).catch(() => {}), [run]);
  const unmute = useCallback((ruleId: string) => void run("unmute", ruleId).catch(() => {}), [run]);

  return { mutedRuleIds, isMuted, isPending, mute, unmute };
}
