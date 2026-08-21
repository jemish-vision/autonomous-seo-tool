/**
 * Real crawl execution for the Express API. Spawns the VENDORED crawler worker (server/crawler)
 * as a child process, tracks it, and syncs the produced run into Supabase via syncRunToPostgres.
 *
 * Ported from the old Next.js dashboard (lib/crawl-runner.ts + lib/crawl-control.ts + lib/events-log.ts),
 * adapted from Next.js route handlers to Express and from the old Postgres sync to this app's
 * `syncRunToPostgres`. The DISK file storage/runs/<runId>/.crawl-status.json (not in-memory state)
 * is the source of truth so status survives a `tsx watch` hot-reload of this module; an in-memory
 * Map is kept only as a fast-path mirror.
 *
 * Spawn strategy (verified pattern): `node --import tsx src/index.ts …` — tsx's native --import
 * loader hook runs the CLI in a SINGLE process (no npx/cmd.exe wrapper), so the captured pid IS the
 * real worker (matters for the pid-alive/cancel checks). shell:false + an args array throughout,
 * windowsHide (an invisible console Chromium inherits — NOT detached, which strips the console on
 * win32 and makes chrome-headless-shell pop visible windows). child.unref() so the crawl outlives a
 * server restart.
 *
 * Credential hygiene: basic-auth / cookie / header values ONLY ever flow into the spawn argv array —
 * never console.log'd, never written to the status/log files (authMethod stores the method NAME only).
 */
import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import { openSync, closeSync } from "node:fs";
import { mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { syncRunToPostgres } from "../../db/src/sync/syncRun.js";
import { ensureProjectAndSite } from "../../db/src/seed.js";

const execAsync = promisify(exec);

const CRAWLER_DIR = env.crawler.projectDir;
const RUNS_DIR = env.crawler.storageRunsDir;

// Fast-path mirror of live children (pid). Disk is the source of truth; this just avoids a stat on
// the hot path and is intentionally allowed to be empty after a hot-reload.
const liveChildren = new Map<string, { pid: number }>();

// ── Types ──────────────────────────────────────────────────────────────────────────────────────

export type CrawlState = "running" | "done" | "failed" | "cancelled";

export interface CrawlAuthInput {
  basic: { username: string; password: string } | null;
  cookie: string | null;
  headers: Record<string, string>;
}

export interface CrawlSafetyInput {
  denyLogout: boolean;
  denyDestructive: boolean;
  excludePatterns: string[];
}

/** On-disk .crawl-status.json shape. Never carries credential VALUES — only `authMethod`. */
export interface CrawlDiskStatus {
  runId: string;
  state: CrawlState;
  pid: number;
  startUrl: string;
  maxPages: number;
  maxDepth: number | null;
  respectRobots: boolean;
  render: "auto" | "never" | "always";
  screenshots: boolean;
  aliases: string[];
  seedUrls: string[];
  authMethod: "none" | "basic" | "cookie" | "header";
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  note?: string;
}

export interface StartCrawlInput {
  startUrl: string;
  maxPages?: number;
  maxDepth?: number | null;
  respectRobots?: boolean;
  render?: "auto" | "never" | "always";
  screenshots?: boolean;
  aliases?: string[];
  seedUrls?: string[];
  auth?: CrawlAuthInput | null;
  safety?: CrawlSafetyInput | null;
}

export class CrawlConflictError extends Error {
  constructor(public runningRunId: string) {
    super(`A crawl is already running (${runningRunId}). Only one crawl at a time.`);
  }
}
export class CrawlValidationError extends Error {}
export class CrawlControlError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// ── Path + fs helpers ────────────────────────────────────────────────────────────────────────

function runDirPath(runId: string): string {
  return path.join(RUNS_DIR, runId);
}
function statusPath(runId: string): string {
  return path.join(RUNS_DIR, runId, ".crawl-status.json");
}
function logPath(runId: string): string {
  return path.join(RUNS_DIR, runId, "crawl.log");
}
function reportPath(runId: string): string {
  return path.join(RUNS_DIR, runId, "report.json");
}
function eventsPath(runId: string): string {
  return path.join(RUNS_DIR, runId, "events.ndjson");
}

export function runsDirPath(): string {
  return RUNS_DIR;
}

async function readDiskStatus(runId: string): Promise<CrawlDiskStatus | null> {
  try {
    return JSON.parse(await readFile(statusPath(runId), "utf8")) as CrawlDiskStatus;
  } catch {
    return null;
  }
}

async function writeDiskStatus(status: CrawlDiskStatus): Promise<void> {
  await mkdir(path.dirname(statusPath(status.runId)), { recursive: true });
  await writeFile(statusPath(status.runId), JSON.stringify(status, null, 2), "utf8");
}

/** Signal 0 probes existence without killing — supported cross-platform incl. win32. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function reportReady(runId: string): Promise<boolean> {
  return fileExists(reportPath(runId));
}

async function readJsonIfExists(file: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export async function countPageFiles(runId: string): Promise<number> {
  try {
    return (await readdir(path.join(runDirPath(runId), "pages"))).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

export async function tailLog(runId: string, maxLines = 30): Promise<string[]> {
  try {
    const text = await readFile(logPath(runId), "utf8");
    return text.split(/\r?\n/).filter((l) => l.length > 0).slice(-maxLines);
  } catch {
    return [];
  }
}

async function listRunIds(): Promise<string[]> {
  try {
    const entries = await readdir(RUNS_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

// ── Terminal status mapping ──────────────────────────────────────────────────────────────────

function crawlStatusFromReport(report: any): "COMPLETED" | "PARTIAL" {
  // Exit code 2 (completed-with-failed-pages) and any run with failures land as PARTIAL; a clean
  // finish is COMPLETED. Mirrors syncRun's create-path intent (finishedAt present + no failures).
  if (report?.finishedAt && (report.failed ?? 0) === 0) return "COMPLETED";
  return "PARTIAL";
}

/**
 * Post-terminal DB reconciliation. syncRunToPostgres upserts the Crawl row with `update: {}`, so it
 * never touches our pre-created RUNNING row's status/counters — we set the terminal status + the
 * materialised totals here from report.json (healthScore/findings are handled inside sync's
 * importFindingsForCrawl). Best-effort: a DB hiccup logs, never throws into the crawl path.
 */
async function finalizeCrawlRow(runId: string, terminal: CrawlState, exitCode: number | null): Promise<void> {
  const report = await readJsonIfExists(reportPath(runId));
  try {
    if (terminal === "done" && report) {
      const host = new URL(report.startUrl).hostname;
      await syncRunToPostgres(prisma, runDirPath(runId), runId, { allowFindings: true, label: host });
      const status = crawlStatusFromReport(report);
      await prisma.crawl.updateMany({
        where: { slug: runId, deletedAt: null },
        data: {
          status,
          startedAt: report.startedAt ? new Date(report.startedAt) : undefined,
          finishedAt: report.finishedAt ? new Date(report.finishedAt) : new Date(),
          durationMs: report.durationMs ?? null,
          terminationReason: status === "COMPLETED" ? "completed" : "completed-with-failures",
          pagesCrawled: report.successful ?? 0,
          pagesDiscovered: report.discovered ?? 0,
          pagesFailed: report.failed ?? 0,
          pagesBlocked: report.blockedByRobots ?? 0,
          pagesRendered: report.jsRendered ?? 0,
          requestsMade: report.attempted ?? 0,
          maxDepthSeen: report.maxDepthSeen ?? 0,
          coveragePercent: report.coveragePercent ?? null,
          statusHistogram: report.statusHistogram ?? undefined,
          failuresByClass: report.failuresByClass ?? undefined,
        },
      });
      return;
    }
    // failed / cancelled — no report to load totals from; just flip status.
    await prisma.crawl.updateMany({
      where: { slug: runId, deletedAt: null },
      data: {
        status: terminal === "cancelled" ? "CANCELLED" : "FAILED",
        finishedAt: new Date(),
        terminationReason: terminal === "cancelled" ? "cancelled" : "error",
      },
    });
  } catch (err) {
    console.error(`[crawlRunner] finalizeCrawlRow(${runId}, ${terminal}) failed:`, err instanceof Error ? err.message : err);
  }
}

// ── Reconciling status read ────────────────────────────────────────────────────────────────────

/**
 * Reconciling read: if the disk status says "running" but the pid is dead (server restarted
 * mid-crawl, or the child crashed before its exit handler fired), resolve the truth from disk —
 * report.json present ⇒ done (and finalize the DB row if it was never synced); absent ⇒ failed —
 * and persist the correction to BOTH disk and the Crawl row.
 */
export async function getCrawlStatus(runId: string): Promise<CrawlDiskStatus | null> {
  const status = await readDiskStatus(runId);
  if (!status) return null;
  if (status.state !== "running") return status;
  if (isPidAlive(status.pid)) return status;

  const hasReport = await fileExists(reportPath(runId));
  const reconciled: CrawlDiskStatus = {
    ...status,
    state: hasReport ? "done" : "failed",
    endedAt: new Date().toISOString(),
    exitCode: hasReport ? 0 : null,
    note: "reconciled: process no longer alive (server restart or crash) — inferred from report.json presence",
  };
  await writeDiskStatus(reconciled);
  liveChildren.delete(runId);
  // Finalize the DB row too — a run that finished during a server-down window must still land.
  await finalizeCrawlRow(runId, reconciled.state, reconciled.exitCode);
  return reconciled;
}

/** Scans every run dir for a live `running` status. Returns its runId, or null if the coast's clear. */
export async function findRunningCrawl(): Promise<string | null> {
  for (const runId of await listRunIds()) {
    const status = await getCrawlStatus(runId);
    if (status?.state === "running") return runId;
  }
  return null;
}

// ── Validation ─────────────────────────────────────────────────────────────────────────────────

function deriveAuthMethod(auth: CrawlAuthInput | null | undefined): "none" | "basic" | "cookie" | "header" {
  if (!auth) return "none";
  if (auth.basic) return "basic";
  if (auth.cookie) return "cookie";
  if (Object.keys(auth.headers ?? {}).length > 0) return "header";
  return "none";
}

function validateAuth(auth: CrawlAuthInput | null | undefined): CrawlAuthInput | null {
  if (!auth) return null;
  const method = deriveAuthMethod(auth);
  if (method === "none") return null;
  if (method === "basic") {
    const username = auth.basic!.username?.trim();
    const password = auth.basic!.password;
    if (!username || !password) throw new CrawlValidationError("Basic auth requires both a username and a password.");
    return { basic: { username, password }, cookie: null, headers: {} };
  }
  if (method === "cookie") {
    const cookie = auth.cookie!.trim();
    if (!cookie) throw new CrawlValidationError("Cookie auth requires a non-empty Cookie header value.");
    return { basic: null, cookie, headers: {} };
  }
  const entries = Object.entries(auth.headers ?? {}).filter(([k, v]) => k.trim() && v);
  if (entries.length === 0) throw new CrawlValidationError("Custom header auth requires a header name and value.");
  return { basic: null, cookie: null, headers: Object.fromEntries(entries) };
}

function validateSafety(safety: CrawlSafetyInput | null | undefined, authActive: boolean): CrawlSafetyInput | null {
  if (!authActive) return null;
  return {
    denyLogout: safety?.denyLogout ?? true,
    denyDestructive: safety?.denyDestructive ?? true,
    excludePatterns: (safety?.excludePatterns ?? []).map((p) => p.trim()).filter(Boolean),
  };
}

interface ValidatedInput {
  url: URL;
  maxPages: number;
  maxDepth: number | null;
  respectRobots: boolean;
  render: "auto" | "never" | "always";
  screenshots: boolean;
  aliases: string[];
  seedUrls: string[];
  auth: CrawlAuthInput | null;
  safety: CrawlSafetyInput | null;
}

function validate(input: StartCrawlInput): ValidatedInput {
  if (!input.startUrl || typeof input.startUrl !== "string") throw new CrawlValidationError("startUrl is required.");
  let url: URL;
  try {
    url = new URL(input.startUrl);
  } catch {
    throw new CrawlValidationError(`"${input.startUrl}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CrawlValidationError("Only http:// and https:// start URLs are allowed.");
  }

  const maxPagesRaw = input.maxPages ?? 100;
  // 0 = "crawl all pages" sentinel → CLI --max-pages 0 (unlimited).
  const maxPages = Number(maxPagesRaw) === 0 ? 0 : Math.min(1_000_000, Math.max(1, Math.floor(Number(maxPagesRaw) || 100)));

  let maxDepth: number | null = null;
  if (input.maxDepth !== undefined && input.maxDepth !== null) {
    const parsed = Math.floor(Number(input.maxDepth));
    if (!Number.isFinite(parsed) || parsed < 0) throw new CrawlValidationError("maxDepth must be a non-negative integer when provided.");
    maxDepth = parsed;
  }

  const render = input.render ?? "auto";
  if (render !== "auto" && render !== "never" && render !== "always") {
    throw new CrawlValidationError('render must be "auto", "never", or "always".');
  }

  const aliases = (input.aliases ?? []).map((h) => h.trim()).filter(Boolean);

  const seedUrls = (input.seedUrls ?? []).map((s) => s.trim()).filter(Boolean);
  for (const seed of seedUrls) {
    try {
      const parsed = new URL(seed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new CrawlValidationError(`Seed URL "${seed}" must be http(s).`);
    } catch (err) {
      if (err instanceof CrawlValidationError) throw err;
      throw new CrawlValidationError(`"${seed}" is not a valid seed URL.`);
    }
  }

  const auth = validateAuth(input.auth);
  const safety = validateSafety(input.safety, auth !== null);

  return {
    url,
    maxPages,
    maxDepth,
    respectRobots: input.respectRobots ?? true,
    render,
    screenshots: input.screenshots === true,
    aliases,
    seedUrls,
    auth,
    safety,
  };
}

// ── Run id ───────────────────────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function newRunId(hostname: string): string {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  const host = hostname.replace(/[^a-zA-Z0-9.-]/g, "-").slice(0, 60) || "crawl";
  return `${host}-${stamp}`;
}

// ── Start ──────────────────────────────────────────────────────────────────────────────────────

export interface StartedCrawl {
  runId: string;
}

export async function startCrawl(input: StartCrawlInput): Promise<StartedCrawl> {
  const running = await findRunningCrawl();
  if (running) throw new CrawlConflictError(running);

  const v = validate(input);
  const isLocal = v.url.hostname === "localhost" || /^127\./.test(v.url.hostname);
  const rps = isLocal ? 10 : 2;
  const runId = newRunId(v.url.hostname);

  const args = [
    "--import",
    "tsx",
    "src/index.ts",
    v.url.toString(),
    "--max-pages",
    String(v.maxPages),
    "--render",
    v.render,
    "--rps",
    String(rps),
    "--run-id",
    runId,
    "--out",
    "storage",
  ];
  if (!v.respectRobots) args.push("--no-robots");
  if (v.screenshots) args.push("--screenshots");
  if (v.aliases.length > 0) args.push("--alias", v.aliases.join(","));
  for (const seed of v.seedUrls) args.push("--seed", seed);
  if (v.maxDepth !== null) args.push("--max-depth", String(v.maxDepth));

  // Credentials flow ONLY into argv (see file header) — never logged, never persisted.
  if (v.auth?.basic) args.push("--basic-auth", `${v.auth.basic.username}:${v.auth.basic.password}`);
  if (v.auth?.cookie) args.push("--cookie", v.auth.cookie);
  if (v.auth) for (const [name, value] of Object.entries(v.auth.headers)) args.push("--header", `${name}: ${value}`);
  if (v.safety) {
    if (v.safety.excludePatterns.length > 0) args.push("--exclude", v.safety.excludePatterns.join(","));
    if (!v.safety.denyLogout && !v.safety.denyDestructive) args.push("--no-safety");
  }

  await mkdir(runDirPath(runId), { recursive: true });

  // Pre-create the RUNNING Crawl row so the SAME row is later upserted by syncRunToPostgres
  // (siteId_slug unique). config/configHash/extractorVersion are required non-null columns.
  const host = v.url.hostname;
  const { projectId, siteId } = await ensureProjectAndSite(prisma, host, host);
  const configSnapshot = {
    startUrl: v.url.toString(),
    maxPages: v.maxPages,
    maxDepth: v.maxDepth,
    respectRobots: v.respectRobots,
    render: v.render,
    screenshots: v.screenshots,
    aliases: v.aliases,
    seedUrls: v.seedUrls,
    authMethod: deriveAuthMethod(v.auth),
    rps,
  };
  const configHash = createHash("sha256").update(JSON.stringify(configSnapshot)).digest("hex");
  await prisma.crawl.upsert({
    where: { siteId_slug: { siteId, slug: runId } },
    update: {},
    create: {
      projectId,
      siteId,
      slug: runId,
      label: host,
      startUrl: v.url.toString(),
      status: "RUNNING",
      startedAt: new Date(),
      config: configSnapshot,
      configHash,
      extractorVersion: "vendored-crawler",
    },
  });

  const fd = openSync(logPath(runId), "a");
  const child = spawn(process.execPath, args, {
    windowsHide: true,
    cwd: CRAWLER_DIR,
    shell: false,
    stdio: ["ignore", fd, fd],
    env: process.env,
  });
  closeSync(fd);

  if (!child.pid) {
    await finalizeCrawlRow(runId, "failed", null);
    throw new Error("Failed to spawn crawler process (no pid).");
  }

  const disk: CrawlDiskStatus = {
    runId,
    state: "running",
    pid: child.pid,
    startUrl: v.url.toString(),
    maxPages: v.maxPages,
    maxDepth: v.maxDepth,
    respectRobots: v.respectRobots,
    render: v.render,
    screenshots: v.screenshots,
    aliases: v.aliases,
    seedUrls: v.seedUrls,
    authMethod: deriveAuthMethod(v.auth),
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
  };
  await writeDiskStatus(disk);
  liveChildren.set(runId, { pid: child.pid });

  child.on("exit", (code) => {
    void handleChildExit(runId, code, disk);
  });
  child.unref();

  return { runId };
}

/**
 * Child-exit handler. Runs OUTSIDE the request lifecycle (the child was unref'd). Every DB/analyze
 * step is guarded so a failure only logs — it can never crash the server nor flip a genuinely
 * finished crawl to "failed".
 *   - 0 | 2 → success/partial: run analyze, then finalize (sync + row → COMPLETED/PARTIAL).
 *   - 130   → cancelled (SIGINT). Left to cancelCrawl's own record; here we only stamp exitCode.
 *   - else  → failed: row → FAILED.
 */
async function handleChildExit(runId: string, code: number | null, started: CrawlDiskStatus): Promise<void> {
  liveChildren.delete(runId);
  // Race with cancelCrawl (which kills the same pid): if it already recorded `cancelled`, a killed
  // process legitimately exiting non-zero must not clobber that back to `failed`.
  const current = await readDiskStatus(runId);
  if (current?.state === "cancelled") {
    await writeDiskStatus({ ...current, exitCode: code });
    return;
  }

  const success = code === 0 || code === 2;
  if (success) {
    try {
      await runAnalyzeAndWait(runId).catch((err) => {
        console.error(`[crawlRunner] analyze(${runId}) failed:`, err instanceof Error ? err.message : err);
      });
      await finalizeCrawlRow(runId, "done", code);
      await writeDiskStatus({ ...started, state: "done", endedAt: new Date().toISOString(), exitCode: code });
    } catch (err) {
      console.error(`[crawlRunner] post-crawl sync(${runId}) failed:`, err instanceof Error ? err.message : err);
      await writeDiskStatus({ ...started, state: "done", endedAt: new Date().toISOString(), exitCode: code, note: "crawl finished; sync/analyze error (see server log)" });
    }
    return;
  }

  await finalizeCrawlRow(runId, "failed", code);
  await writeDiskStatus({ ...started, state: "failed", endedAt: new Date().toISOString(), exitCode: code });
}

// ── Analyze (awaited spawn) ──────────────────────────────────────────────────────────────────

/**
 * Runs `src/analysis/cli.ts --run <runId>` to completion (writes issues.json), appending to the
 * run's crawl.log, with a timeout. Same spawn discipline as the crawl. Rejects on non-zero/timeout.
 */
export async function runAnalyzeAndWait(runId: string, timeoutMs = 180_000): Promise<void> {
  const fd = openSync(logPath(runId), "a");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/analysis/cli.ts", "--run", runId, "--out", "storage"], {
      windowsHide: true,
      cwd: CRAWLER_DIR,
      shell: false,
      stdio: ["ignore", fd, fd],
      env: process.env,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`analyze timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (c) => {
      clearTimeout(timer);
      if (c === 0) resolve();
      else reject(new Error(`analyze exited with code ${c} — see crawl.log`));
    });
  }).finally(() => closeSync(fd));
}

// ── Cancel ─────────────────────────────────────────────────────────────────────────────────────

export async function cancelCrawl(runId: string): Promise<CrawlDiskStatus> {
  const status = await readDiskStatus(runId);
  if (!status) throw new CrawlControlError(`No crawl status found for runId "${runId}".`, 404);
  if (status.state !== "running") throw new CrawlControlError(`Crawl "${runId}" is not running (state: ${status.state}).`, 409);
  if (!isPidAlive(status.pid)) throw new CrawlControlError(`Crawl "${runId}" has no live process to cancel.`, 409);

  // Kill the whole process tree so the tsx-hosted CLI's headless-browser children die too.
  if (process.platform === "win32") {
    await execAsync(`taskkill /PID ${status.pid} /T /F`).catch(() => {
      /* pid may exit between the alive check and here — treat as already gone */
    });
  } else {
    try {
      process.kill(-status.pid, "SIGTERM");
    } catch {
      try {
        process.kill(status.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }

  liveChildren.delete(runId);
  const cancelled: CrawlDiskStatus = {
    ...status,
    state: "cancelled",
    endedAt: new Date().toISOString(),
    exitCode: null,
    note: "cancelled by user request — process tree killed before completion",
  };
  await writeDiskStatus(cancelled);
  await finalizeCrawlRow(runId, "cancelled", null);
  return cancelled;
}

// ── Reanalyze ──────────────────────────────────────────────────────────────────────────────────

/** Awaited re-analyze: rules engine → issues.json → syncRunToPostgres (findings refresh). */
export async function reanalyzeCrawl(runId: string, timeoutMs = 180_000): Promise<void> {
  if (!(await fileExists(runDirPath(runId)))) throw new CrawlControlError(`No run directory found for "${runId}".`, 404);
  await runAnalyzeAndWait(runId, timeoutMs);
  const report = await readJsonIfExists(reportPath(runId));
  if (!report) throw new CrawlControlError(`No report.json for "${runId}" — cannot sync findings.`, 409);
  const host = new URL(report.startUrl).hostname;
  await syncRunToPostgres(prisma, runDirPath(runId), runId, { allowFindings: true, label: host });
}

// ── Rerun ────────────────────────────────────────────────────────────────────────────────────

/**
 * Reads the prior run's config (DB Crawl.config, falling back to the disk status) and starts a
 * fresh crawl with the same settings. Auth credentials were never persisted, so an authenticated
 * run reruns anonymously — documented limitation, not a silent bug.
 */
export async function rerunCrawl(runId: string): Promise<StartedCrawl> {
  const crawl = await prisma.crawl.findFirst({ where: { slug: runId, deletedAt: null }, select: { config: true, startUrl: true } });
  const disk = await readDiskStatus(runId);
  if (!crawl && !disk) throw new CrawlControlError(`No crawl found for runId "${runId}".`, 404);

  const cfg = (crawl?.config as Record<string, unknown> | null) ?? null;
  const input: StartCrawlInput = {
    startUrl: (cfg?.startUrl as string) ?? disk?.startUrl ?? crawl?.startUrl ?? "",
    maxPages: (cfg?.maxPages as number) ?? disk?.maxPages,
    maxDepth: (cfg?.maxDepth as number | null) ?? disk?.maxDepth ?? null,
    respectRobots: (cfg?.respectRobots as boolean) ?? disk?.respectRobots ?? true,
    render: (cfg?.render as "auto" | "never" | "always") ?? disk?.render ?? "auto",
    screenshots: (cfg?.screenshots as boolean) ?? disk?.screenshots ?? false,
    aliases: (cfg?.aliases as string[]) ?? disk?.aliases ?? [],
    seedUrls: (cfg?.seedUrls as string[]) ?? disk?.seedUrls ?? [],
  };
  if (!input.startUrl) throw new CrawlControlError(`Cannot rerun "${runId}" — no start URL on record.`, 409);
  return startCrawl(input);
}

// ── Progress ───────────────────────────────────────────────────────────────────────────────────

export interface ProgressResult {
  state: CrawlState | "unknown";
  crawled: number | null;
  discovered: number | null;
  failed: number | null;
  blocked: number | null;
  rendered: number | null;
}

export async function getProgress(runId: string): Promise<ProgressResult | null> {
  const [status, ready] = await Promise.all([getCrawlStatus(runId), reportReady(runId)]);
  if (ready) {
    const report = await readJsonIfExists(reportPath(runId));
    if (report) {
      return {
        state: (status?.state as CrawlState) ?? "done",
        crawled: report.successful ?? 0,
        discovered: report.discovered ?? 0,
        failed: report.failed ?? 0,
        blocked: report.blockedByRobots ?? 0,
        rendered: report.jsRendered ?? 0,
      };
    }
  }
  if (!status) return null;
  const crawled = await countPageFiles(runId);
  return { state: status.state, crawled, discovered: null, failed: null, blocked: null, rendered: null };
}

// ── GET /:runId superset extras ────────────────────────────────────────────────────────────────

/** DB CrawlStatus → the client's CrawlState. */
function dbStatusToState(dbStatus: string): CrawlState {
  switch (dbStatus) {
    case "RUNNING":
    case "PENDING":
      return "running";
    case "COMPLETED":
    case "PARTIAL":
      return "done";
    case "CANCELLED":
      return "cancelled";
    default:
      return "failed";
  }
}

export interface RunStateExtras {
  state: CrawlState;
  exitCode: number | null;
  log: string[];
  reportReady: boolean;
  note?: string;
}

/**
 * The live-state fields the GET /:runId superset adds. Disk status FIRST (a RUNNING run may have no
 * report yet), with pid reconciliation baked into getCrawlStatus; falls back to the DB Crawl.status
 * when no disk status exists (an imported/older run). `dbStatus` is the existing Crawl.status string
 * (may be null when the run only exists on disk).
 */
export async function getRunStateExtras(runId: string, dbStatus: string | null): Promise<RunStateExtras> {
  const [disk, ready, log] = await Promise.all([getCrawlStatus(runId), reportReady(runId), tailLog(runId, 30)]);
  const state = disk ? disk.state : dbStatus ? dbStatusToState(dbStatus) : "done";
  return {
    state,
    exitCode: disk?.exitCode ?? null,
    log,
    reportReady: ready,
    note: disk?.note,
  };
}

export async function diskStatusExists(runId: string): Promise<boolean> {
  return fileExists(statusPath(runId));
}

// ── Events (SSE backing) ─────────────────────────────────────────────────────────────────────

export interface CrawlEvent {
  seq: number;
  type: string;
  ts: string;
  synthetic: boolean;
  [key: string]: unknown;
}

interface RawDurableEvent {
  seq: number;
  runId: string;
  kind: string;
  at: string;
  url: string | null;
  statusCode: number | null;
  message: string;
  detail?: Record<string, unknown>;
}

export async function hasDurableEventLog(runId: string): Promise<boolean> {
  return fileExists(eventsPath(runId));
}

/** Parse events.ndjson from a 1-indexed seq (exclusive) onward. Malformed/partial lines are skipped. */
export async function readDurableEvents(runId: string, fromSeqExclusive: number): Promise<CrawlEvent[]> {
  let text: string;
  try {
    text = await readFile(eventsPath(runId), "utf8");
  } catch {
    return [];
  }
  const out: CrawlEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as RawDurableEvent;
      if (typeof raw.seq !== "number" || raw.seq <= fromSeqExclusive) continue;
      out.push({
        seq: raw.seq,
        type: raw.kind,
        ts: raw.at,
        synthetic: false,
        runId: raw.runId,
        url: raw.url,
        statusCode: raw.statusCode,
        message: raw.message,
        detail: raw.detail,
      });
    } catch {
      /* partial/malformed line — skip */
    }
  }
  return out;
}

/**
 * Synthesizes a live stream from data that exists without the durable log: the newest crawl.log
 * line (only when it changed) + a progress event (page-file count + state) each call. Deliberately
 * emits no terminal `done` — the SSE route owns that, guarded by its own one-shot flag.
 */
export async function readSyntheticEvents(
  runId: string,
  fromSeqExclusive: number,
  lastLogLine: string | null,
): Promise<{ events: CrawlEvent[]; lastLogLine: string | null }> {
  const [status, logLines, pageCount] = await Promise.all([getCrawlStatus(runId), tailLog(runId, 1), countPageFiles(runId)]);
  const events: CrawlEvent[] = [];
  let seq = fromSeqExclusive;
  const newestLine = logLines[0] ?? null;

  if (newestLine && newestLine !== lastLogLine) {
    seq++;
    events.push({ seq, type: "log", ts: new Date().toISOString(), synthetic: true, message: newestLine, url: null, statusCode: null, line: newestLine });
  }
  seq++;
  events.push({ seq, type: "progress", ts: new Date().toISOString(), synthetic: true, message: `${pageCount} pages`, url: null, statusCode: null, crawled: pageCount, state: status?.state ?? "unknown" });

  return { events, lastLogLine: newestLine };
}

/** True once the run is no longer running AND a report exists — the synthetic path's terminal cue. */
export async function isSyntheticDone(runId: string): Promise<{ done: boolean; state: CrawlState | null; exitCode: number | null }> {
  const [status, ready] = await Promise.all([getCrawlStatus(runId), reportReady(runId)]);
  if (status && status.state !== "running" && ready) return { done: true, state: status.state, exitCode: status.exitCode };
  return { done: false, state: status?.state ?? null, exitCode: status?.exitCode ?? null };
}

export { env as crawlEnv };
