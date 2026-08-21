/**
 * Crawl runs — the read surface behind the Runs page and the run selector.
 *
 * All data comes from Supabase Postgres via the vendored db read layer (readStore). No filesystem.
 *
 *   GET    /api/crawls            -> list every run (newest first)      [dbListCrawlRuns]
 *   GET    /api/crawls/:runId     -> one run's report + robots + sitemaps + failures + blocked
 *   DELETE /api/crawls/:runId     -> hard-delete a run and everything it owns
 *
 * These map 1:1 to the old Next.js app/api/crawls routes, minus the JSON-on-disk fallback.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { isSafeId } from "../../lib/apiShared.js";
import { dbListCrawlRuns, dbGetCrawlRun, dbReadCrawlSkipped } from "../../db/src/crawl/readStore.js";

export const crawlsRouter = Router();

crawlsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const runs = await dbListCrawlRuns(prisma);
    res.json({ runs });
  }),
);

crawlsRouter.get(
  "/:runId",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const detail = await dbGetCrawlRun(prisma, runId);
    if (!detail) {
      res.status(404).json({ error: "Run not found", runId });
      return;
    }
    const skipped = await dbReadCrawlSkipped(prisma, runId);
    res.json({ ...detail, skipped });
  }),
);

crawlsRouter.delete(
  "/:runId",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "runId must be a safe id.", runId });
      return;
    }

    // Resolve slug -> Crawl.id (the FK every child table points at). 404 when the run is unknown
    // or already gone.
    const crawl = await prisma.crawl.findFirst({ where: { slug: runId, deletedAt: null }, select: { id: true } });
    if (!crawl) {
      res.status(404).json({ error: "Run not found", runId });
      return;
    }

    // Single hard delete. Every table that references a Crawl declares `onDelete: Cascade` in
    // schema.prisma (pages, links, images, media, headings, structured data, redirect hops,
    // link/image aggregates, findings, issues, measurements, activity, site/sitemap files +
    // entries, failures, blocked urls, duplicate groups + members, artifacts, run comparisons +
    // diff entries, ai recommendations, ai-crawler verdicts). Postgres cascades them in one
    // atomic statement, so no manual child deletion or transaction is needed — no rows are
    // orphaned. The only inbound FK that is NOT a cascade is CrawlJob.crawlId (onDelete: SetNull),
    // which is nulled rather than deleted, by design.
    await prisma.crawl.delete({ where: { id: crawl.id } });

    res.json({ ok: true });
  }),
);
