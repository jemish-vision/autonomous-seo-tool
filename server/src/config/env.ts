/**
 * Loads and validates environment variables ONCE at startup.
 *
 * Import this module for its side effect (it calls loadEnvFile) before anything that reads
 * process.env — src/index.ts does that on line 1. Node 20.6+ has a native .env loader, so there
 * is no dotenv dependency.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, "../../.env");

try {
  // Native loader (Node 20.6+). If the shell already exported the vars, the file may be absent —
  // that is fine, the required-check below is the real gate.
  process.loadEnvFile(envPath);
} catch {
  /* env already in process.env, or file absent — validated below */
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} (see server/.env)`);
  return value;
}

const port = Number(process.env.PORT ?? 4000);

export const env = {
  databaseUrl: required("DATABASE_URL"),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  port,
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  authRequired: process.env.AUTH_REQUIRED !== "false",

  // --- Google Search Console (all OPTIONAL) ---
  // When clientId/clientSecret are unset, /api/gsc/status reports "not configured" and the live
  // OAuth/sync/inspect routes degrade with a clear message — the server never crashes on the gap.
  // The GSC lib reads these from process.env directly (so an unset value can be reported at runtime
  // rather than blocking startup); they are surfaced here for documentation + the derived defaults.
  gsc: {
    // Consent + token exchange credentials from the Google Cloud OAuth client.
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || null,
    // Must be registered verbatim on the OAuth client. Defaults to this API's own callback.
    redirectUri: process.env.GOOGLE_REDIRECT_URI?.trim() || `http://localhost:${port}/api/gsc/callback`,
    // HMAC key for the OAuth `state` param; falls back to GSC_TOKEN_KEY (also stable across restarts).
    stateSecret: process.env.GSC_STATE_SECRET?.trim() || process.env.GSC_TOKEN_KEY?.trim() || null,
    // AES-256-GCM key material for encrypting refresh tokens at rest.
    tokenKey: process.env.GSC_TOKEN_KEY?.trim() || null,
    // Default sync window (days) for the explicit "Sync" action.
    syncDays: Number(process.env.GSC_SYNC_DAYS) || 28,
  },
} as const;
