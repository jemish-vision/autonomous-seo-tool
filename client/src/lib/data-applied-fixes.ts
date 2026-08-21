/**
 * Client type shim for the old server-only `lib/data-applied-fixes.ts` (node:fs writes to
 * applied-fixes.json). Reads/writes now go through the API. Keeps the shared TYPES plus the two
 * pure keying helpers (no fs, safe on the client once fixes are loaded).
 *
 * TODO(api): use @/api/issues (GET/POST applied-fixes) for reading + recording fixes.
 */
export interface AppliedFix {
  ruleId: string;
  pageId: string | null;
  instanceKey: string | null;
  url: string | null;
  appliedAt: string;
  changes: Record<string, string>;
  sourceId: string;
  queued: boolean;
  commandId: string | null;
}

export interface AppliedFixesFile {
  runId: string;
  fixes: AppliedFix[];
}

/** Stable identity for one recommendation. Mirrors the reuse-index key in generate.ts. */
export function appliedFixKey(
  ruleId: string,
  pageId: string | null,
  instanceKey: string | null,
): string {
  return `${ruleId}::${pageId ?? "site"}::${instanceKey ?? ""}`;
}

/** key -> most recent fix for that recommendation. */
export function appliedFixesByKey(fixes: AppliedFix[]): Map<string, AppliedFix> {
  const map = new Map<string, AppliedFix>();
  for (const f of fixes) {
    const key = appliedFixKey(f.ruleId, f.pageId, f.instanceKey);
    const prev = map.get(key);
    if (!prev || f.appliedAt >= prev.appliedAt) map.set(key, f);
  }
  return map;
}
