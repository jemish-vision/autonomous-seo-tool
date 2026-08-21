/** Slice A4 — hreflang reciprocity. v2-optional field: hreflang is `undefined` on pre-v2 runs
 * and simply may not be authored on a site at all — only runs when captured on >= 1 page. */
import type { Issue, RuleMeta } from "../../../models/types";
import { isRuleEnabled, pageByPath, pageIdFor, pathnameOf, primaryUrl, resolvedSeverity } from "./helpers";
import type { SiteRule } from "./types";

const meta: RuleMeta = {
  id: "hreflang-not-reciprocal",
  category: "hreflang",
  defaultSeverity: "warning",
  description: "Page A declares an hreflang alternate pointing at page B, but B has no hreflang entry pointing back at A.",
  howToFix: "Add the reciprocal hreflang tag on the target page.",
  dataRequirements: ["hreflang"],
};

export const hreflangReciprocityRule: SiteRule = {
  meta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(meta.id, config)) return null;
    const anyCaptured = ctx.pages.some((p) => p.hreflang && p.hreflang.length > 0);
    if (!anyCaptured) return null; // data-unavailable, not "no issues"
    const severity = resolvedSeverity(meta.id, meta.defaultSeverity, config);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      const selfPath = pathnameOf(primaryUrl(page));
      for (const entry of page.hreflang ?? []) {
        const targetPath = pathnameOf(entry.href);
        if (!targetPath || targetPath === selfPath) continue;
        const target = pageByPath(ctx.pages, targetPath);
        if (!target) continue; // target not crawled — inconclusive
        const targetPointsBack = (target.hreflang ?? []).some((back) => pathnameOf(back.href) === selfPath);
        if (targetPointsBack) continue;
        issues.push({
          ruleId: meta.id,
          category: meta.category,
          severity,
          scope: "site",
          url: primaryUrl(page),
          pageId: pageIdFor(page.normalizedUrl),
          message: `${primaryUrl(page)} declares hreflang="${entry.lang}" -> ${entry.href}, which has no reciprocal hreflang back`,
          howToFix: meta.howToFix,
          evidence: [
            { field: "hreflang", value: entry },
            { field: "hreflang", value: target.hreflang ?? [], pageId: pageIdFor(target.normalizedUrl) },
          ],
        });
      }
    }
    return issues;
  },
};
