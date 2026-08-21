import type { PrismaClient } from "../../generated/client/index.js";

export interface PruneResult {
  siteId: string;
  host: string;
  totalCrawls: number;
  retained: number;
  deleted: number;
  deletedSlugs: string[];
}

/**
 * Policy knob, not a wall hit at 3am (brief): keep only the N most recent crawls per site.
 * page_links alone is ~3.5 GB per 100k-page crawl (PLAN-02 §8.3) — two full crawls already
 * exceed Supabase Pro's included 8 GB, so this must be a dial the owner can turn, not a fixed cap.
 * Deletes Crawl rows past the Nth most recent (by startedAt); Prisma's onDelete: Cascade on every
 * child FK (pages, page_links, findings, ...) removes everything under them in one statement.
 */
export async function pruneOldCrawls(prisma: PrismaClient, retainPerSite: number): Promise<PruneResult[]> {
  const sites = await prisma.site.findMany({ select: { id: true, host: true } });
  const results: PruneResult[] = [];

  for (const site of sites) {
    const crawls = await prisma.crawl.findMany({
      where: { siteId: site.id, deletedAt: null },
      orderBy: { startedAt: "desc" },
      select: { id: true, slug: true },
    });

    const toDelete = crawls.slice(retainPerSite);
    if (toDelete.length > 0) {
      await prisma.crawl.deleteMany({ where: { id: { in: toDelete.map((c) => c.id) } } });
    }

    results.push({
      siteId: site.id,
      host: site.host,
      totalCrawls: crawls.length,
      retained: Math.min(crawls.length, retainPerSite),
      deleted: toDelete.length,
      deletedSlugs: toDelete.map((c) => c.slug),
    });
  }

  return results;
}
