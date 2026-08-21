/** Slice S5 implements. */
import type {
  CrawledPage,
  CrawlOptions,
  CrawlSummary,
  FailureRecord,
  SitemapResult,
} from "../models/types";

export interface SummaryInputs {
  pages: CrawledPage[];
  failures: FailureRecord[];
  /** Normalized URLs recorded as robots-blocked (never fetched). */
  blocked: string[];
  sitemap: SitemapResult | null;
  /** Everything ever seen pre-dedup (for the `discovered` count). */
  discoveredCount: number;
  startedAt: Date;
  finishedAt: Date;
  options: CrawlOptions;
}

/** 2xx always successful; a resolved 3xx (redirect chain recorded) also counts. */
function isSuccessStatus(statusCode: number | null, redirectHops: number): boolean {
  if (statusCode === null) return false;
  if (statusCode >= 200 && statusCode < 300) return true;
  return statusCode >= 300 && statusCode < 400 && redirectHops > 0;
}

/**
 * Sitemap entries are authored URLs (possibly an aliased host); page records store the
 * remapped normalized URL. Host remapping preserves path/query, so cross-ref by that alone —
 * best-effort for the POC, not a full URL-equivalence check.
 */
function pathKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const pathname = u.pathname.length > 1 ? u.pathname.replace(/\/$/, "") : u.pathname;
    return pathname + u.search;
  } catch {
    return rawUrl;
  }
}

export function buildSummary(inputs: SummaryInputs): CrawlSummary {
  const { pages, failures, blocked, sitemap, discoveredCount, startedAt, finishedAt, options } = inputs;

  const blockedSet = new Set(blocked);
  const pageSet = new Set(pages.map((p) => p.normalizedUrl));
  const failureSet = new Set(failures.map((f) => f.normalizedUrl ?? f.url));

  const uniqueSet = new Set<string>([...pageSet, ...failureSet, ...blockedSet]);
  const unique = uniqueSet.size;
  const allowed = unique - blockedSet.size;

  // pages ∪ failures, deduped by normalized URL — a URL with both a page and a failure
  // record (e.g. a 404 that still yielded HTML) counts once.
  const attemptedSet = new Set<string>([...pageSet, ...failureSet]);
  const attempted = attemptedSet.size;

  // Overlap URLs (page + failure both exist) are classified failed, not successful.
  const successful = pages.filter(
    (p) => isSuccessStatus(p.statusCode, p.redirectChain.length) && !failureSet.has(p.normalizedUrl),
  ).length;
  const failed = failureSet.size;

  const redirects = pages.filter((p) => p.redirectChain.length > 0).length;

  // One status per attempted URL — page status wins over a failure's when both exist, so
  // an overlap URL isn't double-tallied.
  const statusByUrl = new Map<string, number | null>();
  for (const f of failures) statusByUrl.set(f.normalizedUrl ?? f.url, f.statusCode);
  for (const p of pages) statusByUrl.set(p.normalizedUrl, p.statusCode);
  const statusHistogram: Record<string, number> = {};
  for (const status of statusByUrl.values()) {
    const key = status === null ? "none" : String(status);
    statusHistogram[key] = (statusHistogram[key] ?? 0) + 1;
  }

  const jsRendered = pages.filter((p) => p.renderedWith === "playwright").length;

  let internalLinks = 0;
  let externalLinks = 0;
  const internalLinkTargets = new Set<string>();
  for (const p of pages) {
    for (const link of p.links) {
      if (link.type === "internal") {
        internalLinks++;
        if (link.targetNormalized) internalLinkTargets.add(link.targetNormalized);
      } else {
        externalLinks++;
      }
    }
  }

  const orphanCandidates = pages
    .filter(
      (p) =>
        p.statusCode !== null &&
        p.statusCode >= 200 &&
        p.statusCode < 300 &&
        !p.crawl.discoverySources.includes("seed") &&
        !internalLinkTargets.has(p.normalizedUrl),
    )
    .map((p) => p.normalizedUrl);

  const coveragePercent = attempted === 0 ? 0 : Math.round((successful / attempted) * 1000) / 10;
  const maxDepthSeen = pages.reduce((max, p) => Math.max(max, p.crawl.depth), 0);

  const sitemapEntries = sitemap?.entries ?? [];
  const pagePathSet = new Set(pages.map((p) => pathKey(p.normalizedUrl)));
  const page2xxPathSet = new Set(
    pages.filter((p) => p.statusCode !== null && p.statusCode >= 200 && p.statusCode < 300).map((p) => pathKey(p.normalizedUrl)),
  );
  const sitemapPathSet = new Set(sitemapEntries.map((e) => pathKey(e.url)));
  const failurePathSet = new Set(failures.map((f) => pathKey(f.normalizedUrl ?? f.url)));

  const inSitemapNotCrawled = sitemapEntries
    .filter((e) => !pagePathSet.has(pathKey(e.url)))
    .map((e) => e.url);
  const crawledNotInSitemap = pages
    .filter((p) => page2xxPathSet.has(pathKey(p.normalizedUrl)) && !sitemapPathSet.has(pathKey(p.normalizedUrl)))
    .map((p) => p.normalizedUrl);
  const sitemapEntriesFailed = sitemapEntries
    .filter((e) => failurePathSet.has(pathKey(e.url)))
    .map((e) => e.url);

  const failuresByClass: Record<string, number> = {};
  for (const f of failures) failuresByClass[f.reason] = (failuresByClass[f.reason] ?? 0) + 1;

  return {
    runId: options.runId,
    startUrl: options.startUrl,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    discovered: discoveredCount,
    unique,
    allowed,
    blockedByRobots: blockedSet.size,
    attempted,
    successful,
    failed,
    redirects,
    statusHistogram,
    jsRendered,
    internalLinks,
    externalLinks,
    orphanCandidates,
    coveragePercent,
    maxDepthSeen,
    sitemap: {
      urlsInSitemap: sitemapEntries.length,
      inSitemapNotCrawled,
      crawledNotInSitemap,
      sitemapEntriesFailed,
    },
    failuresByClass,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}m ${ss}s`;
}

function count5xx(statusHistogram: Record<string, number>): number {
  let total = 0;
  for (const [key, n] of Object.entries(statusHistogram)) {
    const code = Number(key);
    if (Number.isFinite(code) && code >= 500 && code < 600) total += n;
  }
  return total;
}

/** Console block in the plan §20 format. */
export function printSummary(summary: CrawlSummary): void {
  const lines: string[] = [];
  lines.push("========== CRAWL SUMMARY ==========", "");
  lines.push("Start URL:", summary.startUrl, "");
  lines.push("Duration:", fmtDuration(summary.durationMs), "");
  lines.push("Discovered URLs:", fmt(summary.discovered), "");
  lines.push("Unique URLs:", fmt(summary.unique), "");
  lines.push("Allowed:", fmt(summary.allowed), "");
  lines.push("Attempted:", fmt(summary.attempted), "");
  lines.push("Successful:", fmt(summary.successful), "");
  lines.push("Failed:", fmt(summary.failed), "");
  lines.push("Blocked:", fmt(summary.blockedByRobots), "");
  lines.push("Redirects:", fmt(summary.redirects), "");
  lines.push("404:", fmt(summary.statusHistogram["404"] ?? 0), "");
  lines.push("5xx:", fmt(count5xx(summary.statusHistogram)), "");
  lines.push("JS rendered:", fmt(summary.jsRendered), "");
  lines.push("Internal links:", fmt(summary.internalLinks), "");
  lines.push("External links:", fmt(summary.externalLinks), "");
  lines.push("Max depth reached:", fmt(summary.maxDepthSeen), "");
  lines.push("Orphan candidates:", fmt(summary.orphanCandidates.length));
  for (const url of summary.orphanCandidates.slice(0, 10)) lines.push(`  - ${url}`);
  lines.push("");
  lines.push(
    `Crawl completed with ${summary.coveragePercent}% successful processing coverage; ` +
      `${fmt(summary.failed)} URLs failed and ${fmt(summary.blockedByRobots)} were blocked.`,
    "",
  );
  lines.push("Sitemap cross-reference:");
  lines.push(`  URLs in sitemap: ${fmt(summary.sitemap.urlsInSitemap)}`);
  lines.push(`  In sitemap, not crawled: ${fmt(summary.sitemap.inSitemapNotCrawled.length)}`);
  lines.push(`  Crawled, not in sitemap: ${fmt(summary.sitemap.crawledNotInSitemap.length)}`);
  lines.push(`  Sitemap entries failed: ${fmt(summary.sitemap.sitemapEntriesFailed.length)}`, "");
  lines.push("Failures by class:");
  const classEntries = Object.entries(summary.failuresByClass);
  if (classEntries.length === 0) lines.push("  (none)");
  for (const [cls, n] of classEntries) lines.push(`  ${cls}: ${fmt(n)}`);

  console.log(lines.join("\n"));
}
