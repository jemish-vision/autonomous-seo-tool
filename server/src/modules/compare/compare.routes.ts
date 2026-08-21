/**
 * Crawl-over-crawl diff, computed on the fly (spec §7). The diff computation itself now lives in
 * ./computeDiff.ts (computeCrawlDiff) so the persisted /api/comparisons module can reuse it without
 * duplicating the field-by-field logic. This route's behavior is unchanged: it validates the ids,
 * calls computeCrawlDiff, and returns the full CrawlDiff object (not paginated).
 *
 *   GET /api/crawls/:headRunId/diff?base=:baseRunId  -> CrawlDiff
 *
 * The client (@/api/compare) resolves `base` itself (previous run of the same site) and passes it,
 * so `base` is required here.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { isSafeId } from "../../lib/apiShared.js";
import { computeCrawlDiff } from "./computeDiff.js";

export const compareRouter = Router();

compareRouter.get(
  "/:headRunId/diff",
  asyncHandler(async (req, res) => {
    const headRunId = req.params.headRunId;
    const baseRunId = typeof req.query.base === "string" ? req.query.base : "";
    if (!isSafeId(headRunId) || !baseRunId || !isSafeId(baseRunId)) {
      res.status(422).json({ error: "Invalid or missing runId (require ?base=)" });
      return;
    }

    const diff = await computeCrawlDiff(baseRunId, headRunId);
    res.json(diff);
  }),
);
