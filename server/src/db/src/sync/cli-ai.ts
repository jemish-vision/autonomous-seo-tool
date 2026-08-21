import { loadEnv } from "../env.js";
import { createDirectPrismaClient } from "../client.js";
import { syncAiRecommendations } from "./syncAiRecommendations.js";

/** npm run sync:ai -- <storageRoot> <runId>
 *  storageRoot = the crawler storage root (e.g. ../poc/seo-crawler-poc/storage); the run dir is
 *  <storageRoot>/runs/<runId>, matching the crawler's maybeSyncRunToPostgres caller. */
async function main(): Promise<void> {
  loadEnv();
  const [storageRoot, runId] = process.argv.slice(2);
  if (!storageRoot || !runId) {
    console.error("usage: npm run sync:ai -- <storageRoot> <runId>");
    process.exit(1);
  }
  const prisma = createDirectPrismaClient();
  try {
    const result = await syncAiRecommendations(prisma, `${storageRoot}/runs/${runId}`, runId);
    console.log(
      `[ai-sync] ${result.runId}: crawl=${result.crawlId ?? "NOT FOUND"} total=${result.totalInFile} ` +
        `inserted=${result.inserted} updated=${result.updated} unlinked=${result.unlinked}`,
    );
    for (const u of result.unlinkedReasons) {
      console.log(`  unlinked: ${u.ruleSlug || "(none)"} page=${u.pageKey ?? "site"} instance=${u.instanceKey ?? "-"} — ${u.reason}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
