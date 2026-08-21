/** Per-run breakdown: which rules actually fired in this run, with derived confidence + effort.
 * Complements registry.classifyRulebook(), which answers the rulebook-wide question instead. */
import type { AnalysisReport, Issue } from "../../models/types";
import { deriveEffort } from "./effort";
import { buildCatalogMap, type CatalogEntry } from "./registry";
import { DEFAULT_CLASSIFICATION } from "./classification";
import { TIER_CONFIDENCE, type AutomationLevel, type EffortResult } from "./types";

export interface RuleAutomationSummary {
  ruleId: string;
  category: string;
  scope: "page" | "site";
  automation: AutomationLevel;
  confidence: number;
  reviewed: boolean;
  rationale: string;
  /** Distinct pages/URLs this rule affected in this run (health-score-style dedup: pageId,
   * falling back to url, falling back to an unanchored bucket). */
  affectedPages: number;
  /** Total Issue records (an issue can bundle several evidence items, e.g. mixed-content). */
  instances: number;
  effort: EffortResult;
}

export interface AutomationReport {
  runId: string;
  generatedAt: string;
  pagesAnalyzed: number;
  counts: Record<AutomationLevel, number>;
  rules: RuleAutomationSummary[];
  /** Rule ids that fired in this run but used the conservative default (never reviewed). */
  unreviewedRuleIds: string[];
}

function affectedKey(issue: Issue, ruleId: string): string {
  return issue.pageId ?? issue.url ?? `unanchored:${ruleId}`;
}

export function buildAutomationReport(analysis: AnalysisReport): AutomationReport {
  const catalog = buildCatalogMap();

  const byRule = new Map<string, Issue[]>();
  for (const issue of analysis.issues) {
    const list = byRule.get(issue.ruleId);
    if (list) list.push(issue);
    else byRule.set(issue.ruleId, [issue]);
  }

  const rules: RuleAutomationSummary[] = [];
  const counts: Record<AutomationLevel, number> = { "auto-safe": 0, "auto-with-review": 0, "human-only": 0 };
  const unreviewedRuleIds: string[] = [];

  for (const [ruleId, issues] of byRule) {
    const entry: CatalogEntry | undefined = catalog.get(ruleId);
    const scope = entry?.scope ?? issues[0]!.scope;
    const resolved = entry ?? { ...DEFAULT_CLASSIFICATION, id: ruleId, category: issues[0]!.category, scope, defaultSeverity: issues[0]!.severity, confidence: TIER_CONFIDENCE[DEFAULT_CLASSIFICATION.tier], reviewed: false };
    const affected = new Set(issues.map((i) => affectedKey(i, ruleId)));
    const effort = deriveEffort({
      automation: resolved.automation,
      scope,
      affectedPages: affected.size,
      pagesAnalyzed: analysis.pagesAnalyzed,
    });

    counts[resolved.automation]++;
    if (!resolved.reviewed) unreviewedRuleIds.push(ruleId);

    rules.push({
      ruleId,
      category: entry?.category ?? issues[0]!.category,
      scope,
      automation: resolved.automation,
      confidence: resolved.confidence,
      reviewed: resolved.reviewed,
      rationale: resolved.rationale,
      affectedPages: affected.size,
      instances: issues.length,
      effort,
    });
  }

  rules.sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  return {
    runId: analysis.runId,
    generatedAt: new Date().toISOString(),
    pagesAnalyzed: analysis.pagesAnalyzed,
    counts,
    rules,
    unreviewedRuleIds: unreviewedRuleIds.sort(),
  };
}
