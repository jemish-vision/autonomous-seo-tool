/** Slice A4 — orphan candidates, sourced from the crawler's own report.orphanCandidates
 * (report field + sitemap set algebra is already computed there — see spec S5). */
import type { Issue, RuleMeta } from "../../../models/types";
import { pageByPath, pageIdFor, pathnameOf, isRuleEnabled, resolvedSeverity } from "./helpers";
import type { SiteRule } from "./types";

const meta: RuleMeta = {
  id: "orphan-page",
  category: "orphans",
  defaultSeverity: "warning",
  description: "A crawled page has zero internal inlinks from any other crawled page (excluding the seed).",
  howToFix: "Add internal links to this page from relevant, already-linked pages.",
  dataRequirements: ["crawl"],
};

export const orphanPageRule: SiteRule = {
  meta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(meta.id, config)) return null;
    if (!ctx.summary) return null; // needs the crawl report's orphanCandidates — can't compute without it
    const severity = resolvedSeverity(meta.id, meta.defaultSeverity, config);
    const issues: Issue[] = [];
    for (const url of ctx.summary.orphanCandidates) {
      const path = pathnameOf(url);
      const page = path ? pageByPath(ctx.pages, path) : undefined;
      issues.push({
        ruleId: meta.id,
        category: meta.category,
        severity,
        scope: "site",
        url,
        pageId: page ? pageIdFor(page.normalizedUrl) : null,
        message: `No other crawled page links to ${url}`,
        howToFix: meta.howToFix,
        evidence: [{ field: "orphanCandidates", value: url }],
      });
    }
    return issues;
  },
};
