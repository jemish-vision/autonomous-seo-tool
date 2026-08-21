/**
 * End-to-end test for the URL-based Fix & Apply targeting flow (POST /api/sources/resolve),
 * the replacement for the removed active-source selector.
 *
 * Real E2E — no mocks:
 *   1. Mint a throwaway Supabase auth user (GoTrue admin) + a real access token (password grant).
 *   2. Boot the server on a throwaway port with AUTH_REQUIRED=true.
 *   3. Seed two sources with DISTINCT origins through the live API (exercises the create path).
 *   4. Probe POST /api/sources/resolve with deep page URLs and assert each resolves to the
 *      source that owns that origin — the exact guarantee the client's AiRecommendationCard relies
 *      on now that it no longer reads /api/sources/active.
 *   5. Boundary probes: unconnected origin -> resolved:false; bad URL -> 400; no token -> 401.
 *   6. Clean up sources + user no matter what.
 *
 * Run:  npx tsx scripts/e2e-resolve.mts        (from server/)
 * Exit 0 = all pass, 1 = any failure.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..");
process.loadEnvFile(path.resolve(serverDir, ".env"));

const SUPABASE_URL = must("SUPABASE_URL");
const SERVICE_KEY = must("SUPABASE_SERVICE_ROLE_KEY");
const PORT = Number(process.env.E2E_PORT ?? 4207);
const BASE = `http://localhost:${PORT}`;

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const gotrue = (p: string) => `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1${p}`;
const adminHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ::  ${detail}`);
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now.call(null) as number; // Date.now available in tsx runtime
  const end = deadline + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

let server: ChildProcess | null = null;
let userId = "";
let accessToken = "";
const createdSourceIds: string[] = [];
const email = `e2e-resolve-${Math.floor(Date.now() / 1000)}@example.test`;
const password = `Pw-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}A1!`;

async function main() {
  // ── 1. Mint user + token ──────────────────────────────────────────────────────────────────
  const createRes = await fetch(gotrue("/admin/users"), {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const createBody = await createRes.json();
  if (!createRes.ok || !createBody.id) throw new Error(`admin createUser failed: ${createRes.status} ${JSON.stringify(createBody)}`);
  userId = createBody.id;

  const tokenRes = await fetch(gotrue("/token?grant_type=password"), {
    method: "POST",
    headers: { apikey: SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const tokenBody = await tokenRes.json();
  if (!tokenRes.ok || !tokenBody.access_token) throw new Error(`password grant failed: ${tokenRes.status} ${JSON.stringify(tokenBody)}`);
  accessToken = tokenBody.access_token;
  console.log(`[setup] user ${userId} + token minted`);

  const auth = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  // ── 2. Boot server ────────────────────────────────────────────────────────────────────────
  server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(PORT), AUTH_REQUIRED: "true" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  server.stdout?.on("data", (d) => process.stdout.write(`[srv] ${d}`));
  server.stderr?.on("data", (d) => process.stderr.write(`[srv!] ${d}`));
  const up = await waitForHealth(30_000);
  if (!up) throw new Error("server did not become healthy in 30s");

  // Sanity: auth truly required (no token -> 401).
  const noTok = await fetch(`${BASE}/api/sources/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://alpha.example.com/x" }),
  });
  check("no-token -> 401", noTok.status === 401, `status ${noTok.status}`);

  // ── 3. Seed two sources, distinct origins ───────────────────────────────────────────────────
  const alphaSite = "https://alpha-e2e.example.com";
  const betaSite = "https://beta-e2e.example.com";
  for (const [name, siteUrl] of [
    ["Alpha E2E", alphaSite],
    ["Beta E2E", betaSite],
  ] as const) {
    const r = await fetch(`${BASE}/api/sources`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ kind: "wordpress", name, siteUrl }),
    });
    const b = await r.json();
    if (r.status !== 201 || !b.id) throw new Error(`seed ${name} failed: ${r.status} ${JSON.stringify(b)}`);
    createdSourceIds.push(b.id);
  }
  const [alphaId, betaId] = createdSourceIds;
  console.log(`[setup] seeded alpha=${alphaId} beta=${betaId}`);

  async function resolve(url: string) {
    const r = await fetch(`${BASE}/api/sources/resolve`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ url }),
    });
    return { status: r.status, body: await r.json() };
  }

  // ── 4. Per-URL targeting: deep page URLs must map to the owning origin ──────────────────────
  {
    const url = `${alphaSite}/blog/some-post?utm=x#frag`;
    const { status, body } = await resolve(url);
    check(
      "deep alpha URL -> alpha source",
      status === 200 && body.resolved === true && body.source?.id === alphaId,
      `status ${status} resolved=${body.resolved} source.id=${body.source?.id} (want ${alphaId})`,
    );
  }
  {
    const url = `${betaSite}/products/item-42`;
    const { status, body } = await resolve(url);
    check(
      "deep beta URL -> beta source",
      status === 200 && body.resolved === true && body.source?.id === betaId,
      `status ${status} resolved=${body.resolved} source.id=${body.source?.id} (want ${betaId})`,
    );
  }
  {
    // Cross-check: alpha origin must NOT resolve to beta (guards an accidental first-row match).
    const { body } = await resolve(`${alphaSite}/`);
    check("alpha origin not mismatched to beta", body.source?.id === alphaId && body.source?.id !== betaId, `got ${body.source?.id}`);
  }
  {
    // Contract shape the client reads: connection.state present.
    const { body } = await resolve(`${alphaSite}/x`);
    check("resolve payload carries connection.state", typeof body.connection?.state === "string", `connection=${JSON.stringify(body.connection)}`);
  }

  // ── 5. Boundaries ──────────────────────────────────────────────────────────────────────────
  {
    const { status, body } = await resolve("https://unconnected-origin.example.org/page");
    check("unconnected origin -> resolved:false", status === 200 && body.resolved === false, `status ${status} resolved=${body.resolved}`);
  }
  {
    const { status } = await resolve("not-a-url");
    check("invalid URL -> 400", status === 400, `status ${status}`);
  }
  {
    const r = await fetch(`${BASE}/api/sources/resolve`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    check("missing url field -> 400", r.status === 400, `status ${r.status}`);
  }
}

async function cleanup() {
  const auth = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  for (const id of createdSourceIds) {
    try {
      await fetch(`${BASE}/api/sources/${id}`, { method: "DELETE", headers: auth });
    } catch {
      /* best effort */
    }
  }
  if (userId) {
    try {
      await fetch(gotrue(`/admin/users/${userId}`), { method: "DELETE", headers: adminHeaders });
    } catch {
      /* best effort */
    }
  }
  if (server && !server.killed) server.kill();
}

main()
  .catch((e) => {
    console.error("SETUP/RUN ERROR:", e instanceof Error ? e.message : e);
    check("harness ran without throwing", false, String(e instanceof Error ? e.message : e));
  })
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n──────── ${results.length - failed.length}/${results.length} passed ────────`);
    process.exit(failed.length ? 1 : 0);
  });
