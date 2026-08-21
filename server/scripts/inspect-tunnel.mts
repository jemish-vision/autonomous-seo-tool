/**
 * Read-only tunnel inspection: for a given site URL, dump the linked source, its tunnel_connection
 * (heartbeat freshness), and recent tunnel_commands. Uses the service-role client (bypasses RLS).
 *
 * Run:  npx tsx scripts/inspect-tunnel.mts https://wpdemo.ourportfolios.co
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getServiceClient } from "../src/supabase/service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, "..", ".env"));
} catch {
  /* already exported */
}

const arg = process.argv[2] ?? "https://wpdemo.ourportfolios.co";
const origin = new URL(arg).origin;

const state = getServiceClient();
if (!state.configured) {
  console.log("service client NOT configured:", state.reason);
  process.exit(1);
}
const db = state.client;

const now = Date.now();
const fresh = (ts: string | null) =>
  ts ? `${Math.round((now - new Date(ts).getTime()) / 1000)}s ago` : "never";

const { data: conns } = await db.from("tunnel_connections").select("*");
const conn = (conns ?? []).find((c) => {
  try {
    return new URL(c.site_url).origin === origin;
  } catch {
    return false;
  }
});

const { data: sources } = await db.from("sources").select("id,user_id,kind,name,site_url,status");
const src = (sources ?? []).find((s) => {
  try {
    return new URL(s.site_url).origin === origin;
  } catch {
    return false;
  }
});

console.log("== origin ==", origin);
console.log("\n== source row ==");
console.log(src ? { id: src.id, name: src.name, site_url: src.site_url, status_state: src.status?.state ?? null } : "NONE");

console.log("\n== tunnel_connection ==");
if (!conn) {
  console.log("NONE — no plugin has paired+heartbeated for this origin");
} else {
  console.log({
    id: conn.id,
    source_id: conn.source_id,
    status: conn.status,
    last_heartbeat: fresh(conn.last_heartbeat),
    online: conn.last_heartbeat ? now - new Date(conn.last_heartbeat).getTime() < 120_000 : false,
    seo_provider: conn.site_info?.seoProvider ?? conn.site_info?.capabilities?.seo_provider ?? null,
    writable: conn.writable_capabilities ?? null,
  });
}

const { data: cmds } = await db
  .from("tunnel_commands")
  .select("id,action,status,created_at,completed_at,site_id")
  .order("created_at", { ascending: false })
  .limit(5);
console.log("\n== recent tunnel_commands (any site) ==");
for (const c of cmds ?? []) {
  console.log(`  ${c.status.padEnd(10)} ${c.action.padEnd(16)} ${fresh(c.created_at)}  site=${c.site_id}`);
}
if ((cmds ?? []).length === 0) console.log("  (none yet)");
