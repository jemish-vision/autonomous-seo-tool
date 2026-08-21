/**
 * Sitemap inventory + site-files ladder for a run. Both are reconstructed from the same run
 * detail the /api/crawls/:runId endpoint already returns (robots + sitemaps come off the
 * SiteFile / SitemapFile Prisma tables via dbGetCrawlRun) — no filesystem.
 *
 *   GET /api/crawls/:runId/sitemaps    -> sitemap URL inventory + coverage vs crawled (paginated)
 *   GET /api/crawls/:runId/site-files  -> robots.txt + sitemaps + (llms/feeds/favicon/manifest)
 *
 * Parity: llms.txt / feed discovery / favicon ladder / web manifest are not persisted by the
 * current sync, so site-files reports them `available: false` with a reason (never faked) — same
 * contract the old route used for runs that predated those extractors.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbGetCrawlRun, dbGetCrawlPages } from "../../db/src/crawl/readStore.js";
import { isSafeId, parseOffsetPaging, paginate } from "../../lib/apiShared.js";

export const siteFilesRouter = Router();

// GET /:runId/sitemaps — every sitemap entry, flagged with whether that URL was actually crawled.
siteFilesRouter.get(
  "/:runId/sitemaps",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }
    const detail = await dbGetCrawlRun(prisma, runId);
    if (!detail?.report) {
      res.status(404).json({ error: "No completed run found", runId });
      return;
    }
    if (!detail.sitemaps) {
      res.status(404).json({ error: "No sitemaps captured for run", runId });
      return;
    }

    const pages = await dbGetCrawlPages(prisma, runId);
    const crawledUrls = new Set(pages.map((p) => p.normalizedUrl));

    let rows = detail.sitemaps.entries.map((e) => ({ ...e, inCrawl: crawledUrls.has(e.url) }));
    if (req.query.inSitemapOnly === "true") rows = rows.filter((r) => r.inCrawl);
    if (req.query.notInSitemap === "true") rows = rows.filter((r) => !r.inCrawl);

    const { page, pageSize } = parseOffsetPaging(new URLSearchParams(req.query as Record<string, string>));
    res.json({ ...paginate(rows, page, pageSize), files: detail.sitemaps.files, errors: detail.sitemaps.errors });
  }),
);

// GET /:runId/site-files — robots.txt + sitemap availability; other site files not yet stored.
siteFilesRouter.get(
  "/:runId/site-files",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }
    const detail = await dbGetCrawlRun(prisma, runId);
    if (!detail?.report) {
      res.status(404).json({ error: "No completed run found", runId });
      return;
    }
    const { robots, sitemaps } = detail;

    res.json({
      robots: robots
        ? { url: robots.url, statusCode: robots.statusCode, content: robots.content, sitemaps: robots.sitemaps, parseStatus: robots.parseStatus, fetchedAt: robots.fetchedAt, available: true }
        : { available: false, reason: "No robots.txt captured for this run." },
      sitemaps: sitemaps
        ? { entries: sitemaps.entries, files: sitemaps.files, errors: sitemaps.errors, available: true }
        : { available: false, reason: "No sitemaps captured for this run." },
      // Not persisted by the current sync — reported absent, not guessed (see README "Parity gaps").
      llmsTxt: { available: false, reason: "llms.txt evidence is not persisted by the current sync." },
      feeds: { available: false, reason: "Feed discovery is not stored on the run yet." },
      favicon: { available: false, reason: "Run-level favicon ladder is not aggregated yet." },
      webManifest: { available: false, reason: "Web app manifest is not probed/stored by the crawler yet." },
    });
  }),
);
