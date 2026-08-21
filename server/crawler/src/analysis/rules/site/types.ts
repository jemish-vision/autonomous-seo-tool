/**
 * Slice A4 — shared site-rule contract. Kept separate from index.ts so individual rule modules
 * import types from here (not from index.ts, which imports the rule modules) — avoids a cycle.
 */
import type {
  CrawledPage,
  CrawlSummary,
  FailureRecord,
  Issue,
  RobotsEvidence,
  RuleMeta,
  SitemapResult,
} from "../../../models/types";
import type { AnalysisConfig } from "../../config";

export interface SiteRuleContext {
  pages: CrawledPage[];
  failures: FailureRecord[];
  blocked: string[];
  sitemap: SitemapResult | null;
  robots: RobotsEvidence | null;
  summary: CrawlSummary | null;
}

export interface SiteRule {
  meta: RuleMeta;
  /** Pure: same ctx + config → same findings. null = rule could not run (data unavailable),
   * never a false fire. [] = ran, nothing found. */
  evaluate(ctx: SiteRuleContext, config: AnalysisConfig): Issue[] | null;
}
