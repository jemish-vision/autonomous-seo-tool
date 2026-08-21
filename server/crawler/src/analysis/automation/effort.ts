/** Effort is derived, never hand-assigned per rule — with 78+ rules and growing, hand-set
 * values would rot the moment a rule changed. Mirrors the reasoning in the Kishan audit
 * (index.js effortOf): automation level already encodes most of it — auto-safe means the
 * value is computable, which is exactly what makes it scriptable regardless of reach. */
import type { AutomationLevel, EffortResult } from "./types";

export interface EffortInput {
  automation: AutomationLevel;
  scope: "page" | "site";
  /** Distinct pages/units this rule fired on, for this run. */
  affectedPages: number;
  /** Denominator — total pages analyzed in the run. */
  pagesAnalyzed: number;
}

export function deriveEffort({ automation, scope, affectedPages, pagesAnalyzed }: EffortInput): EffortResult {
  if (automation === "auto-safe") {
    return { level: "low", why: "scriptable — the correct value is computable from data already captured" };
  }

  const reach = scope === "site" ? 1 : affectedPages / Math.max(1, pagesAnalyzed);

  if (automation === "auto-with-review") {
    return reach > 0.5
      ? { level: "medium", why: "a computable change, but a person signs off across most of the site" }
      : { level: "low", why: "a computable change, with a quick review on a handful of pages" };
  }

  // human-only: work scales with how many pages need the judgment call.
  if (scope === "site") return { level: "medium", why: "one judgment call, applied site-wide" };
  if (affectedPages > 25 || reach > 0.4) {
    return { level: "high", why: `a judgment call repeated on ${affectedPages} pages` };
  }
  return { level: "medium", why: `a judgment call on ${affectedPages} page${affectedPages === 1 ? "" : "s"}` };
}
