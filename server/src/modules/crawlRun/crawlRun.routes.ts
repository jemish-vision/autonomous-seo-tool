/**
 * Real crawl EXECUTION routes — supersedes the honest-501 stubs in newCrawl.routes.ts and
 * crawlLifecycle.routes.ts. Backed by crawlRunner.ts (spawn/track/sync the vendored worker).
 *
 * Mounted at /api/crawls (behind requireAuth), so it owns:
 *   POST   /                    -> start a crawl            { runId } (202)
 *   POST   /:runId/cancel       -> process-tree kill        { crawl } (202)
 *   POST   /:runId/reanalyze    -> re-run rules + sync      { ok: true }
 *   POST   /:runId/rerun        -> fresh crawl, same config { crawlId, status } (202)
 *   GET    /:runId/progress     -> counters snapshot
 *   GET    /:runId/events       -> SSE activity stream (durable events.ndjson, synthetic fallback)
 *
 * The GET /:runId report SUPERSET (state/exitCode/log/reportReady/note) lives in crawls.routes.ts,
 * not here — it extends the existing report body rather than replacing the route.
 *
 * Auth note (events): the client opens this via `new EventSource(...)`, which cannot send an
 * Authorization header — so with AUTH_REQUIRED=true the requireAuth gate 401s the stream and the
 * client shows "Live activity unavailable" (handled gracefully). The route additionally accepts a
 * verified `?access_token=<jwt>` for a future public mount; see the events handler. Polling
 * GET /:runId (bearer via apiGet) is the primary progress mechanism and is unaffected.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { isSafeId } from "../../lib/apiShared.js";
import { env } from "../../config/env.js";
import {
  startCrawl,
  cancelCrawl,
  reanalyzeCrawl,
  rerunCrawl,
  getProgress,
  getCrawlStatus,
  hasDurableEventLog,
  readDurableEvents,
  readSyntheticEvents,
  isSyntheticDone,
  CrawlConflictError,
  CrawlValidationError,
  CrawlControlError,
  type CrawlEvent,
} from "./crawlRunner.js";

export const crawlRunRouter = Router();

const UNAVAILABLE_MESSAGE =
  "Crawl execution is disabled in this deployment (CRAWL_EXECUTION_ENABLED=false). Existing runs remain fully browsable.";

// ── POST / — start a crawl ─────────────────────────────────────────────────────────────────────
crawlRunRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    if (!env.crawler.executionEnabled) {
      res.status(501).json({ error: "Crawl execution not available", message: UNAVAILABLE_MESSAGE, capability: "crawl-execution" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body !== "object" || body === null) {
      res.status(400).json({ error: "Request body must be a JSON object." });
      return;
    }
    try {
      const { runId } = await startCrawl(body as unknown as Parameters<typeof startCrawl>[0]);
      res.status(202).json({ runId });
    } catch (err) {
      if (err instanceof CrawlConflictError) {
        res.status(409).json({ error: err.message, runningRunId: err.runningRunId });
        return;
      }
      if (err instanceof CrawlValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);

// ── POST /:runId/cancel ────────────────────────────────────────────────────────────────────────
crawlRunRouter.post(
  "/:runId/cancel",
  asyncHandler(async (req: Request, res: Response) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }
    try {
      const status = await cancelCrawl(runId);
      res.status(202).json({
        crawl: { runId: status.runId, state: "cancelled", note: status.note, endedAt: status.endedAt, exitCode: status.exitCode },
      });
    } catch (err) {
      if (err instanceof CrawlControlError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);

// ── POST /:runId/reanalyze ─────────────────────────────────────────────────────────────────────
crawlRunRouter.post(
  "/:runId/reanalyze",
  asyncHandler(async (req: Request, res: Response) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }
    try {
      await reanalyzeCrawl(runId);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof CrawlControlError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);

// ── POST /:runId/rerun ─────────────────────────────────────────────────────────────────────────
crawlRunRouter.post(
  "/:runId/rerun",
  asyncHandler(async (req: Request, res: Response) => {
    if (!env.crawler.executionEnabled) {
      res.status(501).json({ error: "Crawl execution not available", message: UNAVAILABLE_MESSAGE, capability: "crawl-execution" });
      return;
    }
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }
    try {
      const { runId: crawlId } = await rerunCrawl(runId);
      res.status(202).json({ crawlId, status: "running" });
    } catch (err) {
      if (err instanceof CrawlControlError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      if (err instanceof CrawlConflictError) {
        res.status(409).json({ error: err.message, runningRunId: err.runningRunId });
        return;
      }
      if (err instanceof CrawlValidationError) {
        res.status(422).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);

// ── GET /:runId/progress ───────────────────────────────────────────────────────────────────────
crawlRunRouter.get(
  "/:runId/progress",
  asyncHandler(async (req: Request, res: Response) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }
    const progress = await getProgress(runId);
    if (!progress) {
      res.status(404).json({ error: `No crawl found for runId "${runId}".` });
      return;
    }
    res.json(progress);
  }),
);

// ── GET /:runId/events — SSE ─────────────────────────────────────────────────────────────────
const TERMINAL_KINDS = new Set(["crawl-finished", "crawl-cancelled"]);

crawlRunRouter.get("/:runId/events", (req: Request, res: Response) => {
  const { runId } = req.params;
  if (!isSafeId(runId)) {
    res.status(422).json({ error: "Invalid runId" });
    return;
  }

  // Resume cursor: Last-Event-ID (EventSource auto-sends on reconnect) or ?fromSeq=.
  const lastEventId = req.headers["last-event-id"];
  const fromSeqParam = typeof req.query.fromSeq === "string" ? req.query.fromSeq : undefined;
  let cursor = 0;
  if (typeof lastEventId === "string" && /^\d+$/.test(lastEventId)) cursor = Number(lastEventId);
  else if (fromSeqParam && /^\d+$/.test(fromSeqParam)) cursor = Number(fromSeqParam);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  let lastLogLine: string | null = null;
  let doneSent = false;
  // Which mode the stream opened in. A dashboard-started crawl connects before events.ndjson exists,
  // so it starts synthetic; when the durable file appears mid-stream the two 1-based sequences are
  // independent — reset the cursor to 0 on that transition so durable rows aren't skipped.
  let openedDurable: boolean | null = null;

  const send = (evt: CrawlEvent) => {
    if (closed) return;
    res.write(`id: ${evt.seq}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
  };

  const pullOnce = async (): Promise<boolean> => {
    const durable = await hasDurableEventLog(runId);
    if (openedDurable === null) openedDurable = durable;
    if (durable) {
      const from = openedDurable === false ? 0 : cursor;
      openedDurable = true;
      for (const evt of await readDurableEvents(runId, from)) {
        send(evt);
        cursor = evt.seq;
        if (TERMINAL_KINDS.has(evt.type)) doneSent = true;
      }
      return doneSent;
    }
    const { events, lastLogLine: nextLine } = await readSyntheticEvents(runId, cursor, lastLogLine);
    for (const evt of events) {
      send(evt);
      cursor = evt.seq;
    }
    lastLogLine = nextLine;

    if (!doneSent) {
      const { done, state, exitCode } = await isSyntheticDone(runId);
      if (done) {
        cursor++;
        send({ seq: cursor, type: "done", ts: new Date().toISOString(), synthetic: true, message: "crawl finished", url: null, statusCode: null, status: state, exitCode });
        doneSent = true;
      }
    }
    return doneSent;
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    try {
      res.end();
    } catch {
      /* already ended */
    }
  };

  let tickInFlight = false;
  const interval = setInterval(() => {
    if (closed || tickInFlight) return;
    tickInFlight = true;
    void (async () => {
      try {
        const finished = await pullOnce();
        if (finished) cleanup();
      } catch (err) {
        console.error(`[crawlRun/events/${runId}] tail error`, err);
      } finally {
        tickInFlight = false;
      }
    })();
  }, 1000);

  req.on("close", cleanup);

  // Initial drain (replay), then the interval tails.
  void (async () => {
    try {
      const finishedAlready = await pullOnce();
      if (finishedAlready) cleanup();
    } catch (err) {
      console.error(`[crawlRun/events/${runId}] initial drain error`, err);
    }
  })();
});

export { getCrawlStatus };
