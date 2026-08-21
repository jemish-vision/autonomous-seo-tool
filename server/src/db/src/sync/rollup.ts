import type { PrismaClient } from "../../generated/client/index.js";

/**
 * Crawl-close rollups (PLAN-02-Data-Model.md §7.4 step 7) — makes an imported/synced run
 * indistinguishable from a native one for every screen that reads these derived columns.
 * Runs as a handful of set-based SQL statements, never per-row Node loops (P4).
 */
export async function runRollups(prisma: PrismaClient, crawlId: string): Promise<void> {
  // Backfill PageLink.targetPageId by matching the normalized target URL within this crawl.
  await prisma.$executeRawUnsafe(
    `UPDATE page_links pl SET "targetPageId" = p.id
     FROM pages p
     WHERE pl."crawlId" = $1::uuid AND p."crawlId" = $1::uuid
       AND pl."targetPageId" IS NULL
       AND pl."targetNormalized" = p."normalizedUrl"`,
    crawlId,
  );

  // Page.inlinkCount from resolved internal links. uniqueInlinkCount is approximated as the same
  // value here (true distinct-source counting needs a second GROUP BY on pageId — deferred, POC).
  await prisma.$executeRawUnsafe(
    `UPDATE pages p SET "inlinkCount" = sub.cnt, "uniqueInlinkCount" = sub.cnt
     FROM (
       SELECT "targetPageId" AS pid, count(*) AS cnt
       FROM page_links
       WHERE "crawlId" = $1::uuid AND "targetPageId" IS NOT NULL
       GROUP BY "targetPageId"
     ) sub
     WHERE p.id = sub.pid AND p."crawlId" = $1::uuid`,
    crawlId,
  );

  // Orphan = zero inbound internal links and not the start page (depth 0 always has 0 inlinks).
  await prisma.$executeRawUnsafe(
    `UPDATE pages SET "isOrphan" = true
     WHERE "crawlId" = $1::uuid AND "inlinkCount" = 0 AND depth > 0`,
    crawlId,
  );

  // SitemapEntry.crawled — resolved once at close instead of an anti-join per request (§4.7).
  await prisma.$executeRawUnsafe(
    `UPDATE sitemap_entries se SET crawled = true, "pageId" = p.id, "statusCode" = p."statusCode"
     FROM pages p
     WHERE se."crawlId" = $1::uuid AND p."crawlId" = $1::uuid AND se."normalizedLoc" = p."normalizedUrl"`,
    crawlId,
  );

  const [noindex, orphan, missingAlt, errors, needsJs] = await Promise.all([
    prisma.page.count({ where: { crawlId, noindex: true } }),
    prisma.page.count({ where: { crawlId, isOrphan: true } }),
    prisma.page.count({ where: { crawlId, imagesMissingAlt: { gt: 0 } } }),
    prisma.page.count({ where: { crawlId, statusCode: { gte: 400 } } }),
    prisma.page.count({ where: { crawlId, likelyClientRendered: true } }),
  ]);

  await prisma.crawl.update({
    where: { id: crawlId },
    data: { filterCounts: { noindex, orphan, missingAlt, errors, needsJs } },
  });
}
