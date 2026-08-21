/** Slice: crawl queue + concurrency + activity stream. */

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

/** What a caller hands the queue to submit a crawl. A subset of CrawlOptions — the queue owns
 * turning this into the real CrawlOptions (politeness-aware rps, clamped concurrency, outDir,
 * runId) in queue/runner.ts, so job configs stay small and never bypass the Crawl-delay ceiling. */
export interface JobSubmitOptions {
  url: string;
  maxPages?: number | null;
  maxDepth?: number | null;
  /** 1-8; the politeness ceiling (robots.txt Crawl-delay) always wins regardless of this value. */
  concurrency?: number;
  /** Higher runs first among queued jobs; ties keep FIFO order. Default 0. */
  priority?: number;
  /** Defaults to the generated job id — each job gets its own storage/runs/<runId>/ directory. */
  runId?: string;
  render?: "auto" | "never" | "always";
  respectRobots?: boolean;
  userAgent?: string;
  maxRequestsPerSecond?: number;
}

export interface JobRecord {
  id: string;
  url: string;
  options: JobSubmitOptions;
  priority: number;
  state: JobState;
  submittedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  runId: string;
  error: string | null;
  pagesCrawled: number | null;
  failedPages: number | null;
  reportPath: string | null;
}

export interface QueueStats {
  concurrency: number;
  queued: number;
  running: number;
  total: number;
}

export interface JobRunResult {
  pagesCrawled: number;
  failedPages: number;
  reportPath: string | null;
}

export type JobRunner = (params: { job: JobRecord; signal: AbortSignal }) => Promise<JobRunResult>;
