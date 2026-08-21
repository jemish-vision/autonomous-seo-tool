/** Slice: crawl queue + concurrency + activity stream. */
import { EventEmitter } from "node:events";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CrawlCancelledError } from "../crawler/crawl";
import type { JobRecord, JobRunner, JobState, JobSubmitOptions, QueueStats } from "./types";

const JOB_ID_RE = /^j(\d+)$/;

/**
 * A real job queue, replacing "one crawl at a time behind a global lock, 409 on a second
 * request": submitted crawls queue and drain through a fixed number of workers (default 1).
 * Every job writes to its own out/jobs/<id>/job.json (queue metadata) alongside its crawl
 * evidence under storage/runs/<runId>/ (RunStore's own convention, untouched here).
 *
 * Two defects fixed relative to the reference implementation this was ported from:
 *  1. cancel() on a RUNNING job now actually reaches the crawl (see queue/runner.ts +
 *     crawler/crawl.ts's AbortSignal wiring) instead of only pulling still-queued jobs.
 *  2. Eviction deletes the on-disk job directory, not just the in-memory record — the reference
 *     kept `keepJobs` in memory only, so a long-lived process grew out/jobs/ without bound.
 */
export class CrawlQueue extends EventEmitter {
  private readonly concurrency: number;
  private readonly runner: JobRunner;
  private readonly outRoot: string;
  private readonly keepJobs: number;
  private readonly jobs = new Map<string, JobRecord>();
  private readonly waiting: string[] = [];
  private readonly active = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly cancelRequested = new Set<string>();
  private seq = 0;
  private readonly ready: Promise<void>;

  constructor(opts: { concurrency?: number; runner: JobRunner; outRoot: string; keepJobs?: number }) {
    super();
    this.concurrency = Math.max(1, opts.concurrency ?? 1);
    this.runner = opts.runner;
    this.outRoot = opts.outRoot;
    this.keepJobs = opts.keepJobs ?? 50;
    this.ready = this.rehydrate();
  }

  /** Resolves once every job.json on disk (from a prior process life) has been loaded. Listing
   * or submitting before a restart has finished rehydrating would race the disk scan. */
  async whenReady(): Promise<void> {
    await this.ready;
  }

  private async rehydrate(): Promise<void> {
    let names: string[] = [];
    try {
      names = await readdir(this.outRoot);
    } catch {
      return; // no out/jobs/ yet — first run in this environment
    }
    let highest = 0;
    for (const name of names) {
      const match = JOB_ID_RE.exec(name);
      if (match?.[1]) highest = Math.max(highest, Number(match[1]));
      const job = await readJobFile(path.join(this.outRoot, name));
      if (!job) continue;
      // A job still "queued"/"running" when the process died never resumes — the crawl itself
      // died with the old process — so its true final state on rehydrate is "failed", recorded
      // rather than silently dropped (which is what a memory-only queue would do).
      if (job.state === "queued" || job.state === "running") {
        job.state = "failed";
        job.error ??= "process restarted before this job finished";
        job.finishedAt ??= Date.now();
        await this.persist(job);
      }
      this.jobs.set(job.id, job);
    }
    this.seq = highest;
    this.evict();
  }

  async submit(input: JobSubmitOptions): Promise<JobRecord> {
    await this.ready;
    const id = `j${String(++this.seq).padStart(4, "0")}`;
    const job: JobRecord = {
      id,
      url: input.url,
      options: input,
      priority: input.priority ?? 0,
      state: "queued",
      submittedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      runId: input.runId ?? id,
      error: null,
      pagesCrawled: null,
      failedPages: null,
      reportPath: null,
    };
    this.jobs.set(id, job);
    await this.persist(job);
    this.insertWaiting(id, job.priority);
    this.evict();
    this.emit("submitted", job);
    void this.pump();
    return job;
  }

  private insertWaiting(id: string, priority: number): void {
    let idx = this.waiting.length;
    for (let i = 0; i < this.waiting.length; i++) {
      const other = this.jobs.get(this.waiting[i]!);
      if (other && other.priority < priority) {
        idx = i;
        break;
      }
    }
    this.waiting.splice(idx, 0, id);
  }

  /**
   * A queued job is pulled cleanly. A running job is cancelled for real: the AbortController
   * threaded into the runner (queue/runner.ts) reaches Crawlee, the asset probes, and the
   * external-link pool — see crawl.ts's runtime.signal wiring. That is the fix for the reference
   * defect where Stop suppressed only the client-visible stream while the crawl ran to
   * completion and still wrote its report.
   */
  cancel(id: string): JobRecord | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.state === "queued") {
      const idx = this.waiting.indexOf(id);
      if (idx !== -1) this.waiting.splice(idx, 1);
      job.state = "cancelled";
      job.finishedAt = Date.now();
      void this.persist(job);
      this.emit("cancelled", job);
      return job;
    }
    if (job.state === "running") {
      this.cancelRequested.add(id);
      this.controllers.get(id)?.abort();
      this.emit("cancel-requested", job);
      return job;
    }
    return job; // already finished — cancelling it again is a no-op
  }

  get(id: string): JobRecord | null {
    return this.jobs.get(id) ?? null;
  }

  list(): (JobRecord & { queuePosition: number | null })[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.submittedAt - a.submittedAt)
      .map((j) => {
        const idx = this.waiting.indexOf(j.id);
        return { ...j, queuePosition: idx === -1 ? null : idx + 1 };
      });
  }

  stats(): QueueStats {
    return {
      concurrency: this.concurrency,
      queued: this.waiting.length,
      running: this.active.size,
      total: this.jobs.size,
    };
  }

  private async pump(): Promise<void> {
    while (this.active.size < this.concurrency && this.waiting.length > 0) {
      const id = this.waiting.shift();
      if (!id) continue;
      const job = this.jobs.get(id);
      if (!job || job.state !== "queued") continue;
      this.active.add(id);
      void this.run(job).finally(() => {
        this.active.delete(id);
        this.controllers.delete(id);
        this.cancelRequested.delete(id);
        void this.pump();
      });
    }
  }

  private async run(job: JobRecord): Promise<void> {
    job.state = "running";
    job.startedAt = Date.now();
    await this.persist(job);
    this.emit("started", job);

    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    try {
      const result = await this.runner({ job, signal: controller.signal });
      job.pagesCrawled = result.pagesCrawled;
      job.failedPages = result.failedPages;
      job.reportPath = result.reportPath;
      job.state = "done";
    } catch (err) {
      if (this.cancelRequested.has(job.id) || err instanceof CrawlCancelledError) {
        job.state = "cancelled";
      } else {
        job.state = "failed";
        job.error = err instanceof Error ? err.message : String(err);
      }
    }
    job.finishedAt = Date.now();
    await this.persist(job);
    this.emit("finished", job);
  }

  private async persist(job: JobRecord): Promise<void> {
    const dir = path.join(this.outRoot, job.id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "job.json"), JSON.stringify(job, null, 2), "utf8");
  }

  /** Retention: bounds BOTH the in-memory map and disk. Kept simplest as a count (not age-based)
   * to match keepJobs' existing meaning; deletion is best-effort and never blocks the caller. */
  private evict(): void {
    const finished = [...this.jobs.values()]
      .filter((j): j is JobRecord & { state: Exclude<JobState, "queued" | "running"> } =>
        j.state === "done" || j.state === "failed" || j.state === "cancelled",
      )
      .sort((a, b) => a.submittedAt - b.submittedAt);
    while (this.jobs.size > this.keepJobs && finished.length > 0) {
      const gone = finished.shift();
      if (!gone) break;
      this.jobs.delete(gone.id);
      void rm(path.join(this.outRoot, gone.id), { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function readJobFile(dir: string): Promise<JobRecord | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, "job.json"), "utf8")) as JobRecord;
  } catch {
    return null;
  }
}
