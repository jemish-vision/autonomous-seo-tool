/**
 * POST /api/crawls — starting a NEW crawl.
 *
 * This is the one dashboard action that is genuinely out of scope for a Supabase-only READ
 * dashboard: crawls are produced by the crawler worker — a separate, disk-based process that
 * fetches/renders pages and syncs its results into Supabase. This service only reads those results.
 * Rather than fake a spawn (the old app shelled out to the crawler CLI), we answer 501 honestly.
 *
 * The existing GET /api/crawls list (crawls.routes.ts) is unaffected — this router only adds POST.
 */
import { Router } from "express";

export const newCrawlRouter = Router();

newCrawlRouter.post("/", (_req, res) => {
  res.status(501).json({
    error: "Crawl execution not available",
    message:
      "Crawls are produced by the crawler worker (separate, disk-based process) and synced to Supabase; this dashboard reads results only. Trigger crawls via the crawler.",
  });
});
