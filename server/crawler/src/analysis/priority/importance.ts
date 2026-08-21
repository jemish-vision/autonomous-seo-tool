/**
 * Page importance — depth + inbound links + (when available) real PageRank + sitemap presence.
 * Never returns 0: a page with no evidence at all still gets the floor of every component
 * (~0.18), because a hard 0 would zero out every finding's priority on that page regardless of
 * severity — "data-unavailable" must read as "unknown", not "unimportant".
 */
import type { CrawledPage, GraphReport, PageGraphScore, SitemapResult } from "../../models/types";
import { buildInlinkOccurrences, pageIdFor, pathnameOf, primaryUrl } from "../rules/site/helpers";
import type { PageImportanceResult } from "./types";

interface PageEntry {
  page: CrawledPage;
  pageId: string;
}

/** Depth tiers verbatim from the Kishan audit (server/index.js pageImportance) — the home page
 * and pages one click from it carry most of a site's traffic. */
function depthScore(depth: number): number {
  if (depth <= 0) return 1;
  if (depth === 1) return 0.8;
  if (depth === 2) return 0.6;
  if (depth === 3) return 0.45;
  return 0.3;
}

/** Diminishing returns: 0 -> 5 inbound links matters far more than 50 -> 55. Same curve Kishan
 * used, kept as the fallback when there is no PageRank to lean on. */
function inlinkFallbackScore(inlinks: number): number {
  return 0.7 + Math.min(0.3, Math.log10(1 + inlinks) / 5);
}

/** internalRank is already log-scaled 1-100 by computeGraph — a richer topology signal than raw
 * inbound count, so prefer it over the fallback whenever a graph pass ran. */
function inlinkRankScore(internalRank: number): number {
  return 0.7 + 0.3 * (internalRank / 100);
}

export function buildSitemapPathSet(sitemap: SitemapResult | null): Set<string> {
  const set = new Set<string>();
  if (!sitemap) return set;
  for (const entry of sitemap.entries) {
    const p = pathnameOf(entry.url);
    if (p) set.add(p);
  }
  return set;
}

function buildFallbackInlinkCounts(pages: CrawledPage[]): Map<string, number> {
  const occurrences = buildInlinkOccurrences(pages);
  const counts = new Map<string, number>();
  for (const page of pages) {
    const pathname = pathnameOf(primaryUrl(page));
    const n = pathname ? (occurrences.get(pathname)?.length ?? 0) : 0;
    counts.set(pageIdFor(page.normalizedUrl), n);
  }
  return counts;
}

export interface ImportanceIndexResult {
  index: Map<string, PageImportanceResult>;
  /** Mean importance across every analyzed page — a site rule's own importance figure (Kishan:
   * a site-scope finding scored against a flat constant outranked a critical fault on 93% of a
   * site's pages; scoring it against the site's own mean fixed that). */
  meanImportance: number;
  graphAvailable: boolean;
}

/**
 * One pass over the run's pages, producing a 0..1 importance score each. `graphReport` is
 * whatever ensureGraphReport() produced this run (or null if the graph pass itself failed) —
 * absence degrades to the depth+inlinks fallback, never to a 0.
 */
export function buildImportanceIndex(
  pages: PageEntry[],
  graphReport: GraphReport | null,
  sitemap: SitemapResult | null,
): ImportanceIndexResult {
  const sitemapPaths = buildSitemapPathSet(sitemap);
  const graphByPageId = new Map<string, PageGraphScore>(graphReport ? graphReport.pages.map((p) => [p.pageId, p]) : []);
  const fallbackInlinks = graphReport ? null : buildFallbackInlinkCounts(pages.map((e) => e.page));

  const index = new Map<string, PageImportanceResult>();
  let sum = 0;
  for (const { page, pageId } of pages) {
    const depth = page.crawl?.depth ?? 3;
    const dScore = depthScore(depth);

    const graphScore = graphByPageId.get(pageId) ?? null;
    const source: PageImportanceResult["source"] = graphScore ? "pagerank" : "fallback-depth-inlinks";
    const linkScore = graphScore
      ? inlinkRankScore(graphScore.internalRank)
      : inlinkFallbackScore(fallbackInlinks?.get(pageId) ?? 0);

    const pathname = pathnameOf(primaryUrl(page)) ?? pathnameOf(page.finalUrl);
    const inSitemap = pathname !== null && sitemapPaths.has(pathname);
    // No sitemap at all on this crawl is not evidence the page is unimportant — neutral (1).
    // A sitemap that exists but omits this page is a mild, not a fatal, signal (0.85 not 0).
    const sitemapScore = sitemap === null ? 1 : inSitemap ? 1 : 0.85;

    const score = Math.max(0, Math.min(1, dScore * linkScore * sitemapScore));
    sum += score;
    index.set(pageId, {
      pageId,
      score,
      source,
      components: { rank: graphScore?.internalRank ?? 0, depth: dScore, inlinks: linkScore, sitemap: sitemapScore },
    });
  }

  return {
    index,
    meanImportance: pages.length > 0 ? sum / pages.length : 0.5,
    graphAvailable: graphReport !== null,
  };
}
