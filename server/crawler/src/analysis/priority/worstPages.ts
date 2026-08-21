/** Worst-pages ranking — pages ordered by aggregate weighted harm: sum of
 * severityWeight(issue) x confidence(rule) across every (non-muted) issue anchored to the page.
 * Deliberately independent of page importance (that axis already lives in per-finding priority)
 * so this answers a different question: which pages have the worst defect concentration. */
import type { Issue } from "../../models/types";
import { buildCatalogMap } from "../automation/registry";
import { SEVERITY_WEIGHT } from "./priority";
import type { WorstPageEntry } from "./types";

export interface ComputeWorstPagesInput {
  issues: Issue[];
  urlToPageId: Map<string, string>;
  pageUrlById: Map<string, string>;
  mutedRuleIds: Set<string>;
  top?: number;
}

export function computeWorstPages(input: ComputeWorstPagesInput): WorstPageEntry[] {
  const catalog = buildCatalogMap();
  const byPage = new Map<string, { harm: number; issueCount: number; ruleHarm: Map<string, number> }>();

  for (const issue of input.issues) {
    if (input.mutedRuleIds.has(issue.ruleId)) continue;
    const pageId = issue.pageId ?? (issue.url ? input.urlToPageId.get(issue.url) : undefined);
    if (!pageId) continue; // site-scope / unanchored findings don't attribute to one page

    const confidence = catalog.get(issue.ruleId)?.confidence ?? 0.7;
    const weight = SEVERITY_WEIGHT[issue.severity] * confidence;

    let entry = byPage.get(pageId);
    if (!entry) {
      entry = { harm: 0, issueCount: 0, ruleHarm: new Map() };
      byPage.set(pageId, entry);
    }
    entry.harm += weight;
    entry.issueCount += 1;
    entry.ruleHarm.set(issue.ruleId, (entry.ruleHarm.get(issue.ruleId) ?? 0) + weight);
  }

  const list: WorstPageEntry[] = [...byPage.entries()].map(([pageId, e]) => ({
    pageId,
    url: input.pageUrlById.get(pageId) ?? pageId,
    harm: Math.round(e.harm * 100) / 100,
    issueCount: e.issueCount,
    topRuleIds: [...e.ruleHarm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ruleId]) => ruleId),
  }));

  list.sort((a, b) => b.harm - a.harm || b.issueCount - a.issueCount || a.pageId.localeCompare(b.pageId));
  return input.top ? list.slice(0, input.top) : list;
}
