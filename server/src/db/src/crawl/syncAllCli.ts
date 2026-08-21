import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { loadEnv } from "../env.js";
import { createDirectPrismaClient } from "../client.js";
import { syncRunToPostgres } from "../sync/syncRun.js";
import { detectScoringModelCutoff } from "../importer/modelCutoff.js";

/**
 * One-shot backfill: sync EVERY on-disk crawl run in poc/seo-crawler-poc/storage/runs to
 * Postgres, so a dashboard on another machine/browser (which only has the DB) shows the same
 * runs. This is the complement to import:legacy (which deliberately imports exactly 4
 * representative runs) — use it when you want the real working set on disk to be shared.
 *
 * Mirrors import:legacy's scoring-era gate: issues.json generated before the scoring-model
 * cutoff imports page facts only (findings/healthScore refused). Idempotent — re-running only
 * fills gaps, never duplicates (crawl upsert by siteId+slug, pages skip-duplicated by key).
 *
 * Usage: npm run crawl:sync-all [--dry-run] [--dir <runsDir>]
 */
const CRAWLER_ROOT = path.resolve(process.cwd(), "..", "..", "poc", "seo-crawler-poc");
const RUNS_DIR = path.join(CRAWLER_ROOT, "storage", "runs");
const ANALYSIS_DIR = path.join(CRAWLER_ROOT, "src", "analysis");

async function main(): Promise<void> {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const dirFlag = process.argv.indexOf("--dir");
  const explicitDir = dirFlag !== -1 ? process.argv[dirFlag + 1] : undefined;
  const runsDir = explicitDir ? path.resolve(explicitDir) : RUNS_DIR;
  const cutoff = await detectScoringModelCutoff(ANALYSIS_DIR);
  console.log(`Scoring-model cutoff: ${cutoff.toISOString()}`);
  console.log(`Scanning ${runsDir}`);

  const entries = await readdir(runsDir, { withFileTypes: true });
  const runIds = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

  const prisma = createDirectPrismaClient();
  try {
    let synced = 0;
    let skipped = 0;
    for (const runId of runIds) {
      const runDir = path.join(runsDir, runId);

      let allowFindings = true;
      let refusedReason: string | undefined;
      try {
        const issues = JSON.parse(await readFile(path.join(runDir, "issues.json"), "utf8"));
        const generatedAt = new Date(issues.generatedAt);
        if (Number.isNaN(generatedAt.getTime()) || generatedAt < cutoff) {
          allowFindings = false;
          refusedReason = `issues.json generated ${generatedAt.toISOString()} predates the scoring-model cutoff — page facts only`;
        }
      } catch (err: any) {
        allowFindings = false;
        refusedReason =
          err?.code === "ENOENT"
            ? "no issues.json — page facts only"
            : `issues.json unreadable (${err?.message ?? "unknown error"}) — page facts only`;
      }

      if (dryRun) {
        console.log(`  would sync ${runId}${allowFindings ? " + findings" : ` (${refusedReason})`}`);
        continue;
      }

      try {
        const result = await syncRunToPostgres(prisma, runDir, runId, { allowFindings, refusedReason });
        synced++;
        console.log(
          `  ${runId}: pages=${result.pagesInserted} links=${result.linksInserted} images=${result.imagesInserted} ` +
            `findings=${result.findingsInserted} issues=${result.issuesInserted} failures=${result.failuresInserted} ` +
            `blocked=${result.blockedInserted}${result.findingsRefused ? ` (findings refused: ${result.refusedReason})` : ""}`,
        );
      } catch (err) {
        skipped++;
        console.warn(`  ${runId}: skipped (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    console.log(`\nDone: ${synced} synced, ${skipped} skipped.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
