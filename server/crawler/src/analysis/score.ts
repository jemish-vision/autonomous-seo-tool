/**
 * SEO Health Score Calculation Module.
 * 
 * Ported from reference tool (`score.ts`) to provide a transparent,
 * category-weighted SEO score based on explicit rule deductions across 5 core categories:
 * 
 * 1. Indexability (30%)
 * 2. Content (25%)
 * 3. Links (15%)
 * 4. Media & Markup (15%)
 * 5. Performance & Security (15%)
 */

import type { Issue, IssueSeverity } from "../models/types";
import type { AnalysisConfig } from "./config";

export interface CategoryScore {
  name: string;
  categoryKey: string;
  weight: number; // Percentage (e.g. 30 for 30%)
  score: number;  // 0-100
  deductions: Array<{
    ruleId: string;
    points: number;
    reach: number;
    reason: string;
  }>;
}

export interface ScoreDeductionDetail {
  ruleId: string;
  severity: IssueSeverity;
  affectedPages: number;
  evaluatedPages: number;
  reach: number;
  damage: number;
}

export interface TransparentHealthScoreResult {
  score: number; // 0-100 (rounded to 1 decimal place or integer)
  grade: string; // A, B, C, D, E, F
  band: string;  // "very good", "good", "fair", "needs work", "poor", "failing"
  categories: CategoryScore[];
  contributions: ScoreDeductionDetail[];
  totalDamage: number;
}

export const CATEGORY_WEIGHTS: Record<string, { name: string; weight: number }> = {
  indexability: { name: "Indexability", weight: 30 },
  content: { name: "Content", weight: 25 },
  links: { name: "Links", weight: 15 },
  media: { name: "Media & Markup", weight: 15 },
  performance: { name: "Performance & Security", weight: 15 },
};

/**
 * Deduction points per rule when triggered on a page (scaled by reach across evaluated pages).
 * Falls back to severity defaults (error: 25, warning: 10, notice: 4) if ruleId is not listed explicitly.
 */
export const RULE_DEDUCTION_POINTS: Record<string, { points: number; category: string; description: string }> = {
  // Indexability (30%)
  "noindex-set": { points: 100, category: "indexability", description: "pages excluded from search" },
  "status-code-error": { points: 100, category: "indexability", description: "pages returning HTTP 4xx/5xx" },
  "canonical-missing": { points: 10, category: "indexability", description: "no canonical URL declared" },
  "redirect-chain": { points: 15, category: "indexability", description: "reached through redirect chains" },
  "orphan-page": { points: 20, category: "indexability", description: "orphan pages with no internal inbound links" },
  "depth-deep": { points: 10, category: "indexability", description: "buried deeper than 3 clicks from seed" },
  "sitemap-missing-page": { points: 8, category: "indexability", description: "missing from sitemap" },
  "robots-blocked": { points: 50, category: "indexability", description: "blocked by robots.txt" },

  // Content (25%)
  "title-missing": { points: 40, category: "content", description: "missing title tag" },
  "title-too-long": { points: 12, category: "content", description: "title tag cut off in search results" },
  "title-too-short": { points: 5, category: "content", description: "very short title tag" },
  "meta-description-missing": { points: 20, category: "content", description: "missing meta description" },
  "meta-description-too-long": { points: 6, category: "content", description: "meta description cut off in search results" },
  "h1-missing": { points: 15, category: "content", description: "missing H1 heading" },
  "h1-multiple": { points: 8, category: "content", description: "multiple H1 headings" },
  "thin-content": { points: 20, category: "content", description: "thin content" },
  "content-duplicate": { points: 25, category: "content", description: "duplicate content" },

  // Links (15%)
  "broken-internal-link": { points: 15, category: "links", description: "dead internal links" },
  "broken-external-link": { points: 10, category: "links", description: "dead external links" },
  "links-none": { points: 20, category: "links", description: "page links to nothing else on site" },
  "anchor-missing": { points: 15, category: "links", description: "links without descriptive anchor text" },

  // Media & Markup (15%)
  "image-missing-alt": { points: 25, category: "media", description: "images missing alt text" },
  "image-heavy": { points: 15, category: "media", description: "heavy images (>200 KB)" },
  "structured-data-missing": { points: 15, category: "media", description: "no structured data" },
  "structured-data-invalid": { points: 20, category: "media", description: "unparseable or invalid structured data" },
  "og-missing": { points: 12, category: "media", description: "missing Open Graph metadata" },

  // Performance & Security (15%)
  "https-missing": { points: 40, category: "performance", description: "served over unencrypted plain HTTP" },
  "mixed-content": { points: 25, category: "performance", description: "mixed content resources on HTTPS" },
  "viewport-missing": { points: 15, category: "performance", description: "missing viewport tag (not mobile-friendly)" },
  "ttfb-slow": { points: 15, category: "performance", description: "slow server response (>800ms TTFB)" },
  "security-header-missing": { points: 5, category: "performance", description: "missing recommended security response headers" },
};

function defaultPointsForSeverity(severity: IssueSeverity): number {
  switch (severity) {
    case "error": return 25;
    case "warning": return 10;
    case "notice": return 4;
    default: return 5;
  }
}

function categoryForRule(ruleId: string, issueCategory?: string): string {
  if (RULE_DEDUCTION_POINTS[ruleId]) {
    return RULE_DEDUCTION_POINTS[ruleId].category;
  }
  if (issueCategory && CATEGORY_WEIGHTS[issueCategory.toLowerCase()]) {
    return issueCategory.toLowerCase();
  }
  return "content"; // Fallback category
}

export function gradeOf(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  if (score >= 40) return "E";
  return "F";
}

export function bandOf(score: number): string {
  if (score >= 90) return "very good";
  if (score >= 80) return "good";
  if (score >= 70) return "fair";
  if (score >= 60) return "needs work";
  if (score >= 40) return "poor";
  return "failing";
}

/**
 * Computes a transparent, category-weighted SEO health score.
 */
export function computeTransparentHealthScore(
  issues: Issue[],
  evaluatedPagesByRule: Map<string, number>,
  urlToPageId: Map<string, string>,
): TransparentHealthScoreResult {
  const affected = new Map<string, Set<string>>();
  const worstSeverity = new Map<string, IssueSeverity>();
  const issueCategoryMap = new Map<string, string>();

  for (const issue of issues) {
    if ((evaluatedPagesByRule.get(issue.ruleId) ?? 0) === 0) continue;
    const pageId = issue.pageId ?? (issue.url ? urlToPageId.get(issue.url) : undefined);
    const key = pageId ?? `__unanchored__:${issue.url ?? issue.ruleId}`;

    const set = affected.get(issue.ruleId) ?? new Set<string>();
    set.add(key);
    affected.set(issue.ruleId, set);

    if (issue.category) {
      issueCategoryMap.set(issue.ruleId, issue.category);
    }

    const prev = worstSeverity.get(issue.ruleId);
    if (prev === undefined || (issue.severity === "error" && prev !== "error")) {
      worstSeverity.set(issue.ruleId, issue.severity);
    }
  }

  const categoryDeductions: Record<string, Array<{ ruleId: string; points: number; reach: number; reason: string }>> = {
    indexability: [],
    content: [],
    links: [],
    media: [],
    performance: [],
  };

  const contributions: ScoreDeductionDetail[] = [];
  let totalDamage = 0;

  for (const [ruleId, evaluatedPages] of evaluatedPagesByRule) {
    if (evaluatedPages === 0) continue;
    const hit = affected.get(ruleId);
    if (!hit || hit.size === 0) continue;

    const severity = worstSeverity.get(ruleId) ?? "notice";
    const reach = Math.min(1, hit.size / evaluatedPages);

    const ruleDef = RULE_DEDUCTION_POINTS[ruleId];
    const basePoints = ruleDef ? ruleDef.points : defaultPointsForSeverity(severity);
    const catKey = categoryForRule(ruleId, issueCategoryMap.get(ruleId));
    const reason = ruleDef ? ruleDef.description : `rule ${ruleId} violations`;

    // Damage weighted by reach
    const damage = Math.round(basePoints * Math.sqrt(reach) * 10) / 10;
    totalDamage += damage;

    if (categoryDeductions[catKey]) {
      categoryDeductions[catKey].push({ ruleId, points: basePoints, reach, reason });
    }

    contributions.push({
      ruleId,
      severity,
      affectedPages: hit.size,
      evaluatedPages,
      reach,
      damage,
    });
  }

  contributions.sort((a, b) => b.damage - a.damage || (a.ruleId < b.ruleId ? -1 : 1));

  // Compute category scores (each starts at 100, minus lost points, clamped to [0, 100])
  const categories: CategoryScore[] = Object.entries(CATEGORY_WEIGHTS).map(([catKey, { name, weight }]) => {
    const deductions = categoryDeductions[catKey] ?? [];
    const totalCategoryPointsLost = deductions.reduce((sum, d) => sum + d.points * Math.sqrt(d.reach), 0);
    const score = Math.max(0, Math.min(100, Math.round(100 - totalCategoryPointsLost)));
    return { name, categoryKey: catKey, weight, score, deductions };
  });

  // Calculate weighted total score
  const totalWeight = categories.reduce((sum, c) => sum + c.weight, 0);
  const weightedSum = categories.reduce((sum, c) => sum + c.score * c.weight, 0);
  const finalScore = Math.round((weightedSum / totalWeight) * 10) / 10;

  return {
    score: finalScore,
    grade: gradeOf(finalScore),
    band: bandOf(finalScore),
    categories,
    contributions,
    totalDamage,
  };
}
