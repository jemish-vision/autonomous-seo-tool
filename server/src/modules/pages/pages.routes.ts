/**
 * Crawled pages — the Pages explorer and the page-detail view.
 *
 *   GET /api/crawls/:runId/pages            -> every page in a run    [dbGetCrawlPages]
 *   GET /api/crawls/:runId/pages/:pageId    -> one page's full record [dbGetCrawlPage]
 *
 * The page record is reconstructed from Postgres. Note (parity): the rich v3 panels
 * (headMeta / favicons / structure / fonts / charset / headBoundary) are not yet persisted by the
 * current sync, so they come back undefined and their panels render "Not captured" — see
 * README "Parity gaps". Everything else (title, meta, links, images, headings, content, redirects,
 * headers, timing) is fully reconstructed.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbGetCrawlPages, dbGetCrawlPage } from "../../db/src/crawl/readStore.js";

export const pagesRouter = Router();

pagesRouter.get(
  "/:runId/pages",
  asyncHandler(async (req, res) => {
    const pages = await dbGetCrawlPages(prisma, req.params.runId);
    res.json({ pages });
  }),
);

pagesRouter.get(
  "/:runId/pages/:pageId",
  asyncHandler(async (req, res) => {
    const page = await dbGetCrawlPage(prisma, req.params.runId, req.params.pageId);
    if (!page) {
      res.status(404).json({ error: "Page not found", runId: req.params.runId, pageId: req.params.pageId });
      return;
    }
    res.json({ page });
  }),
);
