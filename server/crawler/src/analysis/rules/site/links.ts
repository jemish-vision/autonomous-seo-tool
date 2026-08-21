/** Slice A4 — weakly-linked pages, canonical-target validity, broken internal links (MF-3: the
 * latter two are cross-page lookups, hence site-scope even though each finding anchors to a
 * single source page). */
import type { Issue, RuleMeta } from "../../../models/types";
import {
  buildInlinkOccurrences,
  httpFailurePaths,
  httpFailureStatusByPath,
  AUTH_REQUIRED_STATUSES,
  isRuleEnabled,
  pageByPath,
  pageIdFor,
  pathnameOf,
  primaryUrl,
  resolvedSeverity,
} from "./helpers";
import type { SiteRule, SiteRuleContext } from "./types";

const weaklyLinkedMeta: RuleMeta = {
  id: "weakly-linked",
  category: "links",
  defaultSeverity: "warning",
  description:
    "A crawled non-seed page has at most thresholds.weakInlinkCount internal inlinks (self-links excluded). " +
    "Zero inlinks is orphan-page's finding, not this one.",
  howToFix: "Add more internal links to this page from relevant content.",
  dataRequirements: ["crawl"],
};

export const weaklyLinkedRule: SiteRule = {
  meta: weaklyLinkedMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(weaklyLinkedMeta.id, config)) return null;
    const severity = resolvedSeverity(weaklyLinkedMeta.id, weaklyLinkedMeta.defaultSeverity, config);
    const want = config.thresholds.weakInlinkCount;
    const occurrences = buildInlinkOccurrences(ctx.pages);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (page.crawl.depth === 0) continue; // seed excluded — not meaningfully "weakly linked"
      const path = pathnameOf(primaryUrl(page));
      if (!path) continue;
      const occ = occurrences.get(path) ?? [];
      // Threshold, not equality: raising weakInlinkCount to 3 must catch 1, 2 and 3 inlinks too.
      if (occ.length === 0 || occ.length > want) continue;
      const sources = occ.map((o) => primaryUrl(o.source));
      issues.push({
        ruleId: weaklyLinkedMeta.id,
        category: weaklyLinkedMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} has only ${occ.length} internal inlink(s), from: ${sources.join(", ")}`,
        howToFix: weaklyLinkedMeta.howToFix,
        threshold: `inlink count <= ${want} (was ${occ.length})`,
        evidence: occ.map((o) => ({
          field: `links[${o.linkIndex}].targetNormalized`,
          value: o.link.targetNormalized ?? o.link.target,
          pageId: pageIdFor(o.source.normalizedUrl),
        })),
      });
    }
    return issues;
  },
};

const canonicalMeta: RuleMeta = {
  id: "canonical-target-invalid",
  category: "canonical",
  defaultSeverity: "warning",
  description: "A page's canonical points at a URL that itself 4xx/5xxs, redirects, or is noindexed.",
  howToFix: "Point the canonical at a live, indexable, 200-status URL.",
  dataRequirements: ["canonical"],
};

function canonicalTargetProblem(ctx: SiteRuleContext, targetPath: string, failedPaths: Set<string>): string | null {
  if (failedPaths.has(targetPath)) return "target returns a 4xx/5xx status";
  const targetPage = pageByPath(ctx.pages, targetPath);
  if (!targetPage) return null; // never crawled, not in failures — inconclusive, not flagged
  if (targetPage.statusCode !== null && targetPage.statusCode >= 400) return `target returns ${targetPage.statusCode}`;
  if (targetPage.redirectChain.length > 0) return "target itself redirects elsewhere";
  if (targetPage.robots.noindex) return "target is noindex";
  return null;
}

export const canonicalTargetValidityRule: SiteRule = {
  meta: canonicalMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(canonicalMeta.id, config)) return null;
    const severity = resolvedSeverity(canonicalMeta.id, canonicalMeta.defaultSeverity, config);
    const failedPaths = httpFailurePaths(ctx.failures);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (!page.canonical) continue;
      const selfPath = pathnameOf(primaryUrl(page));
      const targetPath = pathnameOf(page.canonical);
      if (!targetPath || targetPath === selfPath) continue;
      const problem = canonicalTargetProblem(ctx, targetPath, failedPaths);
      if (!problem) continue;
      const targetPage = pageByPath(ctx.pages, targetPath);
      issues.push({
        ruleId: canonicalMeta.id,
        category: canonicalMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `Canonical on ${primaryUrl(page)} points at ${page.canonical}, but ${problem}`,
        howToFix: canonicalMeta.howToFix,
        evidence: [
          { field: "canonical", value: page.canonical },
          ...(targetPage ? [{ field: "statusCode", value: targetPage.statusCode, pageId: pageIdFor(targetPage.normalizedUrl) }] : []),
        ],
      });
    }
    return issues;
  },
};

const brokenLinkMeta: RuleMeta = {
  id: "broken-internal-link",
  category: "links",
  defaultSeverity: "error",
  description:
    "An internal link's target failed (4xx/5xx) or was recorded as a crawl failure. " +
    "401/403 targets are excluded — those are auth-required-link, not broken.",
  howToFix: "Fix or remove the link so it points at a live page.",
  dataRequirements: ["links"],
};

/** Effective status of a link target: the crawled record's, else the recorded failure's. */
function targetStatus(ctx: SiteRuleContext, targetPath: string, failedStatus: Map<string, number | null>): number | null {
  const targetPage = pageByPath(ctx.pages, targetPath);
  if (targetPage?.statusCode != null) return targetPage.statusCode;
  return failedStatus.get(targetPath) ?? null;
}

export const brokenInternalLinkRule: SiteRule = {
  meta: brokenLinkMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(brokenLinkMeta.id, config)) return null;
    const severity = resolvedSeverity(brokenLinkMeta.id, brokenLinkMeta.defaultSeverity, config);
    const failedPaths = httpFailurePaths(ctx.failures);
    const failedStatus = httpFailureStatusByPath(ctx.failures);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      page.links.forEach((link, index) => {
        if (link.type !== "internal") return;
        const targetPath = pathnameOf(link.targetNormalized ?? link.target);
        if (!targetPath) return;
        const targetPage = pageByPath(ctx.pages, targetPath);
        const isBroken =
          failedPaths.has(targetPath) || (targetPage?.statusCode !== null && targetPage?.statusCode !== undefined && targetPage.statusCode >= 400);
        if (!isBroken) return;
        const status = targetStatus(ctx, targetPath, failedStatus);
        if (status !== null && AUTH_REQUIRED_STATUSES.has(status)) return; // auth wall, not a dead link
        issues.push({
          ruleId: brokenLinkMeta.id,
          category: brokenLinkMeta.category,
          severity,
          scope: "site",
          url: primaryUrl(page),
          pageId: pageIdFor(page.normalizedUrl),
          message: `${primaryUrl(page)} links to ${link.target}, which fails${status === null ? "" : ` (${status})`}`,
          howToFix: brokenLinkMeta.howToFix,
          evidence: [{ field: `links[${index}].targetNormalized`, value: link.targetNormalized ?? link.target }],
        });
      });
    }
    return issues;
  },
};

const authRequiredLinkMeta: RuleMeta = {
  id: "auth-required-link",
  category: "links",
  defaultSeverity: "notice",
  description:
    "An internal link points at a target that returned 401 or 403. On an anonymous crawl this is " +
    "expected for a genuinely protected area, so it is reported as coverage information rather " +
    "than a defect. It is only a real problem if the target was meant to be public.",
  howToFix:
    "If the area is meant to be public, fix the access control. If it is genuinely protected, " +
    "re-crawl with credentials to cover it.",
  dataRequirements: ["links"],
};

export const authRequiredLinkRule: SiteRule = {
  meta: authRequiredLinkMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(authRequiredLinkMeta.id, config)) return null;
    const severity = resolvedSeverity(authRequiredLinkMeta.id, authRequiredLinkMeta.defaultSeverity, config);
    const failedStatus = httpFailureStatusByPath(ctx.failures);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      page.links.forEach((link, index) => {
        if (link.type !== "internal") return;
        const targetPath = pathnameOf(link.targetNormalized ?? link.target);
        if (!targetPath) return;
        const status = targetStatus(ctx, targetPath, failedStatus);
        if (status === null || !AUTH_REQUIRED_STATUSES.has(status)) return;
        issues.push({
          ruleId: authRequiredLinkMeta.id,
          category: authRequiredLinkMeta.category,
          severity,
          scope: "site",
          url: primaryUrl(page),
          pageId: pageIdFor(page.normalizedUrl),
          message: `${primaryUrl(page)} links to ${link.target}, which requires authentication (${status})`,
          howToFix: authRequiredLinkMeta.howToFix,
          evidence: [{ field: `links[${index}].targetNormalized`, value: link.targetNormalized ?? link.target }],
        });
      });
    }
    return issues;
  },
};

/* Kishan's rules.js 'canonical-chain': a canonical is meant to name the FINAL destination, not
 * the next hop. Distinct from canonicalTargetValidityRule above, which only checks the target's
 * own status/redirect/noindex state, not whether the target ITSELF canonicalises onward. */
const canonicalChainMeta: RuleMeta = {
  id: "canonical-chain",
  category: "canonical",
  defaultSeverity: "warning",
  description: "A page's canonical points at a page that itself canonicalises somewhere else.",
  howToFix: "Point every canonical in the chain straight at the final URL.",
  dataRequirements: ["canonical"],
};

export const canonicalChainRule: SiteRule = {
  meta: canonicalChainMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(canonicalChainMeta.id, config)) return null;
    const severity = resolvedSeverity(canonicalChainMeta.id, canonicalChainMeta.defaultSeverity, config);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (!page.canonical) continue;
      const selfPath = pathnameOf(primaryUrl(page));
      const firstPath = pathnameOf(page.canonical);
      if (!firstPath || firstPath === selfPath) continue;
      const middle = pageByPath(ctx.pages, firstPath);
      // pageByPath matches on EITHER primaryUrl OR finalUrl. Two real false positives found by
      // spot-check both had this shape: several source URLs redirect to the same undercrawled
      // destination and each self-canonicalises to it (arena.ai/cookie-policy; three separate
      // nousresearch.com aliases → /collections/products) — pageByPath resolves "middle" to one
      // of those ALIASES, not a genuinely distinct second hop, because the destination itself was
      // never independently crawled at its own URL. Guard on both: middle being literally `page`
      // (own finalUrl matched its own canonical), and middle's canonical simply agreeing with
      // where middle itself already lands (finalUrl) — neither is a further hop.
      if (!middle?.canonical || middle === page) continue;
      const middlePath = pathnameOf(primaryUrl(middle));
      const middleFinalPath = pathnameOf(middle.finalUrl);
      const secondPath = pathnameOf(middle.canonical);
      if (!secondPath || secondPath === middlePath || secondPath === middleFinalPath) continue;
      issues.push({
        ruleId: canonicalChainMeta.id,
        category: canonicalChainMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `Canonical chain: ${primaryUrl(page)} → ${page.canonical} → ${middle.canonical}`,
        howToFix: canonicalChainMeta.howToFix,
        evidence: [
          { field: "canonical", value: page.canonical },
          { field: "canonical", value: middle.canonical, pageId: pageIdFor(middle.normalizedUrl) },
        ],
      });
    }
    return issues;
  },
};

const excessiveLinksMeta: RuleMeta = {
  id: "excessive-links",
  category: "links",
  defaultSeverity: "notice",
  description: "A page has more internal+external links than the configured maximum.",
  howToFix: "Paginate long listings and trim navigation that repeats every link on every page.",
  dataRequirements: ["links"],
};

export const excessiveLinksRule: SiteRule = {
  meta: excessiveLinksMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(excessiveLinksMeta.id, config)) return null;
    const severity = resolvedSeverity(excessiveLinksMeta.id, excessiveLinksMeta.defaultSeverity, config);
    const max = config.thresholds.excessiveLinksCount ?? 300;
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (page.links.length <= max) continue;
      const internal = page.links.filter((l) => l.type === "internal").length;
      const external = page.links.length - internal;
      issues.push({
        ruleId: excessiveLinksMeta.id,
        category: excessiveLinksMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} has ${page.links.length} links (${internal} internal, ${external} external)`,
        howToFix: excessiveLinksMeta.howToFix,
        threshold: `links.length ${page.links.length} > max ${max}`,
        evidence: [{ field: "links", value: page.links.length }],
      });
    }
    return issues;
  },
};

/* "page-buried-too-deep" is NOT defined here — site/orphans.ts (site-structure family, not
 * mine) already implements it (config key thresholds.maxCrawlDepth). Checked site/index.ts
 * before registering to avoid a duplicate ruleId double-counting the same finding. */

/* Kishan's rules.js VAGUE_ANCHOR list — anchor text that describes the click rather than the
 * destination. Not a business threshold (nothing to tune per-site), so kept as a local constant
 * rather than routed through config, matching link-consistency.ts's stripWww() precedent. */
const VAGUE_ANCHOR = /^(click here|here|read more|more|learn more|find out more|continue|continue reading|this|this page|link|download|see more|view more|details|go)$/i;

const vagueAnchorMeta: RuleMeta = {
  id: "vague-anchor-text",
  category: "links",
  defaultSeverity: "notice",
  description: "A link's anchor text describes the action ('click here', 'read more') rather than the destination.",
  howToFix: "Say where the link goes: \"read the pricing guide\" rather than \"read more\".",
  dataRequirements: ["links"],
};

export const vagueAnchorTextRule: SiteRule = {
  meta: vagueAnchorMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(vagueAnchorMeta.id, config)) return null;
    const severity = resolvedSeverity(vagueAnchorMeta.id, vagueAnchorMeta.defaultSeverity, config);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      const hits = page.links
        .map((link, index) => ({ link, index }))
        .filter(({ link }) => link.anchor && VAGUE_ANCHOR.test(link.anchor.trim()));
      if (hits.length === 0) continue;
      const distinct = [...new Set(hits.map(({ link }) => `"${link.anchor.trim()}"`))].slice(0, 3);
      issues.push({
        ruleId: vagueAnchorMeta.id,
        category: vagueAnchorMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} has ${hits.length} link(s) with uninformative anchor text: ${distinct.join(", ")}`,
        howToFix: vagueAnchorMeta.howToFix,
        evidence: hits.slice(0, 5).map(({ link, index }) => ({ field: `links[${index}].anchor`, value: link.anchor })),
      });
    }
    return issues;
  },
};

const emptyAnchorRatioMeta: RuleMeta = {
  id: "high-empty-anchor-ratio",
  category: "links",
  defaultSeverity: "notice",
  description: "More than the configured share of a page's internal links carry no anchor text.",
  howToFix: "Give each link real anchor text describing its destination — an empty anchor tells neither readers nor search engines what it points at.",
  dataRequirements: ["links"],
};

export const highEmptyAnchorRatioRule: SiteRule = {
  meta: emptyAnchorRatioMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(emptyAnchorRatioMeta.id, config)) return null;
    const severity = resolvedSeverity(emptyAnchorRatioMeta.id, emptyAnchorRatioMeta.defaultSeverity, config);
    const maxRatio = config.thresholds.emptyAnchorRatioMax ?? 0.3;
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      const internal = page.links.map((link, index) => ({ link, index })).filter(({ link }) => link.type === "internal");
      if (internal.length === 0) continue;
      const blank = internal.filter(({ link }) => !link.anchor || link.anchor.trim() === "");
      const ratio = blank.length / internal.length;
      if (ratio <= maxRatio) continue;
      issues.push({
        ruleId: emptyAnchorRatioMeta.id,
        category: emptyAnchorRatioMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} has ${blank.length} of ${internal.length} internal links with no anchor text`,
        howToFix: emptyAnchorRatioMeta.howToFix,
        threshold: `blank ratio ${ratio.toFixed(2)} > max ${maxRatio}`,
        evidence: blank.slice(0, 5).map(({ index }) => ({ field: `links[${index}].anchor`, value: "" })),
      });
    }
    return issues;
  },
};

const noInternalLinksMeta: RuleMeta = {
  id: "page-no-internal-links",
  category: "links",
  defaultSeverity: "warning",
  description: "A successfully loaded page has zero outgoing internal links.",
  howToFix: "Link to at least one other relevant page on the site — a dead-end page passes no internal link equity onward.",
  dataRequirements: ["links"],
};

export const pageNoInternalLinksRule: SiteRule = {
  meta: noInternalLinksMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(noInternalLinksMeta.id, config)) return null;
    const severity = resolvedSeverity(noInternalLinksMeta.id, noInternalLinksMeta.defaultSeverity, config);
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (page.statusCode === null || page.statusCode >= 400) continue;
      const internal = page.links.filter((l) => l.type === "internal").length;
      if (internal > 0) continue;
      issues.push({
        ruleId: noInternalLinksMeta.id,
        category: noInternalLinksMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} links to nothing else on the site`,
        howToFix: noInternalLinksMeta.howToFix,
        evidence: [{ field: "links", value: page.links.length }],
      });
    }
    return issues;
  },
};
