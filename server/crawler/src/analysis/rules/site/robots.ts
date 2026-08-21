/** Slice A4 — robots-blocked inventory. Informational by default (spec: "(notice)") — these
 * URLs were never fetched, so this is evidence of robots.txt working as configured, not
 * necessarily a problem. */
import type { Issue, RuleMeta } from "../../../models/types";
import { isRuleEnabled, resolvedSeverity } from "./helpers";
import type { SiteRule } from "./types";

const meta: RuleMeta = {
  id: "robots-blocked",
  category: "robots",
  defaultSeverity: "notice",
  description: "A URL was blocked by robots.txt and never fetched during this crawl.",
  howToFix: "Confirm the block is intentional; update robots.txt if the page should be crawlable.",
  dataRequirements: ["blocked"],
};

export const robotsBlockedRule: SiteRule = {
  meta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(meta.id, config)) return null;
    const severity = resolvedSeverity(meta.id, meta.defaultSeverity, config);
    return ctx.blocked.map((url) => ({
      ruleId: meta.id,
      category: meta.category,
      severity,
      scope: "site" as const,
      url,
      pageId: null,
      message: `${url} is blocked by robots.txt`,
      howToFix: meta.howToFix,
      evidence: [{ field: "blocked", value: url }],
    }));
  },
};

/* Kishan's rules.js 'site-no-robots': not an error (everything is crawlable by default absent a
 * robots.txt) but it's the place to declare a sitemap and keep crawlers out of admin paths. */
const noUsableMeta: RuleMeta = {
  id: "no-usable-robots-txt",
  category: "robots",
  defaultSeverity: "notice",
  description: "No usable robots.txt was found (missing, empty, or failed to parse).",
  howToFix: "Add a robots.txt, even a permissive one, with a Sitemap: line.",
  dataRequirements: ["robots"],
};

export const noUsableRobotsTxtRule: SiteRule = {
  meta: noUsableMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(noUsableMeta.id, config)) return null;
    if (!ctx.robots) return null; // pre-feature run — data unavailable, not a pass
    if (ctx.robots.parseStatus === "ok") return [];
    const severity = resolvedSeverity(noUsableMeta.id, noUsableMeta.defaultSeverity, config);
    return [
      {
        ruleId: noUsableMeta.id,
        category: noUsableMeta.category,
        severity,
        scope: "site",
        url: ctx.robots.url,
        pageId: null,
        message: `robots.txt: ${ctx.robots.parseStatus}`,
        howToFix: noUsableMeta.howToFix,
        evidence: [{ field: "parseStatus", value: ctx.robots.parseStatus }],
      },
    ];
  },
};
