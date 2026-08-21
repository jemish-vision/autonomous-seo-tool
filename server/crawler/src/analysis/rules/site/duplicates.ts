/** Slice A4 — duplicate-title / duplicate-description / exact-dup content clusters.
 * near-duplicate-content (slice C3) delegates its clustering to ../../similarity.ts. */
import type { CrawledPage, Issue, RuleMeta } from "../../../models/types";
import { buildClusters, isRuleEnabled, pageIdFor, primaryUrl, resolvedSeverity } from "./helpers";
import type { SiteRule } from "./types";
import { DEFAULT_THRESHOLD, findNearDuplicates } from "../../similarity";

function clusterIssues(
  members: CrawledPage[],
  meta: RuleMeta,
  severity: Issue["severity"],
  field: "title" | "metaDescription",
  clusterValue: string,
): Issue[] {
  return members.map((page) => {
    const others = members.filter((m) => m !== page);
    return {
      ruleId: meta.id,
      category: meta.category,
      severity,
      scope: "site",
      url: primaryUrl(page),
      pageId: pageIdFor(page.normalizedUrl),
      message: `${field === "title" ? "Title" : "Meta description"} duplicated across ${members.length} pages: "${clusterValue}"`,
      howToFix: meta.howToFix,
      evidence: [
        { field, value: page[field] },
        ...others.map((o) => ({ field, value: o[field], pageId: pageIdFor(o.normalizedUrl) })),
      ],
    };
  });
}

const duplicateTitleMeta: RuleMeta = {
  id: "duplicate-title",
  category: "duplicates",
  defaultSeverity: "warning",
  description: "Two or more crawled pages share the exact same <title>.",
  howToFix: "Write a unique, descriptive title for each page.",
  dataRequirements: ["title"],
};

export const duplicateTitleRule: SiteRule = {
  meta: duplicateTitleMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(duplicateTitleMeta.id, config)) return null;
    const severity = resolvedSeverity(duplicateTitleMeta.id, duplicateTitleMeta.defaultSeverity, config);
    const clusters = buildClusters(ctx.pages, (p) => (p.title && p.title.trim() ? p.title.trim() : null));
    const issues: Issue[] = [];
    for (const [value, members] of clusters) {
      issues.push(...clusterIssues(members, duplicateTitleMeta, severity, "title", value));
    }
    return issues;
  },
};

const duplicateDescriptionMeta: RuleMeta = {
  id: "duplicate-description",
  category: "duplicates",
  defaultSeverity: "warning",
  description: "Two or more crawled pages share the exact same meta description.",
  howToFix: "Write a unique meta description for each page.",
  dataRequirements: ["metaDescription"],
};

export const duplicateDescriptionRule: SiteRule = {
  meta: duplicateDescriptionMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(duplicateDescriptionMeta.id, config)) return null;
    const severity = resolvedSeverity(duplicateDescriptionMeta.id, duplicateDescriptionMeta.defaultSeverity, config);
    const clusters = buildClusters(ctx.pages, (p) =>
      p.metaDescription && p.metaDescription.trim() ? p.metaDescription.trim() : null,
    );
    const issues: Issue[] = [];
    for (const [value, members] of clusters) {
      issues.push(...clusterIssues(members, duplicateDescriptionMeta, severity, "metaDescription", value));
    }
    return issues;
  },
};

const exactDuplicateContentMeta: RuleMeta = {
  id: "exact-duplicate-content",
  category: "duplicates",
  defaultSeverity: "warning",
  description: "Two or more crawled pages have byte-identical extracted content (same contentHash).",
  howToFix: "Merge, canonicalize, or differentiate the duplicate pages.",
  dataRequirements: ["content.contentHash"],
};

export const exactDuplicateContentRule: SiteRule = {
  meta: exactDuplicateContentMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(exactDuplicateContentMeta.id, config)) return null;
    const severity = resolvedSeverity(exactDuplicateContentMeta.id, exactDuplicateContentMeta.defaultSeverity, config);
    const clusters = buildClusters(ctx.pages, (p) => (p.content.wordCount > 0 ? p.content.contentHash : null));
    const issues: Issue[] = [];
    for (const [hash, members] of clusters) {
      for (const page of members) {
        const others = members.filter((m) => m !== page);
        issues.push({
          ruleId: exactDuplicateContentMeta.id,
          category: exactDuplicateContentMeta.category,
          severity,
          scope: "site",
          url: primaryUrl(page),
          pageId: pageIdFor(page.normalizedUrl),
          message: `Content is byte-identical to ${others.length} other page(s) (contentHash ${hash.slice(0, 12)})`,
          howToFix: exactDuplicateContentMeta.howToFix,
          evidence: [
            { field: "content.contentHash", value: page.content.contentHash },
            ...others.map((o) => ({ field: "content.contentHash", value: o.content.contentHash, pageId: pageIdFor(o.normalizedUrl) })),
          ],
        });
      }
    }
    return issues;
  },
};

/** Kishan's exact normalization: lowercase -> strip /index.html(m) -> strip trailing slash.
 * Query string is kept (a different query is a legitimately different resource, e.g. pagination). */
function variantKey(url: string): string | null {
  try {
    const u = new URL(url);
    let path = u.pathname.toLowerCase().replace(/\/index\.html?$/, "/");
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return `${u.hostname.toLowerCase()}${path || "/"}${u.search}`;
  } catch {
    return null;
  }
}

const urlVariantMeta: RuleMeta = {
  id: "url-variant-duplicate",
  category: "duplicates",
  defaultSeverity: "warning",
  description:
    "The same page is reachable at more than one URL form (case, /index.html, or trailing-slash variants) and serves byte-identical content at each — link equity and crawl budget split across addresses that are really one page. " +
    "Distinct from exact-duplicate-content: this fires only when the URLs are variants of each other, which points at a redirect/canonical fix rather than a content-authoring one.",
  howToFix: "Pick one canonical URL form and 301-redirect the others to it (or add a self-referencing canonical tag).",
  dataRequirements: ["content.contentHash"],
};

export const urlVariantDuplicateRule: SiteRule = {
  meta: urlVariantMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(urlVariantMeta.id, config)) return null;
    const severity = resolvedSeverity(urlVariantMeta.id, urlVariantMeta.defaultSeverity, config);
    const live = ctx.pages.filter(
      (p) => p.statusCode !== null && p.statusCode >= 200 && p.statusCode < 300 && p.content.wordCount > 0,
    );
    const byKey = new Map<string, CrawledPage[]>();
    for (const page of live) {
      const key = variantKey(primaryUrl(page));
      if (key === null) continue;
      const list = byKey.get(key);
      if (list) list.push(page);
      else byKey.set(key, [page]);
    }
    const issues: Issue[] = [];
    for (const members of byKey.values()) {
      // The crawler already dedupes by normalizedUrl, so >=2 members here only happens when
      // their authored URLs genuinely differ in case/index.html/trailing-slash — guard anyway.
      const distinctUrls = new Set(members.map((m) => primaryUrl(m)));
      if (distinctUrls.size < 2) continue;
      const hashes = new Set(members.map((m) => m.content.contentHash));
      if (hashes.size !== 1) continue; // not proven byte-identical — don't fabricate a duplicate
      for (const page of members) {
        const others = members.filter((m) => m !== page);
        issues.push({
          ruleId: urlVariantMeta.id,
          category: urlVariantMeta.category,
          severity,
          scope: "site",
          url: primaryUrl(page),
          pageId: pageIdFor(page.normalizedUrl),
          message: `Same content is reachable at ${members.length} URL variants: ${members.map((m) => primaryUrl(m)).join(", ")}`,
          howToFix: urlVariantMeta.howToFix,
          evidence: [
            { field: "content.contentHash", value: page.content.contentHash },
            ...others.map((o) => ({ field: "content.contentHash", value: o.content.contentHash, pageId: pageIdFor(o.normalizedUrl) })),
          ],
        });
      }
    }
    return issues;
  },
};

const nearDuplicateContentMeta: RuleMeta = {
  id: "near-duplicate-content",
  category: "duplicates",
  defaultSeverity: "notice",
  description:
    "Two or more pages have near-identical body content. Measured via 5-word-shingle MinHash " +
    "signatures compared through LSH banding (see src/analysis/similarity.ts) and clustered " +
    "when estimated Jaccard similarity meets the configured threshold (default 0.75 — " +
    "thresholds.nearDupSimilarity in analysis.config.json). This is a real similarity score, " +
    "not a length proxy: two pages of identical length with unrelated content will not fire, " +
    "and two pages of different length with overlapping wording can.",
  howToFix: "Review for content overlap; differentiate or consolidate if truly duplicative.",
  dataRequirements: ["content.text", "content.wordCount", "content.contentHash"],
};

export const nearDuplicateContentRule: SiteRule = {
  meta: nearDuplicateContentMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(nearDuplicateContentMeta.id, config)) return null;
    const severity = resolvedSeverity(nearDuplicateContentMeta.id, nearDuplicateContentMeta.defaultSeverity, config);
    // nearDupSimilarity is additive to AnalysisConfig (slice C3) — absent on older configs/
    // fixtures, so fall back to similarity.ts's own tuned default rather than requiring it.
    const raw = config.thresholds.nearDupSimilarity;
    const threshold = typeof raw === "number" && raw > 0 && raw <= 1 ? raw : DEFAULT_THRESHOLD;
    const runId = ctx.pages[0]?.runId ?? "unknown";
    const report = findNearDuplicates(ctx.pages, runId, { threshold });

    const issues: Issue[] = [];
    for (const clusterEntry of report.clusters) {
      for (const member of clusterEntry.members) {
        const page = ctx.pages.find((p) => pageIdFor(p.normalizedUrl) === member.pageId);
        if (!page) continue; // defensive; pageId always derives from a ctx.pages entry
        const peers = clusterEntry.members.filter((m) => m.pageId !== member.pageId);
        const pct = Math.round(clusterEntry.similarity * 100);
        issues.push({
          ruleId: nearDuplicateContentMeta.id,
          category: nearDuplicateContentMeta.category,
          severity,
          scope: "site",
          url: primaryUrl(page),
          pageId: member.pageId,
          message: `Content is ~${pct}% similar (estimated Jaccard) to ${peers.length} other page(s): ${peers.map((p) => p.url).join(", ")}`,
          howToFix: nearDuplicateContentMeta.howToFix,
          threshold: `estimated Jaccard similarity >= ${threshold} (5-word shingles, MinHash + LSH banding)`,
          evidence: [
            { field: "content.contentHash", value: page.content.contentHash },
            { field: "content.wordCount", value: page.content.wordCount },
            ...peers.map((p) => ({ field: "content.wordCount", value: p.wordCount, pageId: p.pageId })),
          ],
        });
      }
    }
    return issues;
  },
};
