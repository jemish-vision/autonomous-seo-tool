/**
 * Client-safe (no node:fs) — importable from "use client" components. Deliberately duplicates the
 * tiny severity-ordering + rule-grouping logic already in lib/data-issues.ts (do-not-touch, and
 * fs-importing so it can't be imported from client code) rather than re-exporting through it, so
 * the /issues screen's interactive filtering never needs a server round-trip.
 */
import type { Issue, IssueSeverity } from "./types";
import type { AutomationLevel } from "./data-issue-extras";

export const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 3, warning: 2, notice: 1 };

export function severityTone(sev: IssueSeverity): "danger" | "warn" | "neutral" {
  return sev === "error" ? "danger" : sev === "warning" ? "warn" : "neutral";
}

export interface RuleGroupLite {
  ruleId: string;
  category: string;
  severity: IssueSeverity;
  howToFix: string;
  affectedPageCount: number;
  affectedPercent: number;
  items: Issue[];
}

/** Same affected-count semantics as lib/data-issues.ts's groupIssuesByRule (own pageId/url plus
 *  any secondary pageIds carried in evidence) — kept identical on purpose so the two never disagree. */
export function groupIssuesByRule(issues: Issue[], pagesAnalyzed: number): RuleGroupLite[] {
  const byRule = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = byRule.get(issue.ruleId) ?? [];
    list.push(issue);
    byRule.set(issue.ruleId, list);
  }
  const groups: RuleGroupLite[] = [...byRule.entries()].map(([ruleId, items]) => {
    const affected = new Set<string>();
    for (const issue of items) {
      affected.add(issue.pageId ?? issue.url ?? `${ruleId}-site`);
      for (const e of issue.evidence) if (e.pageId) affected.add(e.pageId);
    }
    let severity: IssueSeverity = items[0].severity;
    for (const issue of items) if (SEVERITY_ORDER[issue.severity] > SEVERITY_ORDER[severity]) severity = issue.severity;
    return {
      ruleId,
      category: items[0].category,
      severity,
      howToFix: items[0].howToFix,
      affectedPageCount: affected.size,
      affectedPercent: pagesAnalyzed > 0 ? Math.round((affected.size / pagesAnalyzed) * 1000) / 10 : 0,
      items,
    };
  });
  return groups.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || b.affectedPageCount - a.affectedPageCount);
}

export function groupByArea(groups: RuleGroupLite[]): { category: string; groups: RuleGroupLite[]; worstSeverity: IssueSeverity }[] {
  const map = new Map<string, RuleGroupLite[]>();
  for (const g of groups) {
    const list = map.get(g.category) ?? [];
    list.push(g);
    map.set(g.category, list);
  }
  return [...map.entries()]
    .map(([category, list]) => ({
      category,
      groups: list,
      worstSeverity: list.reduce<IssueSeverity>((worst, g) => (SEVERITY_ORDER[g.severity] > SEVERITY_ORDER[worst] ? g.severity : worst), "notice"),
    }))
    .sort((a, b) => SEVERITY_ORDER[b.worstSeverity] - SEVERITY_ORDER[a.worstSeverity]);
}

// Worst-pages ranking now comes straight from report.worstPages (src/analysis/priority/worstPages.ts
// — real per-rule severityWeight x confidence harm, computed server-side). The old client-side
// weighted-severity-count approximation was removed rather than kept as a second, disagreeing
// number under the same "worst pages" name.

export interface RuleDiffRow {
  ruleId: string;
  category: string;
  severity: IssueSeverity;
  current: number;
  previous: number;
  delta: number;
  status: "new" | "improved" | "worsened" | "unchanged" | "resolved";
}

export function diffSinceLastCrawl(currentIssues: Issue[], previousRuleCounts: Record<string, number> | null): RuleDiffRow[] {
  const currentByRule = new Map<string, { category: string; severity: IssueSeverity; count: number }>();
  for (const issue of currentIssues) {
    const entry = currentByRule.get(issue.ruleId) ?? { category: issue.category, severity: issue.severity, count: 0 };
    entry.count++;
    if (SEVERITY_ORDER[issue.severity] > SEVERITY_ORDER[entry.severity]) entry.severity = issue.severity;
    currentByRule.set(issue.ruleId, entry);
  }
  const prev = previousRuleCounts ?? {};
  const rows: RuleDiffRow[] = [];
  const seen = new Set<string>();
  for (const [ruleId, entry] of currentByRule) {
    seen.add(ruleId);
    const previous = prev[ruleId] ?? 0;
    const delta = entry.count - previous;
    rows.push({
      ruleId,
      category: entry.category,
      severity: entry.severity,
      current: entry.count,
      previous,
      delta,
      status: previous === 0 ? "new" : delta === 0 ? "unchanged" : delta < 0 ? "improved" : "worsened",
    });
  }
  for (const ruleId of Object.keys(prev)) {
    if (seen.has(ruleId)) continue;
    rows.push({ ruleId, category: "—", severity: "notice", current: 0, previous: prev[ruleId], delta: -prev[ruleId], status: "resolved" });
  }
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export interface IssueFilterState {
  q: string;
  severity: IssueSeverity | null;
  category: string | null;
  automation: AutomationLevel | "not-classified" | null;
}

export function filterIssues(
  issues: Issue[],
  state: IssueFilterState,
  automationByRule: Map<string, AutomationLevel>,
  pageIdToUrl: Map<string, string>,
): Issue[] {
  let items = issues;
  if (state.severity) items = items.filter((i) => i.severity === state.severity);
  if (state.category) items = items.filter((i) => i.category === state.category);
  if (state.automation) {
    items = items.filter((i) => {
      const level = automationByRule.get(i.ruleId) ?? null;
      return state.automation === "not-classified" ? level === null : level === state.automation;
    });
  }
  if (state.q.trim()) {
    const needle = state.q.trim().toLowerCase();
    items = items.filter((i) => {
      const url = i.url ?? (i.pageId ? pageIdToUrl.get(i.pageId) : undefined) ?? "";
      return i.message.toLowerCase().includes(needle) || i.ruleId.toLowerCase().includes(needle) || url.toLowerCase().includes(needle);
    });
  }
  return items;
}
