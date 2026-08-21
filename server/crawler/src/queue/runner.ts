/** Slice: crawl queue + concurrency + activity stream. */
import path from "node:path";
import { applyCrawlDelay, fetchRobots } from "../discovery/robots";
import { DEFAULT_USER_AGENT } from "../discovery/http";
import { runCrawl } from "../crawler/crawl";
import { defaultSafety } from "../crawler/safety";
import { EventLog } from "../events/eventLog";
import type { CrawlOptions } from "../models/types";
import type { JobRunner } from "./types";

/** Concurrency ceiling: Jemish/Nayan hardcode 1 and are 60-80x slower for it; 8 keeps a runaway
 * job config from starving the host or this process. */
export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 8;
const DEFAULT_CONCURRENCY = 4;

/**
 * Bridges a queued job to the real crawler: builds CrawlOptions (politeness-aware rps, clamped
 * concurrency, one runId per job), creates that run's EventLog, and threads the queue's
 * AbortSignal through runCrawl's runtime hooks so cancel() reaches Crawlee for real.
 */
export function createCrawlJobRunner(outDir: string): JobRunner {
  return async ({ job, signal }) => {
    const parsedStart = new URL(job.url);
    const userAgent = (job.options.userAgent ?? DEFAULT_USER_AGENT).trim() || DEFAULT_USER_AGENT;
    const respectRobots = job.options.respectRobots !== false;
    const isLocalSeed = parsedStart.hostname === "localhost" || /^127\./.test(parsedStart.hostname);

    // Politeness always wins: Crawl-delay caps rps BEFORE concurrency ever gets a say — the same
    // order the CLI path in index.ts uses — so a job config raising concurrency can never outrun
    // what the site published.
    let rps = job.options.maxRequestsPerSecond ?? (isLocalSeed ? 10 : 2);
    if (respectRobots) {
      const probe = await fetchRobots(parsedStart.origin, userAgent);
      rps = applyCrawlDelay(rps, probe.crawlDelay);
    }

    const concurrency = Math.max(
      MIN_CONCURRENCY,
      Math.min(MAX_CONCURRENCY, Math.round(job.options.concurrency ?? DEFAULT_CONCURRENCY)),
    );

    const maxPagesRaw = job.options.maxPages;
    const maxPages = maxPagesRaw && maxPagesRaw > 0 ? Math.floor(maxPagesRaw) : Number.MAX_SAFE_INTEGER;

    const options: CrawlOptions = {
      startUrl: job.url,
      maxPages,
      concurrency,
      respectRobots,
      render: job.options.render ?? "auto",
      outDir,
      runId: job.runId,
      userAgent,
      maxRequestsPerSecond: rps,
      hostAliases: [],
      maxDepth: job.options.maxDepth ?? null,
      auth: null,
      safety: defaultSafety(null),
    };

    const eventLog = new EventLog(outDir, job.runId);
    await eventLog.init();

    const summary = await runCrawl(options, false, { signal, eventLog });
    return {
      pagesCrawled: summary.successful,
      failedPages: summary.failed,
      reportPath: path.join(path.resolve(outDir, "runs", job.runId), "report.json"),
    };
  };
}
