/** Reads the live rule registries at call time (never a hardcoded id list) so this stays correct
 * as sibling slices add rules under src/analysis/rules/**. Read-only imports — never edits them. */
import type { IssueSeverity } from "../../models/types";
import { pageRules } from "../rules/page/index";
import { siteRules } from "../rules/site/index";
import { CLASSIFICATIONS, DEFAULT_CLASSIFICATION } from "./classification";
import { TIER_CONFIDENCE, type AutomationLevel, type DetectionTier } from "./types";

export interface CatalogEntry {
  id: string;
  category: string;
  scope: "page" | "site";
  defaultSeverity: IssueSeverity;
  automation: AutomationLevel;
  tier: DetectionTier;
  confidence: number;
  rationale: string;
  /** false = this id fell back to DEFAULT_CLASSIFICATION — either a rule added after this
   * slice's audit, or a registry bug. Surfaced so nobody mistakes silence for review. */
  reviewed: boolean;
}

function classify(
  id: string,
  category: string,
  defaultSeverity: IssueSeverity,
  scope: "page" | "site",
): CatalogEntry {
  const c = CLASSIFICATIONS[id];
  const resolved = c ?? DEFAULT_CLASSIFICATION;
  return {
    id,
    category,
    scope,
    defaultSeverity,
    automation: resolved.automation,
    tier: resolved.tier,
    confidence: TIER_CONFIDENCE[resolved.tier],
    rationale: resolved.rationale,
    reviewed: c !== undefined,
  };
}

/** Full current rulebook, page + site, classified. Independent of any crawl run. */
export function buildCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const rule of pageRules()) {
    entries.push(classify(rule.meta.id, rule.meta.category, rule.meta.defaultSeverity, "page"));
  }
  for (const rule of siteRules()) {
    entries.push(classify(rule.meta.id, rule.meta.category, rule.meta.defaultSeverity, "site"));
  }
  return entries;
}

export function buildCatalogMap(): Map<string, CatalogEntry> {
  return new Map(buildCatalog().map((e) => [e.id, e]));
}

export interface RulebookCounts {
  totalRules: number;
  "auto-safe": number;
  "auto-with-review": number;
  "human-only": number;
  reviewedCount: number;
  unreviewedIds: string[];
}

/** Answers "classify every rule in the current rulebook" — counts per automation class,
 * independent of any particular crawl run. */
export function classifyRulebook(): { catalog: CatalogEntry[]; counts: RulebookCounts } {
  const catalog = buildCatalog();
  const counts: RulebookCounts = {
    totalRules: catalog.length,
    "auto-safe": 0,
    "auto-with-review": 0,
    "human-only": 0,
    reviewedCount: 0,
    unreviewedIds: [],
  };
  for (const entry of catalog) {
    counts[entry.automation]++;
    if (entry.reviewed) counts.reviewedCount++;
    else counts.unreviewedIds.push(entry.id);
  }
  return { catalog, counts };
}
