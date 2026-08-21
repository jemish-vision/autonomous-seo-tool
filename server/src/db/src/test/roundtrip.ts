import path from "node:path";
import { loadEnv } from "../env.js";
import { createDirectPrismaClient } from "../client.js";
import { syncRunToPostgres } from "../sync/syncRun.js";

/** Writes one real run to Postgres and reads it back, reporting row counts per table. */
const RUN_ID = process.argv[2] ?? "ui-20260812-102522";
const RUNS_DIR = path.resolve(process.cwd(), "..", "..", "poc", "seo-crawler-poc", "storage", "runs");

async function main(): Promise<void> {
  loadEnv();
  const prisma = createDirectPrismaClient();
  try {
    const runDir = path.join(RUNS_DIR, RUN_ID);
    console.log(`Syncing ${RUN_ID} from ${runDir} ...`);
    const result = await syncRunToPostgres(prisma, runDir, RUN_ID, { allowFindings: true });
    console.log("Sync result:", JSON.stringify(result, null, 2));

    const [
      crawl,
      pageCount,
      contentCount,
      linkCount,
      imageCount,
      headingCount,
      sdCount,
      redirectCount,
      failureCount,
      blockedCount,
      siteFileCount,
      sitemapEntryCount,
      findingCount,
      issueCount,
    ] = await Promise.all([
      prisma.crawl.findUnique({ where: { id: result.crawlId } }),
      prisma.page.count({ where: { crawlId: result.crawlId } }),
      prisma.pageContent.count({ where: { crawlId: result.crawlId } }),
      prisma.pageLink.count({ where: { crawlId: result.crawlId } }),
      prisma.pageImage.count({ where: { crawlId: result.crawlId } }),
      prisma.pageHeading.count({ where: { crawlId: result.crawlId } }),
      prisma.structuredDataItem.count({ where: { crawlId: result.crawlId } }),
      prisma.pageRedirectHop.count({ where: { crawlId: result.crawlId } }),
      prisma.failure.count({ where: { crawlId: result.crawlId } }),
      prisma.blockedUrl.count({ where: { crawlId: result.crawlId } }),
      prisma.siteFile.count({ where: { crawlId: result.crawlId } }),
      prisma.sitemapEntry.count({ where: { crawlId: result.crawlId } }),
      prisma.finding.count({ where: { crawlId: result.crawlId } }),
      prisma.issue.count({ where: { crawlId: result.crawlId } }),
    ]);

    console.log("\n--- Read-back row counts (real query, real data) ---");
    console.log({
      crawlStatus: crawl?.status,
      crawlPagesCrawled: crawl?.pagesCrawled,
      crawlFilterCounts: crawl?.filterCounts,
      pages: pageCount,
      page_contents: contentCount,
      page_links: linkCount,
      page_images: imageCount,
      page_headings: headingCount,
      structured_data_items: sdCount,
      page_redirect_hops: redirectCount,
      failures: failureCount,
      blocked_urls: blockedCount,
      site_files: siteFileCount,
      sitemap_entries: sitemapEntryCount,
      findings: findingCount,
      issues: issueCount,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
