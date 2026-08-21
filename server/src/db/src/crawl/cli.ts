import path from "node:path";
import { loadEnv } from "../env.js";
import { createPrismaClient } from "../client.js";
import { importIssuesToPostgres } from "./importIssues.js";

async function main(): Promise<void> {
  const [, , runId] = process.argv;
  if (!runId) {
    console.error("Usage: npm run import:findings -- <runId> [--dir <runDir>]");
    process.exit(1);
  }
  const dirFlag = process.argv.indexOf("--dir");
  const explicitDir = dirFlag !== -1 ? process.argv[dirFlag + 1] : undefined;
  const runDir = explicitDir
    ? explicitDir
    : path.resolve(import.meta.dirname, "..", "..", "..", "..", "poc", "seo-crawler-poc", "storage", "runs", runId);

  loadEnv();
  const prisma = createPrismaClient("importer");
  try {
    const result = await importIssuesToPostgres(prisma, runDir, runId);
    if (result.skippedReason) {
      console.log(`[findings-import] ${runId}: skipped (${result.skippedReason})`);
    } else {
      console.log(`[findings-import] ${runId}: ${result.findingsInserted} findings, ${result.issuesInserted} issues`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[findings-import] failed:", err);
  process.exit(1);
});
