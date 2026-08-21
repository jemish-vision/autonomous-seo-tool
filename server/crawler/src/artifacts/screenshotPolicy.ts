/**
 * Bounded screenshot capture policy (owner-approved): top-N pages by importance PLUS every page
 * with an error — explicitly not every page. Measured cost of "every page": 27.5 GB vs 0.6 GB per
 * 100k-page crawl (45x) for full-page + thumb WebP captures. Error pages are NEVER subject to the
 * budget — that half of the policy is exact, not approximate.
 *
 * "Top-N by importance" would need the whole crawl known in advance to rank exactly; this is a
 * streaming crawler and does not buffer pages to sort them globally. Approximated instead by
 * depth-ordered greedy admission: Crawlee's queue is FIFO and pages are enqueued in non-decreasing
 * depth order (parents before children), so "first topN non-error pages the crawl actually
 * processes" tracks "shallowest topN pages" closely without buffering anything. This is a
 * deliberate, documented approximation — not a global sort — and is called out as such in the
 * handoff report rather than silently presented as an exact rank.
 */
export const DEFAULT_SCREENSHOT_BUDGET = 50;

export interface ScreenshotPolicyInput {
  normalizedUrl: string;
  depth: number;
  isError: boolean;
}

export type ScreenshotDecisionReason = "error-page" | "top-n-importance" | "budget-exhausted";

export interface ScreenshotDecision {
  capture: boolean;
  reason: ScreenshotDecisionReason;
}

export interface ScreenshotBudgetOptions {
  /** Max non-error pages captured by importance rank. Never bounds error pages. */
  topN: number;
}

export class ScreenshotBudget {
  private readonly topN: number;
  private admitted = 0;
  private errorsAdmitted = 0;

  constructor(options: ScreenshotBudgetOptions) {
    this.topN = Math.max(0, Math.floor(options.topN));
  }

  decide(input: ScreenshotPolicyInput): ScreenshotDecision {
    if (input.isError) {
      this.errorsAdmitted++;
      return { capture: true, reason: "error-page" };
    }
    if (this.admitted < this.topN) {
      this.admitted++;
      return { capture: true, reason: "top-n-importance" };
    }
    return { capture: false, reason: "budget-exhausted" };
  }

  get stats(): { admittedByImportance: number; admittedErrors: number; topN: number } {
    return { admittedByImportance: this.admitted, admittedErrors: this.errorsAdmitted, topN: this.topN };
  }
}
