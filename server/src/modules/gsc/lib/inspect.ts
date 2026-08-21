/**
 * Batched URL Inspection against Google's index.
 *
 * The URL Inspection API allows 2,000 URLs per property per day. Runs are prioritised by
 * impressions descending (a page with traffic being quietly dropped from the index is an
 * emergency), then crawled pages Google has never sent traffic to. Quota is metered from attempts
 * (Google charges for every call, including failures), not from stored rows.
 *
 * Ported from poc/seo-dashboard/lib/gsc/inspect.ts. Adaptations: readInspections/writeInspections/
 * readMetrics come from the vendored Prisma store; allPagesForDomain reads crawled URLs from the
 * Postgres crawl tables instead of flat JSON.
 */
import { prisma } from "../../../db/prisma.js";
import {
  gscReadInspections,
  gscWriteInspections,
  gscReadMetrics,
  type GscInspectionRow,
  type GscInspectionsBundle,
} from "../../../db/src/gsc/store.js";
import { allPagesForDomain } from "./sites.js";
import { GscApiError, inspectUrl, querySearchAnalytics, listSitemaps } from "./client.js";
import { defaultRange } from "./dateRange.js";
import { domainKey } from "./url.js";

const DAILY_QUOTA = 2_000;
const DEFAULT_BATCH = 50;
const RECHECK_AFTER_DAYS = 7;
const CONCURRENCY = 8;
const THROTTLE_MS = 80;

type Verdict = "PASS" | "PARTIAL" | "FAIL" | "NEUTRAL" | "VERDICT_UNSPECIFIED";
const VERDICTS: Verdict[] = ["PASS", "PARTIAL", "FAIL", "NEUTRAL", "VERDICT_UNSPECIFIED"];
const toVerdict = (v: string | undefined): Verdict => (VERDICTS.includes(v as Verdict) ? (v as Verdict) : "VERDICT_UNSPECIFIED");

export interface GscInspectionRunResult {
  inspected: number;
  failed: number;
  remaining: number;
  quotaUsedToday: number;
  quotaRemainingToday: number;
  stoppedReason: string | null;
  quotaDisagreement: boolean;
  byVerdict: Record<string, number>;
}

/** Pacific date key (Google's quota resets at midnight Pacific). */
function pacificDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function countAttemptsToday(attempts: Array<{ date: string; succeeded: boolean }>): number {
  const today = pacificDateKey(new Date());
  return attempts.filter((a) => a.date === today).length;
}

export async function inspectPropertyUrls(
  userId: string,
  domain: string,
  siteUrl: string,
  batchSize = DEFAULT_BATCH,
): Promise<GscInspectionRunResult> {
  const key = domainKey(domain);
  const store: GscInspectionsBundle = (await gscReadInspections(prisma, userId, key)) ?? { rows: [], attempts: [] };
  const quotaUsedToday = countAttemptsToday(store.attempts);
  const quotaLeft = Math.max(0, DAILY_QUOTA - quotaUsedToday);

  // 1. Gather crawled URLs across all crawl runs for this domain
  const crawledUrls = await allPagesForDomain(domain);

  // 2. Gather URLs from stored metrics
  const candidateImpressions = new Map<string, number>();
  const metrics = await gscReadMetrics(prisma, userId, key);
  for (const m of metrics?.pageMetrics ?? []) {
    if (m.pageUrl && m.pageUrl.startsWith("http")) {
      const cur = candidateImpressions.get(m.pageUrl) ?? 0;
      candidateImpressions.set(m.pageUrl, cur + m.impressions);
    }
  }

  // 3. Live GSC Search Analytics page discovery (up to 25,000 URLs known to Google)
  try {
    const range = defaultRange(90);
    const gscPageRows = await querySearchAnalytics(userId, {
      siteUrl,
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["page"],
      maxRows: 25000,
    });
    for (const r of gscPageRows) {
      const pUrl = r.keys[0];
      if (pUrl && pUrl.startsWith("http")) {
        const cur = candidateImpressions.get(pUrl) ?? 0;
        candidateImpressions.set(pUrl, cur + Math.round(r.impressions || 0));
      }
    }
  } catch (liveErr) {
    console.warn("[gsc inspect] Live GSC page discovery notice:", liveErr instanceof Error ? liveErr.message : liveErr);
  }

  // 4. Sitemaps URL discovery
  try {
    const sitemaps = await listSitemaps(userId, siteUrl);
    for (const sm of sitemaps) {
      if (sm.path && sm.path.startsWith("http") && !sm.path.endsWith(".xml")) {
        if (!candidateImpressions.has(sm.path)) candidateImpressions.set(sm.path, 0);
      }
    }
  } catch {
    // ignore
  }

  // 5. Build full candidate set and pending list
  const candidates = new Set<string>([...candidateImpressions.keys(), ...crawledUrls]);
  const pending = [...candidates].filter((url) => {
    const row = store.rows.find((r) => r.pageUrl === url);
    if (!row) return true; // never inspected yet
    const ageMs = Date.now() - new Date(row.inspectedAt).getTime();
    return ageMs > RECHECK_AFTER_DAYS * 86_400_000; // recheck due
  });

  // Sort: highest impressions first, then uninspected URLs
  pending.sort((a, b) => (candidateImpressions.get(b) ?? 0) - (candidateImpressions.get(a) ?? 0));

  if (quotaLeft === 0) {
    return {
      inspected: 0,
      failed: 0,
      remaining: pending.length,
      quotaUsedToday,
      quotaRemainingToday: 0,
      stoppedReason: `Daily quota of ${DAILY_QUOTA} URL inspections for this property is spent. It resets at midnight Pacific time.`,
      quotaDisagreement: false,
      byVerdict: {},
    };
  }

  const limit = Math.min(batchSize, quotaLeft, pending.length);
  const selected = pending.slice(0, limit);

  let inspected = 0;
  let failed = 0;
  let stoppedReason: string | null = null;
  let quotaDisagreement = false;
  const byVerdict: Record<string, number> = {};
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (stoppedReason !== null) return;
      const index = cursor++;
      if (index >= selected.length) return;
      const pageUrl = selected[index] as string;
      await inspectOne(pageUrl);
      await sleep(THROTTLE_MS);
    }
  }

  function recordAttempt(succeeded: boolean): void {
    store.attempts.push({ date: pacificDateKey(new Date()), succeeded });
  }

  async function inspectOne(pageUrl: string): Promise<void> {
    try {
      const result = await inspectUrl(userId, siteUrl, pageUrl);
      recordAttempt(true);
      const status = result.indexStatusResult ?? {};
      const verdict = toVerdict(status.verdict);
      const raw = {
        inspectionResultLink: result.inspectionResultLink ?? null,
        referringUrls: status.referringUrls ?? [],
        richResults: result.richResultsResult ?? null,
        amp: result.ampResult ?? null,
        mobileUsability: result.mobileUsabilityResult ?? null,
      };

      const row: GscInspectionRow = {
        pageUrl,
        verdict,
        coverageState: status.coverageState ?? null,
        robotsTxtState: status.robotsTxtState ?? null,
        indexingState: status.indexingState ?? null,
        pageFetchState: status.pageFetchState ?? null,
        googleCanonical: status.googleCanonical ?? null,
        userCanonical: status.userCanonical ?? null,
        lastCrawlTime: status.lastCrawlTime ? new Date(status.lastCrawlTime).toISOString() : null,
        crawledAs: status.crawledAs ?? null,
        sitemaps: status.sitemap ?? null,
        raw,
        inspectedAt: new Date().toISOString(),
      };
      const idx = store.rows.findIndex((r) => r.pageUrl === pageUrl);
      if (idx >= 0) store.rows[idx] = row;
      else store.rows.push(row);

      inspected += 1;
      byVerdict[verdict] = (byVerdict[verdict] ?? 0) + 1;
    } catch (err) {
      recordAttempt(false);
      if (err instanceof GscApiError && err.status === 429) {
        quotaDisagreement = true;
        stoppedReason =
          "Google says the daily allowance for this property is spent, even though our own count had budget left. " +
          "Google counts every API call including failures, so treat its answer as the real one and retry after midnight Pacific.";
        return;
      }
      failed += 1;
      console.error(`[gsc] inspect failed for ${pageUrl}:`, err instanceof Error ? err.message : err);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, selected.length) }, worker));

  // Trim the attempts log to the last 5 days — the quota window is a single day.
  store.attempts = store.attempts.filter((a) => {
    const ageMs = Date.now() - new Date(`${a.date}T12:00:00-07:00`).getTime();
    return ageMs < 5 * 86_400_000;
  });
  await gscWriteInspections(prisma, userId, key, store);

  const used = quotaUsedToday + inspected;
  const remaining = Math.max(0, pending.length - inspected);
  return {
    inspected,
    failed,
    remaining,
    quotaUsedToday: used,
    quotaRemainingToday: quotaDisagreement ? 0 : Math.max(0, DAILY_QUOTA - used),
    stoppedReason,
    quotaDisagreement,
    byVerdict,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
