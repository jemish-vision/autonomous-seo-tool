/**
 * Crawl lifecycle actions — cancel, rerun, reanalyze, live progress, live events.
 *
 * Every one of these drives the crawler worker (`seo-crawler-poc`): a separate, disk-based process
 * that fetches/renders pages, kills in-flight crawls, and streams per-request events. That worker is
 * NOT part of this deployment — this service only READS results Supabase already holds. Rather than
 * let the ported client hit the 404 catch-all (a confusing, generic failure), we answer 501 honestly
 * with a machine-readable `capability` so the client can degrade gracefully.
 *
 * Note on GET /:runId/events: the client points an EventSource here. We deliberately DO NOT open a
 * stream — a 501 JSON response makes the EventSource `onerror` fire once (so the client can stop
 * retrying) instead of leaving it hanging on an open, never-completing connection.
 *
 * Mirrors the honest-501 pattern in newCrawl.routes.ts and the isSafeId/:runId validation used
 * across the read routes (crawls.routes.ts, appliedFixes.routes.ts, ...).
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { isSafeId } from "../../lib/apiShared.js";

export const crawlLifecycleRouter = Router();

const CAPABILITY = "crawl-lifecycle";
const UNAVAILABLE_MESSAGE =
  "Crawl execution is handled by the crawler worker, which isn't available in this deployment.";

/** Reject a malformed :runId (422) before the honest 501 — matches the read routes' guard so a bad
 *  id never masquerades as a missing capability. */
function lifecycleStub(req: Request, res: Response): void {
  const { runId } = req.params;
  if (!isSafeId(runId)) {
    res.status(422).json({ error: "Invalid runId" });
    return;
  }
  res.status(501).json({ error: UNAVAILABLE_MESSAGE, capability: CAPABILITY });
}

crawlLifecycleRouter.post("/:runId/cancel", lifecycleStub);
crawlLifecycleRouter.post("/:runId/rerun", lifecycleStub);
crawlLifecycleRouter.post("/:runId/reanalyze", lifecycleStub);
crawlLifecycleRouter.get("/:runId/progress", lifecycleStub);
crawlLifecycleRouter.get("/:runId/events", lifecycleStub);
