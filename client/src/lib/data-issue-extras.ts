/**
 * Client type shim for the old server-only `lib/data-issue-extras.ts` (node:fs).
 * The runtime readers (automation-report.json / fix-plan.json / health history) are server-side —
 * fetch them through the API instead. This file keeps ONLY the shared TYPES the UI imports.
 *
 * TODO(api): use @/api/issues (or a dedicated hook) for automation report / fix plan / health history.
 */
import type { IssueSeverity } from "./types";

export type { AutomationLevel, FixPlan, FixPlanItem, FixPlanSkip } from "./types";

export interface RuleAutomationSummary {
  ruleId: string;
  category: string;
  scope: "page" | "site";
  automation: import("./types").AutomationLevel;
  confidence: number;
  reviewed: boolean;
  rationale: string;
  affectedPages: number;
  instances: number;
  effort: { level: "low" | "medium" | "high"; why: string };
}

export interface AutomationReport {
  runId: string;
  generatedAt: string;
  pagesAnalyzed: number;
  counts: Record<import("./types").AutomationLevel, number>;
  rules: RuleAutomationSummary[];
  unreviewedRuleIds: string[];
}

export interface HealthHistoryPoint {
  runId: string;
  startedAt: string;
  healthScore: number | null;
  counts: Record<IssueSeverity, number> | null;
  ruleCounts: Record<string, number> | null;
}

/** Pure helper — safe on the client once a report has been fetched. */
export function automationByRuleId(
  report: AutomationReport | null,
): Map<string, RuleAutomationSummary> {
  const map = new Map<string, RuleAutomationSummary>();
  if (!report) return map;
  for (const r of report.rules) map.set(r.ruleId, r);
  return map;
}
