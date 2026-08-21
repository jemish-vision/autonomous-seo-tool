/**
 * Run metadata — the label / notes / tags a user attaches to a crawl run, persisted on the Crawl
 * row so an edit on one machine is visible everywhere (the old app kept these in local JSON).
 *
 *   GET   /api/crawls/:runId/meta  -> { label, notes, tags }        [dbReadCrawlMeta]
 *   PATCH /api/crawls/:runId/meta  -> writes the same shape         [dbWriteCrawlMeta]
 *
 * A run that has never been synced has no Crawl row: read returns a null-ish default; write
 * returns 404 (nothing to attach the metadata to yet), matching the vendored fn's `false` return.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbReadCrawlMeta, dbWriteCrawlMeta, type CrawlMeta } from "../../db/src/crawl/crawlMeta.js";

export const crawlMetaRouter = Router();

crawlMetaRouter.get(
  "/:runId/meta",
  asyncHandler(async (req, res) => {
    const meta = await dbReadCrawlMeta(prisma, req.params.runId);
    // No crawl row yet -> return an empty-but-valid shape rather than 404, so the editor renders.
    res.json({ meta: meta ?? { label: null, notes: null, tags: [] } });
  }),
);

crawlMetaRouter.patch(
  "/:runId/meta",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<CrawlMeta>;
    const meta: CrawlMeta = {
      label: typeof body.label === "string" ? body.label : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [],
    };
    const written = await dbWriteCrawlMeta(prisma, req.params.runId, meta);
    if (!written) {
      res.status(404).json({ error: "Run not synced yet", runId: req.params.runId });
      return;
    }
    res.json({ meta });
  }),
);
