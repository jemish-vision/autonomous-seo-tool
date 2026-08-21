/**
 * Integration check for the Supabase-backed sources store (RLS defense-in-depth).
 *
 * Proves the exact requirement: a source created by an account is visible from a
 * SEPARATE session of the same account (another PC), and is NOT visible to a
 * different account (RLS isolation). Uses throwaway auth users; cleans up after.
 *
 * NOTE: our Express backend uses the SERVICE-ROLE client (bypasses RLS) and scopes by
 * user_id in code — this script exercises the DB-level RLS policies directly (via the
 * anon key + a signed-in session) to confirm they still hold as defense-in-depth.
 *
 * Requires SUPABASE_ANON_KEY in server/.env (the real anon key). If it is absent this
 * script exits cleanly with a skip notice — the code-scoped path is the production gate.
 *
 * Run: node scripts/verify-sources-roundtrip.mjs   (from server/)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function envFrom(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* file absent — fall back to process.env */
  }
  return out;
}

const fileEnv = envFrom(path.join(here, "..", ".env"));
const get = (k) => process.env[k] ?? fileEnv[k];

const URL = get("SUPABASE_URL");
const ANON = get("SUPABASE_ANON_KEY");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL || !SERVICE) throw new Error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env");
if (!ANON) {
  console.log("SKIP: SUPABASE_ANON_KEY not set in server/.env — RLS roundtrip needs an anon-key session.");
  console.log("      The production gate is the code-scoped (user_id = req.userId) query path, which does not use this key.");
  process.exit(0);
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

function randomHex(n) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const pw = "Test-" + randomHex(12) + "!aB1";

async function makeUser(tag) {
  const email = `srctest+${tag}-${randomHex(6)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw new Error(`createUser(${tag}): ${error.message}`);
  return { id: data.user.id, email };
}

/** A fresh anon client signed in as `email` — simulates one browser/PC session. */
async function session(email) {
  const c = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return c;
}

const assert = (cond, msg) => {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS:", msg);
};

let userA, userB;
try {
  userA = await makeUser("A");
  userB = await makeUser("B");

  // PC 1 — account A creates a source
  const pc1 = await session(userA.email);
  const id = "wp-" + randomHex(4);
  const ins = await pc1
    .from("sources")
    .insert({ id, kind: "wordpress", name: "Roundtrip Test", site_url: "https://example.com", credentials: { username: "u" } })
    .select("*")
    .single();
  assert(!ins.error && ins.data?.id === id, "account A can insert a source (RLS insert)");
  assert(ins.data.user_id, "user_id auto-populated from auth.uid(): " + ins.data.user_id);

  // PC 2 — SAME account, brand-new session (different machine)
  const pc2 = await session(userA.email);
  const seen = await pc2.from("sources").select("*").eq("id", id).maybeSingle();
  assert(!seen.error && seen.data?.id === id, "SAME account, separate session (other PC) sees the source");

  // Other account must NOT see it
  const other = await session(userB.email);
  const leak = await other.from("sources").select("*").eq("id", id).maybeSingle();
  assert(!leak.error && leak.data === null, "different account canNOT see account A's source (RLS isolation)");

  // Status persists on the row (cross-PC connected state)
  const st = { sourceId: id, state: "connected", lastCheckedAt: new Date().toISOString() };
  const up = await pc1.from("sources").update({ status: st }).eq("id", id).select("status").single();
  assert(!up.error && up.data.status.state === "connected", "status persists on the row");
  const stFromPc2 = await pc2.from("sources").select("status").eq("id", id).single();
  assert(stFromPc2.data.status.state === "connected", "other PC reads persisted connected status");

  console.log("\nALL CHECKS PASSED");
} finally {
  // cleanup
  const del = admin.from("sources").delete();
  await del.neq("id", "__none__").in("user_id", [userA?.id, userB?.id].filter(Boolean));
  if (userA) await admin.auth.admin.deleteUser(userA.id);
  if (userB) await admin.auth.admin.deleteUser(userB.id);
  console.log("cleanup done");
}
