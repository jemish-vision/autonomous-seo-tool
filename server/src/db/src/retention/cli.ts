import { loadEnv } from "../env.js";
import { createDirectPrismaClient } from "../client.js";
import { pruneOldCrawls } from "./prune.js";

async function main(): Promise<void> {
  loadEnv();
  const retain = Number(process.env.RETAIN_CRAWLS_PER_SITE ?? "10");
  const prisma = createDirectPrismaClient();
  try {
    const results = await pruneOldCrawls(prisma, retain);
    console.log(`Retention policy: keep ${retain} most recent crawls/site`);
    for (const r of results) {
      console.log(`  ${r.host}: ${r.totalCrawls} crawls -> kept ${r.retained}, deleted ${r.deleted}`);
      if (r.deletedSlugs.length) console.log(`    deleted: ${r.deletedSlugs.join(", ")}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
