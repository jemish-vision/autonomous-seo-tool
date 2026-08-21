/**
 * Crawl-over-crawl diff computation, extracted from compare.routes.ts so it can be reused by the
 * persisted /api/comparisons module (which stores this exact CrawlDiff as a comparison row) without
 * duplicating the field-by-field diff logic. The compare route still calls computeCrawlDiff and its
 * response is byte-for-byte identical to before the extraction.
 *
 * Ported field-for-field from the old lib/data-compare.ts computeDiff: dbGetCrawlPages(base) vs
 * dbGetCrawlPages(head) for the page add/remove/change sets, and dbReadCrawlAnalysis(base/head) for
 * the issue lifecycle. Recomputed per request rather than reading a cached diff file. No fs.
 */
import { prisma } from "../../db/prisma.js";
import { dbGetCrawlPages, dbReadCrawlAnalysis, type CrawledPageRow } from "../../db/src/crawl/readStore.js";

export interface PageFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}
export interface PageChange {
  url: string;
  pageId: string;
  changes: PageFieldChange[];
}
export interface CrawlDiff {
  baseRunId: string;
  headRunId: string;
  generatedAt: string;
  added: string[];
  removed: string[];
  changed: PageChange[];
  unchangedCount: number;
  issues: { newIssues: string[]; fixedIssues: string[]; persistingCount: number } | null;
}

/** Path-only key, trailing slash stripped except root — survives host aliasing / scheme drift. */
function pathKey(raw: string): string {
  try {
    const p = new URL(raw).pathname;
    return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  } catch {
    return raw;
  }
}

function byKey(pages: CrawledPageRow[]): Map<string, CrawledPageRow> {
  const map = new Map<string, CrawledPageRow>();
  for (const p of pages) map.set(pathKey(p.normalizedUrl ?? p.url), p);
  return map;
}

const FIELDS: { field: string; get: (p: CrawledPageRow) => unknown }[] = [
  { field: "statusCode", get: (p) => p.statusCode },
  { field: "title", get: (p) => p.title },
  { field: "metaDescription", get: (p) => p.metaDescription },
  { field: "canonical", get: (p) => p.canonical },
  { field: "robots.noindex", get: (p) => p.robots.noindex },
  { field: "h1", get: (p) => p.headings.h1.join(" | ") },
  { field: "content.contentHash", get: (p) => p.content.contentHash },
  { field: "content.wordCount", get: (p) => p.content.wordCount },
  { field: "links.length", get: (p) => p.links.length },
  { field: "images.length", get: (p) => p.images.length },
  { field: "redirectChain.length", get: (p) => p.redirectChain.length },
  { field: "renderedWith", get: (p) => p.renderedWith },
];

function diffPage(base: CrawledPageRow, head: CrawledPageRow): PageFieldChange[] {
  const changes: PageFieldChange[] = [];
  for (const { field, get } of FIELDS) {
    const before = get(base);
    const after = get(head);
    if (before !== after) changes.push({ field, before, after });
  }
  return changes;
}

function issueKey(ruleId: string, url: string | null): string {
  return `${ruleId}::${url ?? "(site)"}`;
}

/** Compute the base->head crawl diff. Shared by GET /api/crawls/:head/diff and the persisted
 *  POST /api/comparisons run-over-run mode. */
export async function computeCrawlDiff(baseRunId: string, headRunId: string): Promise<CrawlDiff> {
  const [basePages, headPages, baseReport, headReport] = await Promise.all([
    dbGetCrawlPages(prisma, baseRunId),
    dbGetCrawlPages(prisma, headRunId),
    dbReadCrawlAnalysis(prisma, baseRunId),
    dbReadCrawlAnalysis(prisma, headRunId),
  ]);

  const baseMap = byKey(basePages);
  const headMap = byKey(headPages);

  const added = [...headMap.keys()]
    .filter((k) => !baseMap.has(k))
    .map((k) => headMap.get(k)!.url)
    .sort();
  const removed = [...baseMap.keys()]
    .filter((k) => !headMap.has(k))
    .map((k) => baseMap.get(k)!.url)
    .sort();

  const changed: PageChange[] = [];
  let unchangedCount = 0;
  for (const [key, headPage] of headMap) {
    const basePage = baseMap.get(key);
    if (!basePage) continue;
    const fieldChanges = diffPage(basePage, headPage);
    if (fieldChanges.length === 0) {
      unchangedCount++;
      continue;
    }
    changed.push({ url: headPage.url, pageId: headPage.pageId, changes: fieldChanges });
  }
  changed.sort((a, b) => a.url.localeCompare(b.url));

  let issues: CrawlDiff["issues"] = null;
  if (baseReport && headReport) {
    const baseKeys = new Set(baseReport.issues.map((i) => issueKey(i.ruleId, i.url)));
    const headKeys = new Set(headReport.issues.map((i) => issueKey(i.ruleId, i.url)));
    const newIssues = [...headKeys].filter((k) => !baseKeys.has(k)).sort();
    const fixedIssues = [...baseKeys].filter((k) => !headKeys.has(k)).sort();
    const persistingCount = [...headKeys].filter((k) => baseKeys.has(k)).length;
    issues = { newIssues, fixedIssues, persistingCount };
  }

  return {
    baseRunId,
    headRunId,
    generatedAt: new Date().toISOString(),
    added,
    removed,
    changed,
    unchangedCount,
    issues,
  };
}
