import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { apiSend } from "@/lib/api";
import type { AppliedFix } from "@/lib/data-applied-fixes";

/** Same identity as lib/data-applied-fixes.ts's appliedFixKey — duplicated here rather than
 *  imported because that module is server-only (node:fs). */
function key(ruleId: string, pageId: string | null, instanceKey: string | null): string {
  return `${ruleId}::${pageId ?? "site"}::${instanceKey ?? ""}`;
}

interface AppliedFixesValue {
  /** null when no provider is mounted — the card then behaves as it always did (apply works, but
   *  the result is not persisted), rather than crashing on a surface that hasn't been wired yet. */
  runId: string | null;
  get(ruleId: string, pageId: string | null, instanceKey: string | null): AppliedFix | null;
  record(fix: Omit<AppliedFix, "appliedAt">): Promise<void>;
}

const Ctx = createContext<AppliedFixesValue>({
  runId: null,
  get: () => null,
  record: async () => {},
});

export function useAppliedFixes(): AppliedFixesValue {
  return useContext(Ctx);
}

/** Holds this run's applied-fix history for every AiRecommendationCard on the page, whichever of
 *  the three surfaces rendered it (rule panel, finding row, page-detail panel). Context rather
 *  than prop-drilling so a write on one card is immediately visible to a duplicate of the same
 *  recommendation rendered elsewhere — and so the state survives a refresh via the server-rendered
 *  `initial` list. */
export function AppliedFixesProvider({ runId, initial, children }: { runId: string; initial: AppliedFix[]; children: React.ReactNode }) {
  const [fixes, setFixes] = useState<AppliedFix[]>(initial);

  const byKey = useMemo(() => {
    const m = new Map<string, AppliedFix>();
    for (const f of fixes) {
      const k = key(f.ruleId, f.pageId, f.instanceKey);
      const prev = m.get(k);
      if (!prev || f.appliedAt >= prev.appliedAt) m.set(k, f);
    }
    return m;
  }, [fixes]);

  const get = useCallback(
    (ruleId: string, pageId: string | null, instanceKey: string | null) => byKey.get(key(ruleId, pageId, instanceKey)) ?? null,
    [byKey],
  );

  const record = useCallback(
    async (fix: Omit<AppliedFix, "appliedAt">) => {
      const optimistic: AppliedFix = { ...fix, appliedAt: new Date().toISOString() };
      setFixes((prev) => [...prev, optimistic]);

      // Persist. A failure here is NOT surfaced as a failed fix — the site write already
      // succeeded, and claiming otherwise would be worse than a lost badge. The optimistic entry
      // stays for this session; the next refresh simply won't show it. apiSend attaches the
      // Supabase Bearer token (a raw fetch would 401 — the API authenticates by header, not cookie).
      try {
        await apiSend(`POST`, `/api/crawls/${encodeURIComponent(runId)}/applied-fixes`, fix);
      } catch (err) {
        console.warn("[applied-fixes] the write succeeded but recording it did not:", err);
      }
    },
    [runId],
  );

  const value = useMemo(() => ({ runId, get, record }), [runId, get, record]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
