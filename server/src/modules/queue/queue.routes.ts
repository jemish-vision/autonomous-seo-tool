/**
 * Crawl queue / recent jobs (Queue page, spec §7). The old app read per-run .crawl-status.json
 * files on disk; here the job list is derived from the Crawl rows in Supabase — each run is a job.
 *
 *   GET /api/queue  ->  { jobs: QueueJob[], queuedCount, oldestQueuedAgeMs, runningCount, ... }
 *
 * queuedCount is 0 by construction: there is no separate queue table / worker tier in this port
 * (same fact the old route documented — a second concurrent crawl was rejected, never queued).
 * A small direct prisma.crawl query is used instead of dbListCrawlRuns because the job rows need
 * `label` + the config snapshot (maxPages/maxDepth), which the run-list item does not carry.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";

export const queueRouter = Router();

type JobState = "running" | "done" | "failed" | "cancelled";

interface QueueJob {
  runId: string;
  state: JobState;
  startUrl: string;
  maxPages: number;
  maxDepth: number | null;
  startedAt: string;
  endedAt: string | null;
  label: string | null;
  note?: string;
}

/** Crawl.status (+ terminationReason) -> the dashboard's JobState. RUNNING/CANCELLED/FAILED map
 *  straight through; COMPLETED / PARTIAL / PENDING all render as a finished "done" job. */
function stateFor(status: string): JobState {
  if (status === "RUNNING") return "running";
  if (status === "CANCELLED") return "cancelled";
  if (status === "FAILED") return "failed";
  return "done";
}

function iso(d: Date | null): string {
  return d ? d.toISOString() : new Date(0).toISOString();
}

queueRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const crawls = await prisma.crawl.findMany({
      where: { deletedAt: null },
      orderBy: { startedAt: "desc" },
      select: {
        slug: true,
        status: true,
        terminationReason: true,
        startUrl: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        label: true,
        config: true,
      },
    });

    const jobs: QueueJob[] = crawls.map((c) => {
      const cfg = (c.config ?? {}) as { maxPages?: unknown; maxDepth?: unknown };
      const maxPages = typeof cfg.maxPages === "number" ? cfg.maxPages : 0;
      const maxDepth = typeof cfg.maxDepth === "number" ? cfg.maxDepth : null;
      return {
        runId: c.slug,
        state: stateFor(c.status),
        startUrl: c.startUrl,
        maxPages,
        maxDepth,
        startedAt: iso(c.startedAt ?? c.createdAt),
        endedAt: c.finishedAt ? c.finishedAt.toISOString() : null,
        label: c.label ?? null,
        ...(c.terminationReason ? { note: c.terminationReason } : {}),
      };
    });

    const running = jobs.filter((j) => j.state === "running");
    res.json({
      queuedCount: 0,
      oldestQueuedAgeMs: null,
      runningCount: running.length,
      runningRunId: running[0]?.runId ?? null,
      workerCount: 1,
      note: "Jobs are derived from stored crawl runs (Supabase). There is no separate queue table / worker tier in this port, so queuedCount is always 0 by construction.",
      jobs,
    });
  }),
);
