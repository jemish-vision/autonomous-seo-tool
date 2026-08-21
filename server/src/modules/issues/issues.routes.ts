/**
 * Analyzer findings — the "What to Fix" (issues) page.
 *
 *   GET /api/crawls/:runId/issues -> the full AnalysisReport for a run [dbReadCrawlAnalysis]
 *
 * Reconstructed from Postgres (Finding / Issue / Rule tables). Parity note: AI recommendations,
 * automation report and fix plan are separate surfaces not yet reconstructed from the DB — see
 * README "Parity gaps".
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbReadCrawlAnalysis, dbReadPreviousRuleCounts } from "../../db/src/crawl/readStore.js";
import { isSafeId } from "../../lib/apiShared.js";

export const issuesRouter = Router();

issuesRouter.get(
  "/:runId/issues",
  asyncHandler(async (req, res) => {
    const report = await dbReadCrawlAnalysis(prisma, req.params.runId);
    if (!report) {
      res.status(404).json({ error: "No analysis for run", runId: req.params.runId });
      return;
    }
    res.json({ report });
  }),
);

/**
 * Per-rule issue counts of this run's previous same-site analyzed crawl — powers the issues page's
 * "Since the last crawl" delta view. `{ previousRuleCounts: { [ruleId]: number } | null }`; null when
 * there is no earlier analyzed run (unchanged UI behavior). Kept a separate endpoint so the /issues
 * report payload stays backward-compatible.
 */
issuesRouter.get(
  "/:runId/previous-rule-counts",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }
    const previousRuleCounts = await dbReadPreviousRuleCounts(prisma, runId);
    res.json({ previousRuleCounts });
  }),
);
