import path from "node:path";
import { loadEnv } from "../env.js";
import { createDirectPrismaClient } from "../client.js";
import { syncRunToPostgres } from "../sync/syncRun.js";
import { detectScoringModelCutoff } from "./modelCutoff.js";
import { readFile } from "node:fs/promises";

/**
 * One-shot importer (PLAN-02-Data-Model.md §7.2/§7.4). Imports exactly 4 representative runs —
 * NOT all ~102 on disk. The other runs are the crawler's own regression fixtures and stay there;
 * importing them would either manufacture NULL-forest noise (schema drift across extractor
 * versions) or poison every trend line with pre-rescoring healthScore values. Connects via
 * DIRECT_URL (session mode) — a one-shot bulk writer has no reason to compete with the transaction
 * pooler's connection budget.
 */
const CRAWLER_ROOT = path.resolve(process.cwd(), "..", "..", "poc", "seo-crawler-poc");
const RUNS_DIR = path.join(CRAWLER_ROOT, "storage", "runs");
const ANALYSIS_DIR = path.join(CRAWLER_ROOT, "src", "analysis");

const PICKED_RUNS = [
  { runId: "books-full-site", label: "books.toscrape.com" },
  { runId: "ui-20260812-145824", label: "visioninfotech.net" },
  { runId: "ui-20260811-224925", label: "arena.ai" },
  { runId: "ui-20260812-102522", label: "lizhr.com" },
];

async function main(): Promise<void> {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const cutoff = await detectScoringModelCutoff(ANALYSIS_DIR);
  console.log(`Scoring-model cutoff: ${cutoff.toISOString()} (issues.json generated before this is refused)`);
  console.log(dryRun ? "DRY RUN — parsing only, writing nothing\n" : "");

  const prisma = createDirectPrismaClient();
  try {
    for (const { runId, label } of PICKED_RUNS) {
      const runDir = path.join(RUNS_DIR, runId);
      let allowFindings = true;
      let refusedReason: string | undefined;

      const issuesPath = path.join(runDir, "issues.json");
      let issuesReport: any = null;
      try {
        issuesReport = JSON.parse(await readFile(issuesPath, "utf8"));
      } catch (err: any) {
        allowFindings = false;
        refusedReason =
          err?.code === "ENOENT"
            ? "no issues.json for this run — Page facts import, Finding/Issue import skipped"
            // Other agents in this repo actively rewrite issues.json concurrently (src/analysis/
            // ownership is not this package's) — a mid-write read can truncate valid JSON. Refusing
            // rather than importing a partial/corrupt file is the correct default here, not a bug.
            : `issues.json present but failed to parse (${err?.message ?? "unknown error"}) — likely read mid-write by a concurrent analysis run; Page facts import, Finding/Issue import skipped`;
      }
      if (issuesReport) {
        const generatedAt = new Date(issuesReport.generatedAt);
        if (generatedAt < cutoff) {
          allowFindings = false;
          refusedReason = `issues.json generated ${generatedAt.toISOString()} predates the scoring-model cutoff ${cutoff.toISOString()} — refusing Finding/Issue/healthScore import (Page facts import normally)`;
        }
      }

      console.log(`== ${runId} (${label}) ==`);
      if (!allowFindings) console.log(`  REFUSED (scoring era): ${refusedReason}`);

      if (dryRun) {
        console.log(`  would import Page facts${allowFindings ? " + Finding/Issue/healthScore" : ""}`);
        continue;
      }

      const result = await syncRunToPostgres(prisma, runDir, runId, {
        allowFindings,
        refusedReason,
        label,
      });
      console.log(
        `  pages=${result.pagesInserted} links=${result.linksInserted} images=${result.imagesInserted} ` +
          `findings=${result.findingsInserted} issues=${result.issuesInserted} ` +
          `failures=${result.failuresInserted} blocked=${result.blockedInserted} ` +
          `siteFiles=${result.siteFilesInserted} sitemapEntries=${result.sitemapEntriesInserted}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
