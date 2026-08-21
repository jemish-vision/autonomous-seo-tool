/**
 * In-repo health-score recompute — a faithful port of the crawler's transparent, category-weighted
 * SEO health score (poc/seo-crawler-poc/src/analysis/score.ts, `computeTransparentHealthScore`).
 *
 * WHY THIS EXISTS: the old dashboard re-ran the whole crawler rules engine after a mute/unmute so
 * the caller got a fresh healthScore back. That engine is crawler/disk-only and unavailable in this
 * Supabase-only server. BUT the score is a PURE function of already-stored finding data — per rule:
 * its category, its worst severity, its distinct affected-page count, and the rule's evaluated-page
 * count — and muting a rule simply drops that rule's deduction. So we do NOT need the engine: we
 * recompute the exact same number from the run's stored findings, excluding the currently-muted
 * rules. See the source formula for the deduction table and category weights (kept in sync here).
 *
 * Reach note: the score uses `reach = min(1, affectedPages / evaluatedPages)` (NOT the finding's
 * stored `reach`, which the crawler already √-transforms). We recompute it from the two counts so
 * this matches the engine's `score.ts` exactly.
 */
import type { AnalysisFindingRow } from "../db/src/crawl/readStore.js";

/** Category weights (must sum to 100). Mirrors score.ts CATEGORY_WEIGHTS. */
const CATEGORY_WEIGHTS: Record<string, { name: string; weight: number }> = {
  indexability: { name: "Indexability", weight: 30 },
  content: { name: "Content", weight: 25 },
  links: { name: "Links", weight: 15 },
  media: { name: "Media & Markup", weight: 15 },
  performance: { name: "Performance & Security", weight: 15 },
};

/** Per-rule deduction points + category. Mirrors score.ts RULE_DEDUCTION_POINTS verbatim. */
const RULE_DEDUCTION_POINTS: Record<string, { points: number; category: string }> = {
  // Indexability (30%)
  "noindex-set": { points: 100, category: "indexability" },
  "status-code-error": { points: 100, category: "indexability" },
  "canonical-missing": { points: 10, category: "indexability" },
  "redirect-chain": { points: 15, category: "indexability" },
  "orphan-page": { points: 20, category: "indexability" },
  "depth-deep": { points: 10, category: "indexability" },
  "sitemap-missing-page": { points: 8, category: "indexability" },
  "robots-blocked": { points: 50, category: "indexability" },
  // Content (25%)
  "title-missing": { points: 40, category: "content" },
  "title-too-long": { points: 12, category: "content" },
  "title-too-short": { points: 5, category: "content" },
  "meta-description-missing": { points: 20, category: "content" },
  "meta-description-too-long": { points: 6, category: "content" },
  "h1-missing": { points: 15, category: "content" },
  "h1-multiple": { points: 8, category: "content" },
  "thin-content": { points: 20, category: "content" },
  "content-duplicate": { points: 25, category: "content" },
  // Links (15%)
  "broken-internal-link": { points: 15, category: "links" },
  "broken-external-link": { points: 10, category: "links" },
  "links-none": { points: 20, category: "links" },
  "anchor-missing": { points: 15, category: "links" },
  // Media & Markup (15%)
  "image-missing-alt": { points: 25, category: "media" },
  "image-heavy": { points: 15, category: "media" },
  "structured-data-missing": { points: 15, category: "media" },
  "structured-data-invalid": { points: 20, category: "media" },
  "og-missing": { points: 12, category: "media" },
  // Performance & Security (15%)
  "https-missing": { points: 40, category: "performance" },
  "mixed-content": { points: 25, category: "performance" },
  "viewport-missing": { points: 15, category: "performance" },
  "ttfb-slow": { points: 15, category: "performance" },
  "security-header-missing": { points: 5, category: "performance" },
};

/** score.ts defaultPointsForSeverity — the fallback when a rule isn't in the deduction table. The
 *  finding severity is already lowercased to error/warning/notice (CRITICAL renders as error). */
function defaultPointsForSeverity(severity: string): number {
  switch (severity) {
    case "error":
      return 25;
    case "warning":
      return 10;
    case "notice":
      return 4;
    default:
      return 5;
  }
}

/** score.ts categoryForRule — the deduction table wins; else the finding's own category if it's a
 *  known weighted category; else "content". */
function categoryForRule(ruleId: string, findingCategory?: string): string {
  const known = RULE_DEDUCTION_POINTS[ruleId];
  if (known) return known.category;
  const lower = findingCategory?.toLowerCase();
  if (lower && CATEGORY_WEIGHTS[lower]) return lower;
  return "content";
}

/**
 * Recompute the run's health score (0-100, 1 decimal) from its stored findings, excluding any rule
 * in `mutedRuleIds`. A faithful port of score.ts's category-weighted deduction model:
 *   - only rules that actually fired contribute (affectedPages > 0, evaluatedPages > 0);
 *   - reach = min(1, affectedPages / evaluatedPages); deduction = basePoints * sqrt(reach);
 *   - category.score = clamp(round(100 - Σ deductions), 0, 100);
 *   - final = round( (Σ score*weight / Σ weight) * 10 ) / 10.
 * Muting a rule drops its deduction, exactly as the engine's `scorableIssues` filter did.
 */
export function recomputeHealthScore(findings: AnalysisFindingRow[], mutedRuleIds: Iterable<string>): number {
  const muted = new Set(mutedRuleIds);
  const lostByCategory: Record<string, number> = {
    indexability: 0,
    content: 0,
    links: 0,
    media: 0,
    performance: 0,
  };

  for (const f of findings) {
    if (muted.has(f.ruleId)) continue; // muted rule: no deduction (engine drops it from scorableIssues)
    if (f.affectedPages <= 0 || f.evaluatedPages <= 0) continue; // rule didn't fire / not evaluated
    const reach = Math.min(1, f.affectedPages / f.evaluatedPages);
    const basePoints = RULE_DEDUCTION_POINTS[f.ruleId]?.points ?? defaultPointsForSeverity(f.severity);
    const catKey = categoryForRule(f.ruleId, f.category);
    if (catKey in lostByCategory) lostByCategory[catKey] += basePoints * Math.sqrt(reach);
  }

  let totalWeight = 0;
  let weightedSum = 0;
  for (const [catKey, { weight }] of Object.entries(CATEGORY_WEIGHTS)) {
    const score = Math.max(0, Math.min(100, Math.round(100 - lostByCategory[catKey])));
    totalWeight += weight;
    weightedSum += score * weight;
  }
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}
