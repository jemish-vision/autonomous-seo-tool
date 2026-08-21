/** Slice A4 — sitemap hygiene four-pack. Computed independently from ctx.sitemap.entries +
 * ctx.pages + ctx.failures (pathname-based matching, alias/redirect-safe — scripts/lib/records.ts
 * convention) rather than trusting the crawler's own report.sitemap.* fields, so the analyzer
 * stays correct even if the report builder's cross-ref logic diverges. */
import type { Issue, RuleMeta } from "../../../models/types";
import {
  buildInlinkOccurrences,
  httpFailurePaths,
  isRuleEnabled,
  pageByPath,
  pageIdFor,
  pathnameOf,
  primaryUrl,
  resolvedSeverity,
} from "./helpers";
import type { SiteRule, SiteRuleContext } from "./types";

function crawledPathSet(ctx: SiteRuleContext): Set<string> {
  const set = new Set<string>();
  for (const p of ctx.pages) {
    const req = pathnameOf(primaryUrl(p));
    const landed = pathnameOf(p.finalUrl);
    if (req) set.add(req);
    if (landed) set.add(landed);
  }
  return set;
}

const sitemap404Meta: RuleMeta = {
  id: "sitemap-404-entry",
  category: "sitemap",
  defaultSeverity: "warning",
  description: "A URL listed in the sitemap failed with a 4xx/5xx status when crawled.",
  howToFix: "Remove the URL from the sitemap or fix the page so it resolves successfully.",
  dataRequirements: ["sitemap"],
};

export const sitemap404Rule: SiteRule = {
  meta: sitemap404Meta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(sitemap404Meta.id, config)) return null;
    if (!ctx.sitemap) return null;
    const severity = resolvedSeverity(sitemap404Meta.id, sitemap404Meta.defaultSeverity, config);
    const failedPaths = httpFailurePaths(ctx.failures);
    const issues: Issue[] = [];
    const seen = new Set<string>();
    for (const entry of ctx.sitemap.entries) {
      const path = pathnameOf(entry.url);
      if (!path || !failedPaths.has(path) || seen.has(path)) continue;
      seen.add(path);
      issues.push({
        ruleId: sitemap404Meta.id,
        category: sitemap404Meta.category,
        severity,
        scope: "site",
        url: entry.url,
        pageId: null,
        message: `Sitemap references ${entry.url}, which returns a 4xx/5xx status`,
        howToFix: sitemap404Meta.howToFix,
        evidence: [{ field: "entries", value: entry.url }],
      });
    }
    return issues;
  },
};

const sitemapNoindexMeta: RuleMeta = {
  id: "sitemap-noindex-included",
  category: "sitemap",
  defaultSeverity: "warning",
  description: "A URL listed in the sitemap is marked noindex — wastes crawl budget on a page that won't be indexed.",
  howToFix: "Remove noindexed URLs from the sitemap, or remove the noindex if the page should be indexed.",
  dataRequirements: ["sitemap", "robots.noindex"],
};

export const sitemapNoindexIncludedRule: SiteRule = {
  meta: sitemapNoindexMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(sitemapNoindexMeta.id, config)) return null;
    if (!ctx.sitemap) return null;
    const severity = resolvedSeverity(sitemapNoindexMeta.id, sitemapNoindexMeta.defaultSeverity, config);
    const sitemapPaths = new Set(ctx.sitemap.entries.map((e) => pathnameOf(e.url)).filter((p): p is string => p !== null));
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (!page.robots.noindex) continue;
      const path = pathnameOf(primaryUrl(page));
      if (!path || !sitemapPaths.has(path)) continue;
      issues.push({
        ruleId: sitemapNoindexMeta.id,
        category: sitemapNoindexMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} is noindex but still listed in the sitemap`,
        howToFix: sitemapNoindexMeta.howToFix,
        evidence: [{ field: "robots.noindex", value: page.robots.noindex }],
      });
    }
    return issues;
  },
};

const inSitemapNotCrawledMeta: RuleMeta = {
  id: "sitemap-not-crawled",
  category: "sitemap",
  defaultSeverity: "notice",
  description: "A URL is listed in the sitemap but was never reached by the crawl (not a 4xx/5xx entry).",
  howToFix: "Confirm the URL is reachable via internal links, or remove it from the sitemap if intentional.",
  dataRequirements: ["sitemap"],
};

export const inSitemapNotCrawledRule: SiteRule = {
  meta: inSitemapNotCrawledMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(inSitemapNotCrawledMeta.id, config)) return null;
    if (!ctx.sitemap) return null;
    const severity = resolvedSeverity(inSitemapNotCrawledMeta.id, inSitemapNotCrawledMeta.defaultSeverity, config);
    const crawled = crawledPathSet(ctx);
    const failedPaths = httpFailurePaths(ctx.failures);
    const issues: Issue[] = [];
    const seen = new Set<string>();
    for (const entry of ctx.sitemap.entries) {
      const path = pathnameOf(entry.url);
      if (!path || crawled.has(path) || failedPaths.has(path) || seen.has(path)) continue;
      seen.add(path);
      issues.push({
        ruleId: inSitemapNotCrawledMeta.id,
        category: inSitemapNotCrawledMeta.category,
        severity,
        scope: "site",
        url: entry.url,
        pageId: null,
        message: `Sitemap lists ${entry.url}, which the crawl never reached`,
        howToFix: inSitemapNotCrawledMeta.howToFix,
        evidence: [{ field: "entries", value: entry.url }],
      });
    }
    return issues;
  },
};

const crawledNotInSitemapMeta: RuleMeta = {
  id: "crawled-not-in-sitemap",
  category: "sitemap",
  defaultSeverity: "notice",
  description: "A successfully crawled page is missing from the sitemap.",
  howToFix: "Add the URL to the sitemap so search engines can discover it directly.",
  dataRequirements: ["sitemap"],
};

export const crawledNotInSitemapRule: SiteRule = {
  meta: crawledNotInSitemapMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(crawledNotInSitemapMeta.id, config)) return null;
    if (!ctx.sitemap) return null;
    const severity = resolvedSeverity(crawledNotInSitemapMeta.id, crawledNotInSitemapMeta.defaultSeverity, config);
    const sitemapPaths = new Set(ctx.sitemap.entries.map((e) => pathnameOf(e.url)).filter((p): p is string => p !== null));
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (page.statusCode !== null && page.statusCode >= 400) continue;
      const path = pathnameOf(primaryUrl(page));
      if (!path || sitemapPaths.has(path)) continue;
      const landed = pathnameOf(page.finalUrl);
      if (landed && sitemapPaths.has(landed)) continue;
      issues.push({
        ruleId: crawledNotInSitemapMeta.id,
        category: crawledNotInSitemapMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} was crawled successfully but is absent from the sitemap`,
        howToFix: crawledNotInSitemapMeta.howToFix,
        evidence: [{ field: "normalizedUrl", value: page.normalizedUrl }],
      });
    }
    return issues;
  },
};

/** Not a style preference: the sitemap protocol caps a single file at 50,000 URLs. Over that the
 * file is INVALID and search engines ignore it, so this is a hard failure, not "large". */
const DEFAULT_SITEMAP_MAX_URLS = 50_000;

const sitemapTooLargeMeta: RuleMeta = {
  id: "sitemap-too-many-urls",
  category: "sitemap",
  defaultSeverity: "error",
  description:
    "A sitemap file exceeds the protocol limit of 50,000 URLs. The file is invalid at that point " +
    "and search engines will not process it.",
  howToFix: "Split the sitemap into multiple files under the limit and reference them from a sitemap index.",
  dataRequirements: ["sitemap.files"],
};

export const sitemapTooManyUrlsRule: SiteRule = {
  meta: sitemapTooLargeMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(sitemapTooLargeMeta.id, config)) return null;
    if (!ctx.sitemap) return null; // no sitemap fetched — data unavailable, not a pass
    const severity = resolvedSeverity(sitemapTooLargeMeta.id, sitemapTooLargeMeta.defaultSeverity, config);
    const max = config.thresholds.sitemapMaxUrls ?? DEFAULT_SITEMAP_MAX_URLS;
    const issues: Issue[] = [];
    ctx.sitemap.files.forEach((file, index) => {
      if (file.urlCount <= max) return;
      issues.push({
        ruleId: sitemapTooLargeMeta.id,
        category: sitemapTooLargeMeta.category,
        severity,
        scope: "site",
        url: file.url,
        pageId: null,
        message: `Sitemap ${file.url} lists ${file.urlCount} URLs, over the ${max} protocol limit`,
        howToFix: sitemapTooLargeMeta.howToFix,
        threshold: `urlCount ${file.urlCount} > max ${max}`,
        evidence: [{ field: `sitemap.files[${index}].urlCount`, value: file.urlCount }],
      });
    });
    return issues;
  },
};

/* Kishan's rules.js 'site-no-sitemap'. discoverSitemaps() always runs and always writes
 * sitemaps.json (crawl.ts), so ctx.sitemap === null means a pre-feature run (data unavailable),
 * while ctx.sitemap.entries.length === 0 means it genuinely found nothing — the real finding. */
const noSitemapMeta: RuleMeta = {
  id: "no-sitemap-found",
  category: "sitemap",
  defaultSeverity: "warning",
  description: "No sitemap.xml, sitemap index, or robots.txt Sitemap: directive resolved to any URLs.",
  howToFix: "Publish a sitemap.xml and reference it from robots.txt so search engines can discover pages without relying solely on links.",
  dataRequirements: ["sitemap"],
};

export const noSitemapFoundRule: SiteRule = {
  meta: noSitemapMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(noSitemapMeta.id, config)) return null;
    if (!ctx.sitemap) return null;
    if (ctx.sitemap.entries.length > 0) return [];
    const severity = resolvedSeverity(noSitemapMeta.id, noSitemapMeta.defaultSeverity, config);
    return [
      {
        ruleId: noSitemapMeta.id,
        category: noSitemapMeta.category,
        severity,
        scope: "site",
        url: null,
        pageId: null,
        message: "No sitemap.xml, sitemap_index.xml or robots.txt Sitemap: directive resolved to any URLs.",
        howToFix: noSitemapMeta.howToFix,
        evidence: [{ field: "entries", value: [] }],
      },
    ];
  },
};

const sitemapBlockedMeta: RuleMeta = {
  id: "sitemap-lists-blocked-urls",
  category: "sitemap",
  defaultSeverity: "warning",
  description: "A URL listed in the sitemap is also disallowed by robots.txt — the two files disagree.",
  howToFix: "Remove the URL from the sitemap, or loosen the matching robots.txt Disallow rule.",
  dataRequirements: ["sitemap", "blocked"],
};

export const sitemapListsBlockedUrlsRule: SiteRule = {
  meta: sitemapBlockedMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(sitemapBlockedMeta.id, config)) return null;
    if (!ctx.sitemap) return null;
    const severity = resolvedSeverity(sitemapBlockedMeta.id, sitemapBlockedMeta.defaultSeverity, config);
    const blockedPaths = new Set(ctx.blocked.map((u) => pathnameOf(u)).filter((p): p is string => p !== null));
    const issues: Issue[] = [];
    const seen = new Set<string>();
    for (const entry of ctx.sitemap.entries) {
      const path = pathnameOf(entry.url);
      if (!path || !blockedPaths.has(path) || seen.has(path)) continue;
      seen.add(path);
      issues.push({
        ruleId: sitemapBlockedMeta.id,
        category: sitemapBlockedMeta.category,
        severity,
        scope: "site",
        url: entry.url,
        pageId: null,
        message: `Sitemap lists ${entry.url}, which robots.txt disallows`,
        howToFix: sitemapBlockedMeta.howToFix,
        evidence: [{ field: "entries", value: entry.url }],
      });
    }
    return issues;
  },
};

const sitemapNoInlinksMeta: RuleMeta = {
  id: "sitemap-page-no-inlinks",
  category: "sitemap",
  defaultSeverity: "notice",
  description: "A page is listed in the sitemap but no other crawled page links to it internally.",
  howToFix: "Link to it from somewhere relevant — a hub page, a related list, the navigation.",
  dataRequirements: ["sitemap"],
};

export const sitemapPageNoInlinksRule: SiteRule = {
  meta: sitemapNoInlinksMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(sitemapNoInlinksMeta.id, config)) return null;
    if (!ctx.sitemap) return null;
    const severity = resolvedSeverity(sitemapNoInlinksMeta.id, sitemapNoInlinksMeta.defaultSeverity, config);
    const occurrences = buildInlinkOccurrences(ctx.pages);
    const issues: Issue[] = [];
    const seen = new Set<string>();
    for (const entry of ctx.sitemap.entries) {
      const path = pathnameOf(entry.url);
      if (!path || seen.has(path)) continue;
      const page = pageByPath(ctx.pages, path);
      if (!page) continue; // never crawled — sitemap-not-crawled's finding, not this one
      if (page.crawl.depth === 0) continue; // seed excluded, matches weakly-linked's convention
      const occ = occurrences.get(path) ?? [];
      if (occ.length > 0) continue;
      seen.add(path);
      issues.push({
        ruleId: sitemapNoInlinksMeta.id,
        category: sitemapNoInlinksMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} is in the sitemap, but no crawled page links to it internally`,
        howToFix: sitemapNoInlinksMeta.howToFix,
        evidence: [{ field: "entries", value: entry.url }],
      });
    }
    return issues;
  },
};

const sitemapNoncanonicalMeta: RuleMeta = {
  id: "sitemap-url-noncanonical",
  category: "sitemap",
  defaultSeverity: "warning",
  description: "A sitemap entry's page declares a canonical pointing at a different URL — the sitemap asks for indexing while the canonical asks for something else.",
  howToFix: "List the canonical URL in the sitemap instead, or drop this entry.",
  dataRequirements: ["sitemap", "canonical"],
};

export const sitemapUrlNoncanonicalRule: SiteRule = {
  meta: sitemapNoncanonicalMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(sitemapNoncanonicalMeta.id, config)) return null;
    if (!ctx.sitemap) return null;
    const severity = resolvedSeverity(sitemapNoncanonicalMeta.id, sitemapNoncanonicalMeta.defaultSeverity, config);
    const sitemapPaths = new Set(ctx.sitemap.entries.map((e) => pathnameOf(e.url)).filter((p): p is string => p !== null));
    const issues: Issue[] = [];
    for (const page of ctx.pages) {
      if (!page.canonical) continue;
      const selfPath = pathnameOf(primaryUrl(page));
      if (!selfPath || !sitemapPaths.has(selfPath)) continue;
      const canonicalPath = pathnameOf(page.canonical);
      if (!canonicalPath || canonicalPath === selfPath) continue;
      issues.push({
        ruleId: sitemapNoncanonicalMeta.id,
        category: sitemapNoncanonicalMeta.category,
        severity,
        scope: "site",
        url: primaryUrl(page),
        pageId: pageIdFor(page.normalizedUrl),
        message: `${primaryUrl(page)} is listed in the sitemap, but its canonical points at ${page.canonical}`,
        howToFix: sitemapNoncanonicalMeta.howToFix,
        evidence: [
          { field: "canonical", value: page.canonical },
          { field: "entries", value: primaryUrl(page) },
        ],
      });
    }
    return issues;
  },
};

const sitemapLastmodMeta: RuleMeta = {
  id: "sitemap-lastmod-suspect",
  category: "sitemap",
  defaultSeverity: "notice",
  description: "Sitemap <lastmod> dates are missing, future-dated, or suspiciously uniform — a generator stamping \"now\" on every URL.",
  howToFix: "Emit the real modification time per URL, or leave lastmod out entirely. A wrong date costs more than a missing one.",
  dataRequirements: ["sitemap.lastmodTrust"],
};

export const sitemapLastmodSuspectRule: SiteRule = {
  meta: sitemapLastmodMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(sitemapLastmodMeta.id, config)) return null;
    if (!ctx.sitemap?.lastmodTrust) return null;
    const trust = ctx.sitemap.lastmodTrust;
    if (!trust.verdict.startsWith("suspect")) return [];
    const severity = resolvedSeverity(sitemapLastmodMeta.id, sitemapLastmodMeta.defaultSeverity, config);
    return [
      {
        ruleId: sitemapLastmodMeta.id,
        category: sitemapLastmodMeta.category,
        severity,
        scope: "site",
        url: null,
        pageId: null,
        message: `Sitemap lastmod dates look ${trust.verdict.replace("suspect-", "")}: ${trust.withLastmod}/${trust.totalUrls} declare lastmod, ${trust.future} future-dated, ${trust.distinctValues} distinct value(s)`,
        howToFix: sitemapLastmodMeta.howToFix,
        evidence: [
          { field: "lastmodTrust.verdict", value: trust.verdict },
          { field: "lastmodTrust.withLastmod", value: trust.withLastmod },
          { field: "lastmodTrust.future", value: trust.future },
        ],
      },
    ];
  },
};
