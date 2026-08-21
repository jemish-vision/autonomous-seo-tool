/**
 * Overview-only aggregation helpers layered on top of lib/data.ts's read primitives (never
 * edited — S10 owns it). Pure functions over already-loaded records; no filesystem access here.
 */
import type { CrawledPageWithId, CrawlSummary, FailureRecord } from "./types";

export type StatusClass = "2xx" | "3xx" | "4xx" | "5xx" | "blocked";

export function statusClassFor(statusCode: number | null): StatusClass | null {
  if (statusCode === null) return null;
  const bucket = Math.floor(statusCode / 100);
  if (bucket === 2) return "2xx";
  if (bucket === 3) return "3xx";
  if (bucket === 4) return "4xx";
  if (bucket === 5) return "5xx";
  return null;
}

export type StatusCounts = Record<"2xx" | "3xx" | "4xx" | "5xx", number>;

/** Buckets crawled pages by final HTTP status class, from the same `pages` array (real page
 *  records only) that /pages?status=X filters over — this is the single source of truth for the
 *  Overview status chips, so a chip's count and its destination's row count can't diverge again.
 *  Excludes failures that never produced a page record (e.g. a request blocked after retries) —
 *  those live in failures.json and are only ever shown in the failures section of /sitemap,
 *  never at /pages. */
export function buildStatusCounts(pages: CrawledPageWithId[]): StatusCounts {
  const counts: StatusCounts = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  for (const p of pages) {
    const cls = statusClassFor(p.statusCode);
    if (cls && cls !== "blocked") counts[cls]++;
  }
  return counts;
}

export interface HexCell {
  key: string;
  statusClass: StatusClass | "empty";
  url: string | null;
  statusCode: number | null;
  pageId: string | null;
}

export interface HexLegendRow {
  statusClass: StatusClass;
  label: string;
  count: number;
  percent: number;
}

const LEGEND_LABELS: Record<StatusClass, string> = {
  "2xx": "Success (2xx)",
  "3xx": "Redirect (3xx)",
  "4xx": "Client error (4xx)",
  "5xx": "Server error (5xx)",
  blocked: "Blocked by robots",
};

export interface HexMatrixData {
  cells: HexCell[];
  legend: HexLegendRow[];
  total: number;
}

/** One hex per crawled page + one per blocked URL, padded to a full grid with empty cells. */
export function buildHexMatrix(pages: CrawledPageWithId[], blockedUrls: string[], cols = 24): HexMatrixData {
  const cells: HexCell[] = [];
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

  const legend: HexLegendRow[] = (Object.keys(counts) as StatusClass[])
    .filter((cls) => counts[cls] > 0)
    .map((cls) => ({
      statusClass: cls,
      label: LEGEND_LABELS[cls],
      count: counts[cls],
      percent: total > 0 ? Math.round((counts[cls] / total) * 100) : 0,
    }));

  return { cells, legend, total };
}

export interface TimelineBucket {
  key: string;
  label: string;
  http: number;
  playwright: number;
}

export interface TimelineData {
  buckets: TimelineBucket[];
  total: number;
  pagesPerMinute: number;
}

/** Groups pages into 1-minute buckets by fetchedAt, split by rendering strategy (two-tone stack). */
export function buildTimeline(pages: CrawledPageWithId[]): TimelineData {
  const withTime = pages.filter((p) => p.fetchedAt);
  if (withTime.length === 0) return { buckets: [], total: 0, pagesPerMinute: 0 };

  const byBucket = new Map<string, TimelineBucket>();
  for (const p of withTime) {
    const d = new Date(p.fetchedAt);
    const bucketDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
    const key = bucketDate.toISOString();
    let bucket = byBucket.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: bucketDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
        http: 0,
        playwright: 0,
      };
      byBucket.set(key, bucket);
    }
    if (p.renderedWith === "playwright") bucket.playwright++;
    else bucket.http++;
  }

  const buckets = [...byBucket.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  const total = withTime.length;
  const spanMinutes = Math.max(1, buckets.length);
  const pagesPerMinute = Math.round((total / spanMinutes) * 10) / 10;

  return { buckets, total, pagesPerMinute };
}

export type WorkQueueIssue = "http-4xx" | "http-5xx" | "redirect-loop" | "noindex" | "orphan";

export interface WorkQueueRow {
  key: string;
  pageId: string | null;
  url: string;
  issues: WorkQueueIssue[];
  depth: number | null;
  responseTimeMs: number | null;
  statusCode: number | null;
}

const ISSUE_LABEL: Record<WorkQueueIssue, string> = {
  "http-4xx": "4xx",
  "http-5xx": "5xx",
  "redirect-loop": "Redirect loop",
  noindex: "Noindex",
  orphan: "Orphan",
};

export function issueLabel(issue: WorkQueueIssue): string {
  return ISSUE_LABEL[issue];
}

/** Merges 4xx/5xx pages, noindex-on-crawlable pages, orphan candidates, and redirect-loop failures. */
export function buildWorkQueue(pages: CrawledPageWithId[], failures: FailureRecord[], orphanCandidates: string[]): WorkQueueRow[] {
  const rows = new Map<string, WorkQueueRow>();
  const orphanSet = new Set(orphanCandidates);

  for (const p of pages) {
    const issues: WorkQueueIssue[] = [];
    if (p.statusCode !== null && p.statusCode >= 500) issues.push("http-5xx");
    else if (p.statusCode !== null && p.statusCode >= 400) issues.push("http-4xx");
    if (p.robots.noindex && p.statusCode !== null && p.statusCode < 400) issues.push("noindex");
    if (orphanSet.has(p.normalizedUrl)) issues.push("orphan");
    if (issues.length === 0) continue;
    rows.set(p.pageId, {
      key: p.pageId,
      pageId: p.pageId,
      url: p.url,
      issues,
      depth: p.crawl.depth,
      responseTimeMs: p.performance.responseTimeMs,
      statusCode: p.statusCode,
    });
  }

  for (const f of failures) {
    if (f.reason !== "redirect-loop") continue;
    const key = `failure-${f.url}`;
    if (rows.has(key)) continue;
    rows.set(key, {
      key,
      pageId: null,
      url: f.url,
      issues: ["redirect-loop"],
      depth: f.depth,
      responseTimeMs: null,
      statusCode: f.statusCode,
    });
  }

  return [...rows.values()];
}

export interface KpiValue {
  value: number;
  previous: number | null;
  /** Literal arithmetic sign of the change — the arrow always matches what actually happened. */
  direction: "up" | "down" | "neutral";
  /** Good/bad given the metric's polarity — decoupled from `direction` so a drop in a
   *  lower-is-better metric (e.g. avg response time) still reads as "good" in color, even though
   *  the arrow points down. DeltaPill (do-not-touch, S8-owned) hardcodes up=green/down=red, so
   *  callers that need this decoupling render their own pill from `direction` + `sentiment`
   *  instead of feeding this straight into DeltaPill (see components/overview/kpi-strip.tsx). */
  sentiment: "good" | "bad" | "neutral";
  deltaLabel: string | null;
}

function kpi(current: number, previous: number | null, higherIsBetter: boolean): KpiValue {
  if (previous === null) return { value: current, previous: null, direction: "neutral", sentiment: "neutral", deltaLabel: null };
  const diff = current - previous;
  if (diff === 0) return { value: current, previous, direction: "neutral", sentiment: "neutral", deltaLabel: "no change vs previous" };
  const positive = diff > 0;
  const sentiment: KpiValue["sentiment"] = positive === higherIsBetter ? "good" : "bad";
  return {
    value: current,
    previous,
    direction: positive ? "up" : "down",
    sentiment,
    deltaLabel: `${positive ? "+" : ""}${diff} vs previous`,
  };
}

export function avgResponseTime(pages: CrawledPageWithId[]): number | null {
  const times = pages.map((p) => p.performance.responseTimeMs).filter((t): t is number => t !== null);
  if (times.length === 0) return null;
  return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
}

export interface KpiStrip {
  pagesCrawled: KpiValue;
  avgResponseMs: KpiValue;
  jsRendered: KpiValue;
  internalLinks: KpiValue;
}

export function buildKpiStrip(
  current: CrawlSummary,
  currentPages: CrawledPageWithId[],
  previous: CrawlSummary | null,
  previousPages: CrawledPageWithId[] | null,
): KpiStrip {
  const curAvg = avgResponseTime(currentPages) ?? 0;
  const prevAvg = previous && previousPages ? avgResponseTime(previousPages) : null;
  return {
    pagesCrawled: kpi(current.successful, previous?.successful ?? null, true),
    avgResponseMs: kpi(curAvg, prevAvg, false),
    jsRendered: kpi(current.jsRendered, previous?.jsRendered ?? null, true),
    internalLinks: kpi(current.internalLinks, previous?.internalLinks ?? null, true),
  };
}

/** Filtered-list destination for a hex/timeline legend row — design-dna-v2 Law 1 (every number links). */
export function pagesHrefForStatusClass(runId: string, cls: StatusClass): string {
  const q = `run=${encodeURIComponent(runId)}`;
  return cls === "blocked" ? `/sitemap?${q}#failures` : `/pages?${q}&status=${cls}`;
}

export function pagesHrefForRenderMode(runId: string, mode: "http" | "playwright"): string {
  return `/pages?run=${encodeURIComponent(runId)}&rendered=${mode}`;
}

/** Top N failure classes by count, for the "Failed URLs" action card footnote. */
export function topFailureClasses(failuresByClass: Record<string, number>, n = 2): string {
  const entries = Object.entries(failuresByClass).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "no failures recorded";
  return entries
    .slice(0, n)
    .map(([cls, count]) => `${cls} (${count})`)
    .join(", ");
}
