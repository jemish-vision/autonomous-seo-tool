/**
 * Pulls Search Analytics into the vendored Postgres metrics store.
 *
 * Two entry points:
 *  - `syncPropertyMetrics` is the explicit "Sync" action: pulls the default window (28 days) of
 *    per-day, per-page metrics for web + image, plus the window-aggregated breakdowns.
 *  - `ensureRangeData` is the on-demand backfill behind the date picker: fetches from Google only
 *    for what the requested range doesn't already cover.
 *
 * Ported from poc/seo-dashboard/lib/gsc/sync.ts. Adaptation: the JSON store (readMetrics/
 * writeMetrics) is replaced by the vendored Prisma store (gscReadMetrics/gscWriteMetrics); the
 * in-process write lock is kept because the foreground web fetch and the background image warm can
 * still run concurrently in this one process.
 */
import { prisma } from "../../../db/prisma.js";
import {
  gscReadMetrics,
  gscWriteMetrics,
  type GscMetricsBundle,
  type GscPageMetricRow,
  type GscBreakdownRow,
} from "../../../db/src/gsc/store.js";
import { querySearchAnalytics, MAX_ROWS_PER_REQUEST } from "./client.js";
import { toJoinKey, domainKey, propertyTypeOf } from "./url.js";
import type { DateRange } from "./dateRange.js";
import { daysBetween, latestUsableDate, provisionalStartDate } from "./dateRange.js";

const DEFAULT_SYNC_DAYS = 28;
const DATA_LAG_DAYS = 1;
const MAX_ROWS = 100_000;
const MAX_BREAKDOWN_ROWS = 5_000;

const BREAKDOWN_DIMENSIONS = ["query", "device", "country", "searchAppearance"] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];
export type SearchType = "web" | "image";

export interface SyncResult {
  siteUrl: string;
  startDate: string;
  endDate: string;
  rowsFetched: number;
  rowsWritten: number;
  pages: number;
  totalClicks: number;
  totalImpressions: number;
  breakdowns: Record<string, number>;
}

function dateWindow(days: number): DateRange {
  const end = new Date(Date.now() - DATA_LAG_DAYS * 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { startDate: iso(start), endDate: iso(end) };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Serialises read-modify-write of the metrics bundle. Without a lock the later of two concurrent
 * writers (foreground web fetch + background image warm) would clobber the earlier one's rows.
 */
let metricsWriteChain: Promise<unknown> = Promise.resolve();
function withMetricsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = metricsWriteChain.then(fn, fn);
  metricsWriteChain = run.catch(() => undefined);
  return run;
}

/** Loads (or initialises) the stored metrics bundle for a linked domain. */
async function loadMetrics(userId: string, domain: string, siteUrl: string): Promise<GscMetricsBundle> {
  const existing = await gscReadMetrics(prisma, userId, domainKey(domain));
  if (existing) return existing;
  return { siteUrl, propertyType: propertyTypeOf(siteUrl), lastSyncedAt: null, pageMetrics: [], breakdowns: [] };
}

async function saveMetrics(userId: string, domain: string, metrics: GscMetricsBundle): Promise<void> {
  await gscWriteMetrics(prisma, userId, domainKey(domain), metrics);
}

/** Explicit sync: pull the default window for both search types, upsert into storage. */
export async function syncPropertyMetrics(userId: string, domain: string, siteUrl: string): Promise<SyncResult> {
  return withMetricsLock(() => syncPropertyMetricsLocked(userId, domain, siteUrl));
}

async function syncPropertyMetricsLocked(userId: string, domain: string, siteUrl: string): Promise<SyncResult> {
  const days = Number(process.env.GSC_SYNC_DAYS) || DEFAULT_SYNC_DAYS;
  const range = dateWindow(days);
  const metrics = await loadMetrics(userId, domain, siteUrl);

  let rowsFetched = 0;
  let rowsWritten = 0;
  let totalClicks = 0;
  let totalImpressions = 0;
  const pages = new Set<string>();
  const breakdowns: Record<string, number> = {};

  for (const searchType of SEARCH_TYPES) {
    const rows = await querySearchAnalytics(userId, {
      siteUrl,
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["date", "page"],
      searchType,
      maxRows: MAX_ROWS,
    });
    rowsFetched += rows.length;
    const values = rows.flatMap((r) => {
      const [date, pageUrl] = r.keys;
      if (!date || !pageUrl) return [];
      pages.add(pageUrl);
      totalClicks += r.clicks;
      totalImpressions += r.impressions;
      return [
        {
          date,
          pageUrl,
          normalizedUrl: toJoinKey(pageUrl),
          searchType,
          clicks: Math.round(r.clicks),
          impressions: Math.round(r.impressions),
          ctr: r.ctr,
          position: r.position,
        },
      ];
    });
    rowsWritten += upsertPageMetrics(metrics, values);
    for (const dimension of BREAKDOWN_DIMENSIONS) {
      breakdowns[`${searchType}:${dimension}`] = syncBreakdown(await fetchBreakdown(userId, siteUrl, searchType, dimension, range), metrics, searchType, dimension, range);
    }
  }

  metrics.lastSyncedAt = new Date().toISOString();
  await saveMetrics(userId, domain, metrics);

  return {
    siteUrl,
    startDate: range.startDate,
    endDate: range.endDate,
    rowsFetched,
    rowsWritten,
    pages: pages.size,
    totalClicks: Math.round(totalClicks),
    totalImpressions: Math.round(totalImpressions),
    breakdowns,
  };
}

const SEARCH_TYPES: SearchType[] = ["web", "image"];

async function fetchBreakdown(
  userId: string,
  siteUrl: string,
  searchType: SearchType,
  dimension: BreakdownDimension,
  range: DateRange,
): Promise<GscBreakdownRow[]> {
  const rows = await querySearchAnalytics(userId, {
    siteUrl,
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: [dimension],
    searchType,
    maxRows: MAX_BREAKDOWN_ROWS,
  });

  return rows.flatMap((r) => {
    const keyValue = r.keys[0];
    if (!keyValue) return [];
    return [
      {
        dimension,
        searchType,
        keyValue,
        windowStart: range.startDate,
        windowEnd: range.endDate,
        clicks: Math.round(r.clicks),
        impressions: Math.round(r.impressions),
        ctr: r.ctr,
        position: r.position,
      },
    ];
  });
}

/** Replace this window's rows for this dimension (idempotent by construction). Returns count. */
function syncBreakdown(
  values: GscBreakdownRow[],
  metrics: GscMetricsBundle,
  searchType: SearchType,
  dimension: BreakdownDimension,
  range: DateRange,
): number {
  metrics.breakdowns = metrics.breakdowns.filter(
    (b) => !(b.dimension === dimension && b.searchType === searchType && b.windowStart === range.startDate && b.windowEnd === range.endDate),
  );
  metrics.breakdowns.push(...values);
  return values.length;
}

function upsertPageMetrics(metrics: GscMetricsBundle, values: GscPageMetricRow[]): number {
  const key = (row: GscPageMetricRow) => `${row.date}|${row.pageUrl}|${row.searchType}`;
  // Index once, not per value — a large window on a big property is tens of thousands of rows, and
  // findIndex per row would be quadratic.
  const indexByKey = new Map<string, number>();
  metrics.pageMetrics.forEach((r, i) => indexByKey.set(key(r), i));
  let written = 0;
  for (const v of values) {
    const k = key(v);
    const idx = indexByKey.get(k);
    if (idx !== undefined) {
      metrics.pageMetrics[idx] = v;
    } else {
      indexByKey.set(k, metrics.pageMetrics.length);
      metrics.pageMetrics.push(v);
    }
    written++;
  }
  return written;
}

export interface CoverageResult {
  fetched: boolean;
  daysFetched: number;
  rowsWritten: number;
  failed?: boolean;
}

/** Whether every day in the range already has stored rows (span check, not row count). */
function isCovered(metrics: GscMetricsBundle, range: DateRange, searchType: SearchType): boolean {
  let first: string | null = null;
  let last: string | null = null;
  for (const r of metrics.pageMetrics) {
    if (r.searchType !== searchType) continue;
    if (first === null || r.date < first) first = r.date;
    if (last === null || r.date > last) last = r.date;
  }
  if (!first || !last) return false;
  return first <= range.startDate && last >= range.endDate;
}

/** Guarantees page-level rows and this window's breakdowns exist for `range`. */
export async function ensureRangeData(
  userId: string,
  domain: string,
  siteUrl: string,
  range: DateRange,
  searchType: SearchType,
): Promise<CoverageResult> {
  return withMetricsLock(() => ensureRangeDataLocked(userId, domain, siteUrl, range, searchType));
}

async function ensureRangeDataLocked(
  userId: string,
  domain: string,
  siteUrl: string,
  range: DateRange,
  searchType: SearchType,
): Promise<CoverageResult> {
  const metrics = await loadMetrics(userId, domain, siteUrl);

  const touchesProvisionalData = range.endDate >= provisionalStartDate(latestUsableDate());
  const needsPages = !isCovered(metrics, range, searchType) || touchesProvisionalData;
  const haveBreakdowns = metrics.breakdowns.filter(
    (b) => b.searchType === searchType && b.windowStart === range.startDate && b.windowEnd === range.endDate,
  ).length;

  if (!needsPages && haveBreakdowns >= BREAKDOWN_DIMENSIONS.length) {
    return { fetched: false, daysFetched: 0, rowsWritten: 0 };
  }

  let rowsWritten = 0;

  if (needsPages) {
    const rows = await querySearchAnalytics(userId, {
      siteUrl,
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["date", "page"],
      searchType,
      maxRows: MAX_ROWS,
    });
    const values = rows.flatMap((r) => {
      const [date, pageUrl] = r.keys;
      if (!date || !pageUrl) return [];
      return [
        {
          date,
          pageUrl,
          normalizedUrl: toJoinKey(pageUrl),
          searchType,
          clicks: Math.round(r.clicks),
          impressions: Math.round(r.impressions),
          ctr: r.ctr,
          position: r.position,
        },
      ];
    });
    rowsWritten += upsertPageMetrics(metrics, values);
  }

  if (touchesProvisionalData || haveBreakdowns < BREAKDOWN_DIMENSIONS.length) {
    for (const dimension of BREAKDOWN_DIMENSIONS) {
      rowsWritten += syncBreakdown(await fetchBreakdown(userId, siteUrl, searchType, dimension, range), metrics, searchType, dimension, range);
    }
  }

  metrics.lastSyncedAt = metrics.lastSyncedAt ?? new Date().toISOString();
  await saveMetrics(userId, domain, metrics);

  return { fetched: true, daysFetched: daysBetween(range), rowsWritten };
}

export { MAX_ROWS_PER_REQUEST };
