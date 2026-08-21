/**
 * Route smoke test — boots the server fresh (auth OFF) on a throwaway port, probes every mounted
 * route, and asserts each returns a sane, MOUNTED status (not the 404 catch-all, not a 500 crash,
 * and — for public routes — not a 401). Re-runnable validation of the whole route surface.
 *
 * WHY auth off: with AUTH_REQUIRED=false the requireAuth gate calls next() without a userId, so:
 *   - public routes (health, tunnel verify/heartbeat/result, gsc callback) run their real logic;
 *   - non-user-scoped crawl-data routes (graph, measurements, previous-rule-counts, 501 stubs) run;
 *   - user-scoped routes (exports, comparisons, tunnel pair/sites, applied-fixes) return 401 from
 *     their OWN userId() guard — which still proves they are mounted (a missing mount would 404).
 * A truly-missing path returns 404 from the catch-all. So "mounted" = status ∈ the expected set.
 *
 * If a real crawl run exists (fetched live), read-only data routes are asserted at 200 (tighter —
 * catches a mount regression that a fake-id 404 would hide). Destructive/side-effecting routes are
 * ALWAYS probed with a non-existent id so the script never mutates real data.
 *
 * Run:  npm run smoke           (from server/)
 *       SMOKE_PORT=4210 npm run smoke
 * Exit code 0 = all pass, 1 = any failure (CI-friendly).
 */
import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..");
const PORT = Number(process.env.SMOKE_PORT ?? 4199);
const BASE = `http://localhost:${PORT}`;
const FAKE_RUN = "smoke-nonexistent-run"; // safe id, guaranteed 404 — never mutates real data

interface Probe {
  method: string;
  path: string;
  body?: unknown;
  ok: number[]; // acceptable (= "mounted + behaving") statuses
  note: string;
}

/** Build the probe list; `run` is a real runId when one exists (tightens read-route asserts to 200). */
function probes(run: string | null): Probe[] {
  const r = run ?? FAKE_RUN;
  const readOk = run ? [200] : [200, 404]; // real run -> must be 200; no data -> 200 or 404 both fine
  return [
    // ── public (must NOT be 401) ──
    { method: "GET", path: "/api/health", ok: [200], note: "public health" },
    { method: "GET", path: "/api/version", ok: [200], note: "public version" },
    { method: "POST", path: "/api/tunnel/verify", body: {}, ok: [400], note: "public tunnel verify (missing code)" },
    { method: "POST", path: "/api/tunnel/heartbeat", body: {}, ok: [400, 401], note: "public tunnel heartbeat (no token)" },
    { method: "POST", path: "/api/tunnel/result", body: {}, ok: [400, 401], note: "public tunnel result (no token)" },
    // callback redirects to the client; with redirect:"manual" undici returns an opaque-redirect
    // (status 0). Accept the redirect sentinel + explicit 3xx/400 — all mean "mounted & responded".
    { method: "GET", path: "/api/gsc/callback", ok: [0, 302, 307, 400], note: "public gsc oauth callback (redirect)" },
    // ── protected, non-user-scoped (execute with auth off) ──
    { method: "GET", path: `/api/crawls/${r}/graph`, ok: run ? [200] : [404], note: "pagerank/graph" },
    { method: "GET", path: `/api/crawls/${r}/previous-rule-counts`, ok: [200], note: "issues previous-run delta" },
    { method: "GET", path: `/api/crawls/${r}/measurements/thin-content/pages`, ok: readOk, note: "measurements drill-down" },
    { method: "POST", path: `/api/crawls/${FAKE_RUN}/cancel`, body: {}, ok: [501], note: "crawl cancel honest stub" },
    { method: "GET", path: `/api/crawls/${FAKE_RUN}/progress`, ok: [501], note: "crawl progress honest stub" },
    { method: "GET", path: `/api/crawls/${FAKE_RUN}/events`, ok: [501], note: "crawl events honest stub" },
    { method: "POST", path: `/api/crawls/${FAKE_RUN}/reanalyze`, body: {}, ok: [501], note: "reanalyze honest stub" },
    { method: "GET", path: `/api/crawls/${r}/automation`, ok: readOk, note: "automation classification" },
    { method: "GET", path: `/api/crawls/${r}/fix-plan`, ok: [200, 401, 404], note: "fix plan" },
    // ── user-scoped (auth off -> 401 from own guard = mounted) ──
    { method: "GET", path: "/api/exports", ok: [401], note: "exports list (user-scoped)" },
    { method: "POST", path: `/api/crawls/${FAKE_RUN}/exports`, body: {}, ok: [401], note: "create export (user-scoped)" },
    { method: "GET", path: "/api/comparisons", ok: [401], note: "saved comparisons (user-scoped)" },
    { method: "GET", path: `/api/crawls/${FAKE_RUN}/applied-fixes`, ok: [401], note: "applied-fixes read (user-scoped)" },
    { method: "GET", path: "/api/artifacts/status", ok: [200], note: "artifacts storage status" },
    { method: "DELETE", path: `/api/crawls/${FAKE_RUN}`, ok: [404, 401], note: "delete run (fake id -> not found)" },
    { method: "POST", path: "/api/tunnel/pair", body: { siteUrl: "https://smoke.example.com" }, ok: [401], note: "tunnel pair (user-scoped)" },
    { method: "GET", path: "/api/tunnel/sites", ok: [401], note: "tunnel sites (user-scoped)" },
    { method: "GET", path: "/api/sources", ok: [401], note: "sources list (user-scoped)" },
    { method: "GET", path: "/api/gsc/status", ok: [200, 401], note: "gsc status" },
    // ── catch-all sanity: a truly-missing path must 404 ──
    { method: "GET", path: "/api/definitely-not-a-route", ok: [404], note: "catch-all 404 sanity" },
  ];
}

async function fetchStatus(p: Probe): Promise<number> {
  try {
    const res = await fetch(`${BASE}${p.path}`, {
      method: p.method,
      headers: p.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: p.body !== undefined ? JSON.stringify(p.body) : undefined,
      redirect: "manual", // assert the route's OWN status (e.g. gsc callback 302), don't follow it
      signal: AbortSignal.timeout(20000), // generous — graph/measurements compute over large runs; still bounded
    });
    return res.status;
  } catch {
    return 0; // connection error or timeout
  }
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function getRealRunId(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/crawls`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { runs?: { runId?: string }[] };
    return data.runs?.find((r) => typeof r.runId === "string")?.runId ?? null;
  } catch {
    return null;
  }
}

// ── boot the server (auth off) on the throwaway port ──
const child = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: serverDir,
  shell: true,
  detached: process.platform !== "win32", // own process group on POSIX for group-kill
  env: { ...process.env, PORT: String(PORT), AUTH_REQUIRED: "false", CLIENT_ORIGIN: "http://localhost:5173" },
  stdio: "ignore", // ignore ALL child stdio — an inherited stderr pipe would keep the shell open past exit
});

let toreDown = false;
function teardown(): void {
  if (toreDown || child.pid === undefined) return;
  toreDown = true;
  try {
    if (process.platform === "win32") {
      // SYNCHRONOUS kill of the whole tree (cmd -> npx -> node) so it's dead before we exit.
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
}
process.on("exit", teardown);
process.on("SIGINT", () => { teardown(); process.exit(130); });

let failures = 0;
try {
  console.log(`[smoke] booting server on ${BASE} (auth off)…`);
  const up = await waitForHealth(30_000);
  if (!up) {
    console.error("[smoke] FAIL: server did not become healthy within 30s");
    teardown();
    process.exit(1);
  }
  const run = await getRealRunId();
  console.log(run ? `[smoke] using real run "${run}" for read-route asserts (tight)` : "[smoke] no seeded run found — read routes asserted loosely");
  console.log("");

  const list = probes(run);
  for (const p of list) {
    const status = await fetchStatus(p);
    const pass = p.ok.includes(status);
    if (!pass) failures++;
    const tag = pass ? "PASS" : "FAIL";
    const label = `${p.method} ${p.path}`.padEnd(52);
    console.log(`  [${tag}] ${label} -> ${status}  (want ${p.ok.join("/")})  ${p.note}`);
  }

  console.log("");
  console.log(`[smoke] ${list.length - failures}/${list.length} passed${failures ? ` — ${failures} FAILED` : " — all green"}`);
} finally {
  teardown();
}
process.exit(failures > 0 ? 1 : 0);
