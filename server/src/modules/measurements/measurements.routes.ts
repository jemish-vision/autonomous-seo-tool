/**
 * Measurements — the aggregate technical-SEO metrics grid for a run (spec §7). Ported verbatim
 * from the old lib/data-measurements.ts: every number is computed live from dbGetCrawlPages() +
 * the run report (dbGetCrawlRun), nothing pre-materialised. No filesystem.
 *
 *   GET /api/crawls/:runId/measurements  -> Measurements   (404 when the run has no report)
 *
 * The `available: false` honesty is preserved exactly: fields the stored schema does not carry
 * (per-page byte weight, total bytes downloaded) are returned with `available: false` + a reason
 * rather than a fabricated number. Do NOT fill these in with a guess.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbGetCrawlRun, dbGetCrawlPages, type CrawledPageRow, type CrawlReportRow } from "../../db/src/crawl/readStore.js";
import { isSafeId } from "../../lib/apiShared.js";

export const measurementsRouter = Router();

// --- pure aggregators (ported from lib/data-measurements.ts) ------------------

interface Histogram {
  buckets: { key: string; count: number }[];
  available: true;
}

interface Percentiles {
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  available: true;
  caveat: string;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function computePercentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1] : null,
    available: true,
    caveat:
      "responseTimeMs is wall-clock on the Playwright path for rendered pages (PLAN-03 M4) — the http.ttfbMs / render.wallMs namespace split has not shipped in this run's stored records.",
  };
}

function histogram(counts: Record<string, number>): Histogram {
  return { buckets: Object.entries(counts).map(([key, count]) => ({ key, count })), available: true };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function buildMeasurements(runId: string, report: CrawlReportRow, pages: CrawledPageRow[], blockedCount: number) {
  const r = report;
  const times = pages.map((p) => p.performance.responseTimeMs).filter((t): t is number => t !== null);
  const words = pages.map((p) => p.content.wordCount).filter((w): w is number => w !== null);
  const depthCounts: Record<string, number> = {};
  for (const p of pages) {
    const key = p.crawl.depth === null || p.crawl.depth === undefined ? "unknown" : String(p.crawl.depth);
    depthCounts[key] = (depthCounts[key] ?? 0) + 1;
  }

  const indexable = pages.filter((p) => p.statusCode !== null && p.statusCode < 300 && !p.robots.noindex).length;
  const noindex = pages.filter((p) => p.robots.noindex).length;
  const nonOk = pages.filter((p) => p.statusCode === null || p.statusCode >= 300).length;
  const httpCount = pages.filter((p) => p.renderedWith === "http").length;
  const pwCount = pages.filter((p) => p.renderedWith === "playwright").length;

  const durationMinutes = r.durationMs > 0 ? r.durationMs / 60000 : 0;

  return {
    runId,
    generatedAt: new Date().toISOString(),
    overview: {
      discovered: r.discovered,
      unique: r.unique,
      allowed: r.allowed,
      attempted: r.attempted,
      successful: r.successful,
      failed: r.failed,
      blockedByRobots: r.blockedByRobots,
      coveragePercent: r.coveragePercent,
      durationMs: r.durationMs,
      pagesPerMinute: durationMinutes > 0 ? Math.round((r.successful / durationMinutes) * 10) / 10 : 0,
      maxDepthSeen: typeof r.maxDepthSeen === "number" ? r.maxDepthSeen : null,
    },
    statusHistogram: histogram(r.statusHistogram),
    depthHistogram: histogram(depthCounts),
    responseTimeMs: computePercentiles(times),
    wordCount: {
      avg: avg(words),
      median: median(words),
      thinContentUnder300: pages.filter((p) => (p.content.wordCount ?? 0) < 300).length,
      available: true as const,
    },
    pageWeight: { available: false as const, reason: "No per-page byte-weight field is stored on CrawledPage yet (awaiting crawler §8 asset/page-size instrumentation)." },
    bytesDownloaded: { available: false as const, reason: "report.json carries no bytes/transferSize total yet (awaiting crawler instrumentation)." },
    indexability: { indexable, noindex, blockedByRobots: blockedCount, nonOkStatus: nonOk, available: true as const },
    renderStats: {
      http: httpCount,
      playwright: pwCount,
      renderRatePercent: pages.length > 0 ? Math.round((pwCount / pages.length) * 1000) / 10 : 0,
      available: true as const,
    },
    linksAndOrphans: {
      internalLinks: r.internalLinks,
      externalLinks: r.externalLinks,
      orphanCandidates: r.orphanCandidates.length,
      available: true as const,
    },
    sitemapCoverage: {
      urlsInSitemap: r.sitemap.urlsInSitemap,
      inSitemapNotCrawled: r.sitemap.inSitemapNotCrawled.length,
      crawledNotInSitemap: r.sitemap.crawledNotInSitemap.length,
      sitemapEntriesFailed: r.sitemap.sitemapEntriesFailed.length,
      available: true as const,
    },
    failuresByClass: histogram({ ...r.failuresByClass }),
  };
}

// --- drill-down: metric -> matching pages ------------------------------------
//
// Ported from the OLD server-only lib/measurements-drilldown.ts (Next.js Server Action). Rather
// than deep-link into the /pages explorer's filters — which can express only a couple of these
// metrics without a count-vs-destination mismatch (the "chip counted 400-599 but linked to
// status=4xx" bug class) — the exact matching-page set is computed here, with the SAME semantics
// the measurements grid uses. Every matcher below mirrors a real card in buildMeasurements()
// above (legacy shape) and/or the OLD compute.ts card ids (v2 shape), so the drill-down count
// always equals the card's own number. Metric ids not in this map render without a drill-down
// button — an honest omission beats a subset that silently disagrees.

const DRILLDOWN_ROW_LIMIT = 500;
/** Matches buildMeasurements()'s `thinContentUnder300` — keep in lockstep with that card. */
const THIN_CONTENT_WORDS = 300;
/** Mirrors compute.ts's DEEP_PAGE_DEPTH (hardcoded there too, so no drift risk). */
const DEEP_PAGE_DEPTH = 3;

type PageMatcher = (p: CrawledPageRow) => boolean;

const DRILLDOWN_MATCHERS: Record<string, PageMatcher> = {
  // Legacy-shape ids (what GET /:runId/measurements returns today) — each mirrors buildMeasurements.
  "pages-crawled": () => true,
  "thin-content": (p) => (p.content.wordCount ?? 0) < THIN_CONTENT_WORDS,
  noindex: (p) => p.robots.noindex,
  "non-ok-status": (p) => p.statusCode === null || p.statusCode >= 300,
  indexable: (p) => p.statusCode !== null && p.statusCode < 300 && !p.robots.noindex,
  "rendered-http": (p) => p.renderedWith === "http",
  "rendered-playwright": (p) => p.renderedWith === "playwright",
  // v2-shape ids (forward-compat with the API-expansion slice's compute.ts grid) — faithful port of
  // the OLD lib/measurements-drilldown.ts matchers. Harmless on the legacy shape: overview.tsx only
  // offers a drill-down for ids that are actually present as cards this run.
  redirects: (p) => p.redirectChain.length > 0,
  "missing-title": (p) => !p.title || p.title.trim() === "",
  "missing-meta-description": (p) => !p.metaDescription || p.metaDescription.trim() === "",
  "missing-h1": (p) => p.headings.h1.length === 0,
  "multiple-h1": (p) => p.headings.h1.length > 1,
  "deep-pages": (p) => p.crawl.depth > DEEP_PAGE_DEPTH,
  "needs-javascript": (p) => p.renderedWith === "playwright",
};

/** The metric ids that support drill-down. The client mirrors this list (see
 *  client/src/components/measurements/matching-pages-panel.tsx DRILLDOWN_SUPPORTED_IDS). */
export const DRILLDOWN_SUPPORTED_IDS = Object.keys(DRILLDOWN_MATCHERS);

// --- routes ------------------------------------------------------------------

measurementsRouter.get(
  "/:runId/measurements",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }

    const [detail, pages] = await Promise.all([dbGetCrawlRun(prisma, runId), dbGetCrawlPages(prisma, runId)]);
    if (!detail?.report) {
      res.status(404).json({ error: "No completed run found", runId });
      return;
    }

    res.json(buildMeasurements(runId, detail.report, pages, detail.blocked.length));
  }),
);

// GET /api/crawls/:runId/measurements/:metricId/pages -> { rows, total, truncated }
// More segments than the route above, so there is no path ambiguity. Scoped by runId slug via the
// same Prisma read layer the Pages explorer / Overview use (dbGetCrawlPages); requireAuth (app.ts)
// gates the whole /api surface and populates req.userId. The crawl Prisma layer is not
// user-partitioned, so — exactly like the sibling pages/measurements routes — access is by runId.
measurementsRouter.get(
  "/:runId/measurements/:metricId/pages",
  asyncHandler(async (req, res) => {
    const { runId, metricId } = req.params;
    if (!isSafeId(runId) || !isSafeId(metricId)) {
      res.status(422).json({ error: "Invalid id" });
      return;
    }

    const matcher = DRILLDOWN_MATCHERS[metricId];
    if (!matcher) {
      res.status(404).json({ error: "Metric does not support drill-down", metricId });
      return;
    }

    const pages = await dbGetCrawlPages(prisma, runId);
    const matched = pages.filter(matcher);
    res.json({
      rows: matched.slice(0, DRILLDOWN_ROW_LIMIT).map((p) => ({ pageId: p.pageId, url: p.url, statusCode: p.statusCode })),
      total: matched.length,
      truncated: matched.length > DRILLDOWN_ROW_LIMIT,
    });
  }),
);
