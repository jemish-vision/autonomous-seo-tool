/**
 * Client-safe subset of the old server-only `lib/data-ai-recommendations.ts` (node:fs reader for
 * ai-recommendations.json). The report is fetched via the API; this file keeps the PURE grouping
 * helpers + the rule->category catalog (constant data) the UI imports.
 *
 * TODO(api): use @/api/issues (GET /api/crawls/:id/ai-recommendations) for the AiRecommendationReport payload.
 */
import type { AiRecommendation, AiRecommendationReport, AiRecommendationCategory } from "./ai-recommend/types";

export type {
  AiRecommendation,
  AiRecommendationReport,
  AiRecommendationCategory,
  AiRecommendationSkip,
} from "./ai-recommend/types";

/** rule id -> recommendation category. Copied verbatim from lib/ai-recommend/context.ts (pure,
 *  constant data — the deterministic rulebook mapping). */
const CATEGORY_BY_RULE: Record<string, AiRecommendationCategory> = {
  "image-missing-alt": "image-alt",
  "image-empty-alt": "image-alt",

  "title-missing": "title",
  "title-too-short": "title",
  "title-too-long": "title",
  "title-multiple": "title",

  "meta-description-missing": "meta-description",
  "meta-description-too-short": "meta-description",
  "meta-description-too-long": "meta-description",
  "meta-description-multiple": "meta-description",

  "h1-missing": "heading",
  "h1-multiple": "heading",
  "heading-hierarchy-skip": "heading",
  "heading-empty": "heading",
  "title-h1-mismatch": "heading",
  "long-content-no-subheadings": "heading",

  "og-missing": "social",
  "twitter-missing": "social",
  "og-incomplete": "social",

  "duplicate-title": "duplicate-content",
  "duplicate-description": "duplicate-content",
  "exact-duplicate-content": "duplicate-content-rewrite",
  "near-duplicate-content": "duplicate-content-rewrite",

  "no-structured-data": "structured-data",
  "structured-data-missing-type": "structured-data",
  "structured-data-missing-required-property": "structured-data",
  "structured-data-missing-recommended-property": "structured-data",
  "structured-data-parse-error": "structured-data",
  "structured-data-type-mismatch": "structured-data",
  "structured-data-unknown-type": "structured-data",
  "structured-data-no-json-ld": "structured-data",
  "video-embed-without-schema": "structured-data",

  "canonical-mismatch": "canonical",
  "canonical-target-invalid": "canonical",
  "canonical-chain": "canonical",
  "canonical-changed-by-js": "canonical",

  "vague-anchor-text": "internal-link-anchor",

  "thin-content": "content-brief",
  "low-text-ratio": "content-brief",
  "zero-word-content": "content-brief",
  "low-readability": "content-brief",
};

export function categoryForRule(ruleId: string): AiRecommendationCategory | null {
  return CATEGORY_BY_RULE[ruleId] ?? null;
}

export function supportedRuleIds(): string[] {
  return Object.keys(CATEGORY_BY_RULE);
}

/** ruleId -> every recommendation for that rule (across all affected pages/instances). */
export function recommendationsByRuleId(
  report: AiRecommendationReport | null,
): Map<string, AiRecommendation[]> {
  const map = new Map<string, AiRecommendation[]>();
  if (!report) return map;
  for (const rec of report.recommendations) {
    const list = map.get(rec.issueRuleId) ?? [];
    list.push(rec);
    map.set(rec.issueRuleId, list);
  }
  return map;
}

/** "ruleId::pageId" -> every recommendation for that (rule, page) pair. */
export function recommendationsByRuleAndPage(
  report: AiRecommendationReport | null,
): Map<string, AiRecommendation[]> {
  const map = new Map<string, AiRecommendation[]>();
  if (!report) return map;
  for (const rec of report.recommendations) {
    const key = `${rec.issueRuleId}::${rec.pageId ?? "site"}`;
    const list = map.get(key) ?? [];
    list.push(rec);
    map.set(key, list);
  }
  return map;
}
