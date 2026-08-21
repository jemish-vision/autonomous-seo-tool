/** Slice A4 — redirect chains (>1 hop) and redirect loops. */
import type { Issue, RuleMeta } from "../../../models/types";
import { isRuleEnabled, pageIdFor, primaryUrl, resolvedSeverity } from "./helpers";
import type { SiteRule } from "./types";

const chainMeta: RuleMeta = {
  id: "redirect-chain",
  category: "redirects",
  defaultSeverity: "warning",
  description: "A page's redirect chain has more hops than the configured maximum.",
  howToFix: "Point the link directly at the final destination URL, collapsing the chain to one hop.",
  dataRequirements: ["redirectChain"],
};

export const redirectChainRule: SiteRule = {
  meta: chainMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(chainMeta.id, config)) return null;
    const severity = resolvedSeverity(chainMeta.id, chainMeta.defaultSeverity, config);
    const max = config.thresholds.redirectChainMax;
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (page.redirectChain.length <= max) continue;
      issues.push({
        ruleId: chainMeta.id,
        category: chainMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} redirects through ${page.redirectChain.length} hops before landing on ${page.finalUrl ?? "?"}`,
        howToFix: chainMeta.howToFix,
        threshold: `redirectChain.length > ${max} (was ${page.redirectChain.length})`,
        evidence: [{ field: "redirectChain", value: page.redirectChain }],
      });
    }
    return issues;
  },
};

const loopMeta: RuleMeta = {
  id: "redirect-loop",
  category: "redirects",
  defaultSeverity: "error",
  description: "A URL redirects back to itself (directly or via a cycle) and never resolves.",
  howToFix: "Fix the redirect rule so the chain terminates at a real page.",
  dataRequirements: ["failures"],
};

export const redirectLoopRule: SiteRule = {
  meta: loopMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(loopMeta.id, config)) return null;
    const severity = resolvedSeverity(loopMeta.id, loopMeta.defaultSeverity, config);
    return ctx.failures
      .filter((f) => f.reason === "redirect-loop")
      .map((f) => ({
        ruleId: loopMeta.id,
        category: loopMeta.category,
        severity,
        scope: "site" as const,
        url: f.url,
        pageId: null,
        message: `${f.url} is a redirect loop and never resolves`,
        howToFix: loopMeta.howToFix,
        evidence: [{ field: "reason", value: f.reason }],
      }));
  },
};

/* Kishan's rules.js 'site-redirect-to-error': the crawler DID resolve the chain (this is a
 * CrawledPage, not a FailureRecord) — it just landed on an error. A redirect that resolves to a
 * loop has its own rule above and must not double-fire here. */
const toErrorMeta: RuleMeta = {
  id: "redirect-to-error",
  category: "redirects",
  defaultSeverity: "error",
  description: "A page's redirect chain lands on a URL that itself returns a 4xx/5xx status.",
  howToFix: "Repoint the redirect at a live page — a redirect landing on an error looks deliberate and still goes nowhere.",
  dataRequirements: ["redirectChain"],
};

export const redirectToErrorRule: SiteRule = {
  meta: toErrorMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(toErrorMeta.id, config)) return null;
    const severity = resolvedSeverity(toErrorMeta.id, toErrorMeta.defaultSeverity, config);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (page.redirectChain.length === 0) continue;
      if (page.statusCode === null || page.statusCode < 400) continue;
      issues.push({
        ruleId: toErrorMeta.id,
        category: toErrorMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} redirects through ${page.redirectChain.length} hop(s) and lands on status ${page.statusCode}`,
        howToFix: toErrorMeta.howToFix,
        evidence: [
          { field: "redirectChain", value: page.redirectChain },
          { field: "statusCode", value: page.statusCode },
        ],
      });
    }
    return issues;
  },
};

const temporaryMeta: RuleMeta = {
  id: "redirect-temporary",
  category: "redirects",
  defaultSeverity: "notice",
  description: "A page's redirect chain includes a temporary (302/307) hop.",
  howToFix: "If the move is permanent, change it to a 301 (or 308 where the request method must be preserved) so ranking signals pass to the new URL.",
  dataRequirements: ["redirectChain"],
};

export const redirectTemporaryRule: SiteRule = {
  meta: temporaryMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(temporaryMeta.id, config)) return null;
    const severity = resolvedSeverity(temporaryMeta.id, temporaryMeta.defaultSeverity, config);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      const tempHops = page.redirectChain.filter((r) => r.statusCode === 302 || r.statusCode === 307);
      if (tempHops.length === 0) continue;
      issues.push({
        ruleId: temporaryMeta.id,
        category: temporaryMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} redirects via ${tempHops.length} temporary (302/307) hop(s) — confirm the move is genuinely temporary`,
        howToFix: temporaryMeta.howToFix,
        evidence: [{ field: "redirectChain", value: page.redirectChain }],
      });
    }
    return issues;
  },
};

const singleHopMeta: RuleMeta = {
  id: "redirect-single-hop",
  category: "redirects",
  defaultSeverity: "notice",
  description: "A page is reached through exactly one redirect hop (not a chain — that's redirect-chain's finding).",
  howToFix: "Where practical, update the source link/bookmark to point directly at the destination and skip the round trip.",
  dataRequirements: ["redirectChain"],
};

export const redirectSingleHopRule: SiteRule = {
  meta: singleHopMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(singleHopMeta.id, config)) return null;
    const severity = resolvedSeverity(singleHopMeta.id, singleHopMeta.defaultSeverity, config);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (page.redirectChain.length !== 1) continue;
      issues.push({
        ruleId: singleHopMeta.id,
        category: singleHopMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} is reached through a single redirect hop (HTTP ${page.redirectChain[0]!.statusCode})`,
        howToFix: singleHopMeta.howToFix,
        evidence: [{ field: "redirectChain", value: page.redirectChain }],
      });
    }
    return issues;
  },
};
