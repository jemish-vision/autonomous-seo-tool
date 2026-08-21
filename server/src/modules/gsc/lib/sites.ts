/**
 * The dashboard's "site" concept for GSC, backed by the crawl tables.
 *
 * This app has no website entity — its unit is the crawl run, each with a start URL. Search Console
 * is site-scoped, so sites are derived from those start URLs: one site per normalised domain.
 *
 * Ported from poc/seo-dashboard/lib/gsc/sites.ts. The old app read crawl runs/pages from flat JSON
 * (lib/data.ts); here they come from Postgres via the vendored crawl read store.
 */
import { prisma } from "../../../db/prisma.js";
import { dbListCrawlRuns, dbGetCrawlPages } from "../../../db/src/crawl/readStore.js";
import { hostnameOf } from "./url.js";

export interface CrawledSite {
  domain: string;
  startUrl: string;
  runCount: number;
  lastCrawledAt: string | null;
}

function domainOf(startUrl: string): string | null {
  const host = hostnameOf(startUrl);
  if (!host) return null;
  return host.replace(/^www\./i, "").replace(/:\d+$/, "");
}

/** Every domain this app has crawled, newest run first per domain. */
export async function listCrawledSites(): Promise<CrawledSite[]> {
  const runs = await dbListCrawlRuns(prisma);
  const byDomain = new Map<string, { startUrl: string; lastCrawledAt: string | null; count: number }>();
  for (const run of runs) {
    const domain = domainOf(run.startUrl);
    if (!domain) continue;
    const cur = byDomain.get(domain);
    if (cur) {
      cur.count += 1;
      if (!cur.lastCrawledAt || run.startedAt > cur.lastCrawledAt) cur.lastCrawledAt = run.startedAt;
    } else {
      byDomain.set(domain, { startUrl: run.startUrl, lastCrawledAt: run.startedAt || null, count: 1 });
    }
  }
  return [...byDomain.entries()]
    .map(([domain, v]) => ({ domain, startUrl: v.startUrl, runCount: v.count, lastCrawledAt: v.lastCrawledAt }))
    .sort((a, b) => b.lastCrawledAt?.localeCompare(a.lastCrawledAt ?? "") ?? 0);
}

/** All unique crawled URLs across every run for this domain ([] when the domain has no run). */
export async function allPagesForDomain(domain: string): Promise<string[]> {
  const target = domain.toLowerCase().replace(/^www\./i, "").replace(/:\d+$/, "");
  const runs = await dbListCrawlRuns(prisma);
  const allUrls = new Set<string>();

  for (const run of runs) {
    if (domainOf(run.startUrl) !== target) continue;
    try {
      const pages = await dbGetCrawlPages(prisma, run.runId);
      for (const p of pages) {
        if (p.url && p.url.startsWith("http")) allUrls.add(p.url);
      }
    } catch {
      // ignore unreadable runs
    }
  }

  return [...allUrls];
}
