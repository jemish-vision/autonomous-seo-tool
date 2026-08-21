/**
 * Overview payload — everything the dashboard's home (Overview) page renders for a run, assembled
 * from Crawl + Page + Finding aggregates via the vendored read layer (dbGetCrawlRun,
 * dbGetCrawlPages, dbReadCrawlAnalysis) plus the run list for the previous-run delta. No
 * filesystem. The aggregation helpers below are ported verbatim from the old lib/data-overview.ts
 * (they were already pure functions over loaded records).
 *
 *   GET /api/crawls/:runId/overview  -> { report, analysis, statusCounts, hexMatrix, timeline,
 *                                         workQueue, kpiStrip, previousRunId }
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import {
  dbGetCrawlRun,
  dbGetCrawlPages,
  dbReadCrawlAnalysis,
  dbListCrawlRuns,
  type CrawledPageRow,
  type CrawlReportRow,
  type FailureRow,
} from "../../db/src/crawl/readStore.js";
import { isSafeId } from "../../lib/apiShared.js";

export const overviewRouter = Router();

// --- pure aggregators (ported from lib/data-overview.ts) ---------------------

type StatusClass = "2xx" | "3xx" | "4xx" | "5xx" | "blocked";

function statusClassFor(statusCode: number | null): StatusClass | null {
  if (statusCode === null) return null;
  const bucket = Math.floor(statusCode / 100);
  if (bucket === 2) return "2xx";
  if (bucket === 3) return "3xx";
  if (bucket === 4) return "4xx";
  if (bucket === 5) return "5xx";
  return null;
}

function buildStatusCounts(pages: CrawledPageRow[]): Record<"2xx" | "3xx" | "4xx" | "5xx", number> {
  const counts = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  for (const p of pages) {
    const cls = statusClassFor(p.statusCode);
    if (cls && cls !== "blocked") counts[cls]++;
  }
  return counts;
}

const LEGEND_LABELS: Record<StatusClass, string> = {
  "2xx": "Success (2xx)",
  "3xx": "Redirect (3xx)",
  "4xx": "Client error (4xx)",
  "5xx": "Server error (5xx)",
  blocked: "Blocked by robots",
};

function buildHexMatrix(pages: CrawledPageRow[], blockedUrls: string[], cols = 24) {
  const cells: { key: string; statusClass: StatusClass | "empty"; url: string | null; statusCode: number | null; pageId: string | null }[] = [];
  const counts: Record<StatusClass, number> = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, blocked: 0 };

  for (const p of pages) {
    const cls = statusClassFor(p.statusCode);
    if (!cls) continue;
    counts[cls]++;
    cells.push({ key: p.pageId, statusClass: cls, url: p.url, statusCode: p.statusCode, pageId: p.pageId });
  }
  for (const url of blockedUrls) {
    counts.blocked++;
    cells.push({ key: `blocked-${url}`, statusClass: "blocked", url, statusCode: null, pageId: null });
  }

  const total = cells.length;
  const rows = Math.ceil(total / cols) || 1;
  const padded = rows * cols;
  for (let i = total; i < padded; i++) {
    cells.push({ key: `empty-${i}`, statusClass: "empty", url: null, statusCode: null, pageId: null });
  }

  const legend = (Object.keys(counts) as StatusClass[])
    .filter((cls) => counts[cls] > 0)
    .map((cls) => ({ statusClass: cls, label: LEGEND_LABELS[cls], count: counts[cls], percent: total > 0 ? Math.round((counts[cls] / total) * 100) : 0 }));

  return { cells, legend, total };
}

function buildTimeline(pages: CrawledPageRow[]) {
  const withTime = pages.filter((p) => p.fetchedAt);
  if (withTime.length === 0) return { buckets: [], total: 0, pagesPerMinute: 0 };

  const byBucket = new Map<string, { key: string; label: string; http: number; playwright: number }>();
  for (const p of withTime) {
    const d = new Date(p.fetchedAt);
    const bucketDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
    const key = bucketDate.toISOString();
    let bucket = byBucket.get(key);
    if (!bucket) {
      bucket = { key, label: bucketDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }), http: 0, playwright: 0 };
      byBucket.set(key, bucket);
    }
    if (p.renderedWith === "playwright") bucket.playwright++;
    else bucket.http++;
  }

  const buckets = [...byBucket.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  const total = withTime.length;
  const spanMinutes = Math.max(1, buckets.length);
  return { buckets, total, pagesPerMinute: Math.round((total / spanMinutes) * 10) / 10 };
}

type WorkQueueIssue = "http-4xx" | "http-5xx" | "redirect-loop" | "noindex" | "orphan";

function buildWorkQueue(pages: CrawledPageRow[], failures: FailureRow[], orphanCandidates: string[]) {
  const rows = new Map<string, { key: string; pageId: string | null; url: string; issues: WorkQueueIssue[]; depth: number | null; responseTimeMs: number | null; statusCode: number | null }>();
  const orphanSet = new Set(orphanCandidates);

  for (const p of pages) {
    const issues: WorkQueueIssue[] = [];
    if (p.statusCode !== null && p.statusCode >= 500) issues.push("http-5xx");
    else if (p.statusCode !== null && p.statusCode >= 400) issues.push("http-4xx");
    if (p.robots.noindex && p.statusCode !== null && p.statusCode < 400) issues.push("noindex");
    if (orphanSet.has(p.normalizedUrl)) issues.push("orphan");
    if (issues.length === 0) continue;
    rows.set(p.pageId, { key: p.pageId, pageId: p.pageId, url: p.url, issues, depth: p.crawl.depth, responseTimeMs: p.performance.responseTimeMs, statusCode: p.statusCode });
  }

  for (const f of failures) {
    if (f.reason !== "redirect-loop") continue;
    const key = `failure-${f.url}`;
    if (rows.has(key)) continue;
    rows.set(key, { key, pageId: null, url: f.url, issues: ["redirect-loop"], depth: f.depth, responseTimeMs: null, statusCode: f.statusCode });
  }

  return [...rows.values()];
}

function avgResponseTime(pages: CrawledPageRow[]): number | null {
  const times = pages.map((p) => p.performance.responseTimeMs).filter((t): t is number => t !== null);
  if (times.length === 0) return null;
  return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
}

function kpi(current: number, previous: number | null, higherIsBetter: boolean) {
  if (previous === null) return { value: current, previous: null, direction: "neutral" as const, sentiment: "neutral" as const, deltaLabel: null };
  const diff = current - previous;
  if (diff === 0) return { value: current, previous, direction: "neutral" as const, sentiment: "neutral" as const, deltaLabel: "no change vs previous" };
  const positive = diff > 0;
  return {
    value: current,
    previous,
    direction: positive ? ("up" as const) : ("down" as const),
    sentiment: positive === higherIsBetter ? ("good" as const) : ("bad" as const),
    deltaLabel: `${positive ? "+" : ""}${diff} vs previous`,
  };
}

function buildKpiStrip(current: CrawlReportRow, currentPages: CrawledPageRow[], previous: CrawlReportRow | null, previousPages: CrawledPageRow[] | null) {
  const curAvg = avgResponseTime(currentPages) ?? 0;
  const prevAvg = previous && previousPages ? avgResponseTime(previousPages) : null;
  return {
    pagesCrawled: kpi(current.successful, previous?.successful ?? null, true),
    avgResponseMs: kpi(curAvg, prevAvg, false),
    jsRendered: kpi(current.jsRendered, previous?.jsRendered ?? null, true),
    internalLinks: kpi(current.internalLinks, previous?.internalLinks ?? null, true),
  };
}

// --- route -------------------------------------------------------------------

overviewRouter.get(
  "/:runId/overview",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }

    const [detail, pages, analysis, runs] = await Promise.all([
      dbGetCrawlRun(prisma, runId),
      dbGetCrawlPages(prisma, runId),
      dbReadCrawlAnalysis(prisma, runId),
      dbListCrawlRuns(prisma),
    ]);

    if (!detail?.report) {
      res.status(404).json({ error: "No completed run found", runId });
      return;
    }
    const report = detail.report;

    // Previous run = the next-oldest in the newest-first run list (matches the Overview page).
    const currentIndex = runs.findIndex((r) => r.runId === runId);
    const previousRunId = currentIndex >= 0 ? runs[currentIndex + 1]?.runId ?? null : null;
    let previousReport: CrawlReportRow | null = null;
    let previousPages: CrawledPageRow[] | null = null;
    if (previousRunId) {
      const [prevDetail, prevPages] = await Promise.all([dbGetCrawlRun(prisma, previousRunId), dbGetCrawlPages(prisma, previousRunId)]);
      if (prevDetail?.report) {
        previousReport = prevDetail.report;
        previousPages = prevPages;
      }
    }

    res.json({
      runId,
      report,
      analysis: analysis
        ? { healthScore: analysis.healthScore, counts: analysis.counts, rulesRun: analysis.rulesRun, worstPages: analysis.worstPages ?? [] }
        : null,
      statusCounts: buildStatusCounts(pages),
      hexMatrix: buildHexMatrix(pages, detail.blocked),
      timeline: buildTimeline(pages),
      workQueue: buildWorkQueue(pages, detail.failures, report.orphanCandidates),
      kpiStrip: buildKpiStrip(report, pages, previousReport, previousPages),
      previousRunId,
    });
  }),
);
