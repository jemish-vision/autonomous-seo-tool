/**
 * Client-safe subset of the old server-only `lib/data-issues.ts`. The node:fs readers
 * (readAnalysisReport / readFixPlan) are server-side — the analysis report is fetched via the API.
 * This file keeps ONLY the PURE view helpers the UI imports (grouping, severity, evidence
 * formatting, field->section mapping).
 *
 * TODO(api): use @/api/issues (useIssues / GET /api/crawls/:id/issues) for the AnalysisReport payload.
 */
import type { Issue, IssueSeverity } from "./types";

export const SEVERITY_RANK: Record<IssueSeverity, number> = { error: 3, warning: 2, notice: 1 };

export function severityTone(sev: IssueSeverity): "danger" | "warn" | "neutral" {
  return sev === "error" ? "danger" : sev === "warning" ? "warn" : "neutral";
}

export interface IssueRuleGroup {
  ruleId: string;
  category: string;
  severity: IssueSeverity;
  howToFix: string;
  affectedPageCount: number;
  affectedPercent: number;
  items: Issue[];
}

/**
 * Affected count = distinct pages touched by the rule: each issue's own pageId/url plus any
 * secondary pageIds carried in its evidence — a straight `items.length` would undercount those.
 */
export function groupIssuesByRule(issues: Issue[], pagesAnalyzed: number): IssueRuleGroup[] {
  const byRule = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = byRule.get(issue.ruleId) ?? [];
    list.push(issue);
    byRule.set(issue.ruleId, list);
  }

  const groups: IssueRuleGroup[] = [...byRule.entries()].map(([ruleId, items]) => {
    const affected = new Set<string>();
    for (const issue of items) {
      affected.add(issue.pageId ?? issue.url ?? `${ruleId}-site`);
      for (const e of issue.evidence) if (e.pageId) affected.add(e.pageId);
    }
    let severity: IssueSeverity = items[0].severity;
    for (const issue of items) {
      if (SEVERITY_RANK[issue.severity] > SEVERITY_RANK[severity]) severity = issue.severity;
    }
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

  return groups.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.affectedPageCount - a.affectedPageCount,
  );
}

/** Findings for one page: issues primarily about it, PLUS site-scope issues whose evidence
 *  references it. */
export function findingsForPage(report: { issues: Issue[] }, pageId: string): Issue[] {
  return report.issues.filter(
    (issue) => issue.pageId === pageId || issue.evidence.some((e) => e.pageId === pageId),
  );
}

const FIELD_SECTIONS: { prefix: string; section: string }[] = [
  { prefix: "title", section: "metadata" },
  { prefix: "titles", section: "metadata" },
  { prefix: "metaDescription", section: "metadata" },
  { prefix: "metaDescriptions", section: "metadata" },
  { prefix: "canonical", section: "metadata" },
  { prefix: "robots", section: "metadata" },
  { prefix: "headings", section: "headings" },
  { prefix: "links", section: "links" },
  { prefix: "images", section: "images" },
  { prefix: "videos", section: "media" },
  { prefix: "structuredData", section: "structured-data" },
  { prefix: "content", section: "content" },
  { prefix: "redirectChain", section: "redirects" },
  { prefix: "finalUrl", section: "redirects" },
  { prefix: "headers", section: "headers" },
  { prefix: "crawl", section: "crawl" },
  { prefix: "statusCode", section: "crawl" },
  { prefix: "performance", section: "crawl" },
];

export function sectionForField(field: string): string | null {
  const hit = FIELD_SECTIONS.find(
    (m) => field === m.prefix || field.startsWith(`${m.prefix}.`) || field.startsWith(`${m.prefix}[`),
  );
  return hit?.section ?? null;
}

export function formatEvidenceValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.length === 0 ? "[]" : value.map((v) => formatEvidenceValue(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
