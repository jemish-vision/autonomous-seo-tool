/**
 * Builds the metrics response for a linked domain from the vendored Postgres store.
 *
 * Read side of GET /api/gsc/metrics/:domain: filters stored page metrics to the requested window,
 * computes totals + daily trend, slices breakdowns, and attaches URL-inspection rows + rollup. All
 * in memory — a 28-day window of a typical site is a few thousand rows.
 *
 * Ported from poc/seo-dashboard/lib/gsc/metrics.ts. The one shape the old NEW route was missing is
 * the `range` object (latestAvailable + provisionalStart), which the client hard-requires — that is
 * produced here exactly as the reference did.
 */
import { prisma } from "../../../db/prisma.js";
import { gscReadMetrics, gscReadInspections } from "../../../db/src/gsc/store.js";
import { domainKey } from "./url.js";
import type { ResolvedRange } from "./dateRange.js";
import { latestUsableDate, provisionalStartDate } from "./dateRange.js";

type Verdict = "PASS" | "PARTIAL" | "FAIL" | "NEUTRAL" | "VERDICT_UNSPECIFIED";

export interface GscTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  pages: number;
  firstDate: string | null;
  lastDate: string | null;
}

export async function getMetricsResponse(
  userId: string,
  domain: string,
  siteUrl: string,
  propertyType: string,
  lastSyncedAt: string | null,
  range: ResolvedRange,
  searchType: "web" | "image",
  coverage: { fetched: boolean; failed?: boolean },
) {
  const key = domainKey(domain);
  const [metrics, inspections] = await Promise.all([
    gscReadMetrics(prisma, userId, key),
    gscReadInspections(prisma, userId, key),
  ]);

  const rows = (metrics?.pageMetrics ?? []).filter(
    (r) => r.searchType === searchType && r.date >= range.startDate && r.date <= range.endDate,
  );

  // Per-page totals, best-performing first.
  const byUrl = new Map<string, { pageUrl: string; clicks: number; impressions: number; ctr: number; position: number; days: number }>();
  for (const r of rows) {
    const cur = byUrl.get(r.pageUrl);
    if (!cur) {
      byUrl.set(r.pageUrl, { pageUrl: r.pageUrl, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, days: 1 });
      continue;
    }
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.days += 1;
    cur.ctr = cur.impressions > 0 ? cur.clicks / cur.impressions : 0;
    cur.position = cur.impressions > 0 ? (cur.position * (cur.impressions - r.impressions) + r.position * r.impressions) / cur.impressions : 0;
  }
  const pages = [...byUrl.values()].sort((a, b) => b.impressions - a.impressions).slice(0, 1000);

  // Daily totals for the trend line.
  const byDate = new Map<string, { date: string; clicks: number; impressions: number }>();
  for (const r of rows) {
    const cur = byDate.get(r.date);
    if (cur) {
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
    } else {
      byDate.set(r.date, { date: r.date, clicks: r.clicks, impressions: r.impressions });
    }
  }
  const trend = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  let clicks = 0;
  let impressions = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
  }
  const totals: GscTotals | null =
    impressions === 0 && rows.length === 0
      ? null
      : {
          clicks: Math.round(clicks),
          impressions: Math.round(impressions),
          ctr: impressions > 0 ? clicks / impressions : 0,
          position: impressions > 0 ? rows.reduce((acc, r) => acc + r.position * r.impressions, 0) / impressions : 0,
          pages: byUrl.size,
          firstDate: rows.length > 0 ? rows.reduce((a, b) => (a.date < b.date ? a : b)).date : null,
          lastDate: rows.length > 0 ? rows.reduce((a, b) => (a.date > b.date ? a : b)).date : null,
        };

  const windowBreakdowns = (dimension: string) =>
    (metrics?.breakdowns ?? [])
      .filter(
        (b) => b.dimension === dimension && b.searchType === searchType && b.windowStart === range.startDate && b.windowEnd === range.endDate,
      )
      .sort((a, b) => b.impressions - a.impressions);

  const inspRows = inspections?.rows ?? [];
  const coverageRollup = new Map<string, { verdict: string; coverageState: string | null; count: number }>();
  for (const i of inspRows) {
    const k = `${i.verdict}|${i.coverageState ?? ""}`;
    const cur = coverageRollup.get(k);
    if (cur) cur.count += 1;
    else coverageRollup.set(k, { verdict: i.verdict, coverageState: i.coverageState, count: 1 });
  }
  const verdictOrder: Record<string, number> = { FAIL: 0, NEUTRAL: 1, PARTIAL: 2, PASS: 3, VERDICT_UNSPECIFIED: 4 };

  return {
    property: { siteUrl, propertyType, lastSyncedAt },
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      clampedReason: range.clampedReason,
      latestAvailable: latestUsableDate(),
      provisionalStart: provisionalStartDate(range.endDate),
    },
    searchType,
    fetchedLive: coverage.fetched,
    partial: Boolean(coverage.failed),
    totals,
    trend,
    pages,
    queries: windowBreakdowns("query"),
    devices: windowBreakdowns("device"),
    countries: windowBreakdowns("country"),
    searchAppearances: windowBreakdowns("searchAppearance"),
    inspections: [...inspRows].sort((a, b) => (verdictOrder[a.verdict as Verdict] ?? 5) - (verdictOrder[b.verdict as Verdict] ?? 5)),
    coverage: [...coverageRollup.values()].sort((a, b) => b.count - a.count),
  };
}
