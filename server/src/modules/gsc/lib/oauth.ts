/**
 * Google OAuth 2.0 for Search Console, implemented against the endpoints directly — two POSTs and a
 * redirect URL, so no `googleapis` dependency.
 *
 * Ported from poc/seo-dashboard/lib/gsc/oauth.ts. Adaptations for this Express/Supabase app:
 *  - the connection is a Postgres row via the vendored db store (db/src/gsc/store.ts), not a JSON
 *    file, so read/write/delete go through gscReadConnection/gscWriteConnection/gscDeleteConnection
 *    with the shared Prisma client;
 *  - the OAuth `state` secret comes from env (GSC_STATE_SECRET, falling back to GSC_TOKEN_KEY)
 *    rather than a persisted file — env is already stable across restarts here;
 *  - the redirect URI defaults to this API's own /api/gsc/callback on env.port.
 *
 * The `state` still carries the user id in a short-lived HMAC-signed token, because the callback is
 * a public top-level browser navigation from accounts.google.com with no Bearer token.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../../config/env.js";
import { prisma } from "../../../db/prisma.js";
import {
  gscReadConnection,
  gscWriteConnection,
  gscDeleteConnection,
  type GscConnectionRow,
} from "../../../db/src/gsc/store.js";
import { decryptToken, encryptToken } from "./crypto.js";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

/** Read-only Search Console, plus the two identity scopes to show which Google account connected. */
export const GSC_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly", "openid", "email"];

/** Refresh this many seconds before actual expiry, to absorb clock skew. */
const EXPIRY_SKEW_SECONDS = 60;
/** The CSRF state token is only in flight for the length of a consent screen. */
const STATE_TTL_SECONDS = 600;

export class GscConnectionExpiredError extends Error {
  constructor(detail?: string) {
    super(
      `Google has invalidated this connection${detail ? ` (${detail})` : ""}. Reconnect Search Console. ` +
        "If this recurs weekly, the OAuth app is still in Testing status — Google expires those refresh tokens after 7 days. " +
        "Set the consent screen's User type to Internal, or publish and verify the app.",
    );
    this.name = "GscConnectionExpiredError";
  }
}

export class GscNotConfiguredError extends Error {
  constructor() {
    super(
      "Google Search Console is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the server's .env.",
    );
    this.name = "GscNotConfiguredError";
  }
}

export interface GscConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Returns null rather than throwing, so /api/gsc/status can report the gap. */
export function gscConfig(): GscConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: resolveRedirectUri() };
}

/**
 * Where Google sends the user back. An explicit GOOGLE_REDIRECT_URI wins; otherwise it is derived
 * from this API's own port. Whatever this resolves to must be registered verbatim on the OAuth
 * client, or Google returns redirect_uri_mismatch.
 */
function resolveRedirectUri(): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `http://localhost:${env.port}/api/gsc/callback`;
}

function requireConfig(): GscConfig {
  const config = gscConfig();
  if (!config) throw new GscNotConfiguredError();
  return config;
}

/** A stable per-install secret for signing the OAuth `state`. */
function stateSecret(): string {
  return process.env.GSC_STATE_SECRET?.trim() || process.env.GSC_TOKEN_KEY?.trim() || "gsc-state-secret-dev";
}

// ---------------------------------------------------------------------------
// Step 1 — send the user to Google
// ---------------------------------------------------------------------------

function signState(userId: string): string {
  // The HMAC must run over the exact base64url payload string that travels in the URL — verifyState
  // hashes payloadB64 too. Hashing the raw JSON Buffer instead would make sign and verify disagree.
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS }),
  ).toString("base64url");
  const sig = createHmac("sha256", stateSecret()).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

/** Returns the user id the state was issued to, or null if it isn't valid. */
export function verifyState(state: string | undefined): string | null {
  if (!state) return null;
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac("sha256", stateSecret()).update(payloadB64).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as { sub?: unknown; exp?: unknown };
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/**
 * Builds the consent URL for one user. `access_type=offline` together with `prompt=consent` is what
 * makes Google return a refresh token.
 */
export function buildAuthUrl(userId: string): string {
  const config = requireConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GSC_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signState(userId),
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Step 2 — exchange the code, and keep the token alive
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => null)) as (TokenResponse & { error_description?: string; error?: string }) | null;
  if (!res.ok || !json?.access_token) {
    if (json?.error === "invalid_grant") throw new GscConnectionExpiredError(json.error_description);
    const detail = json?.error_description ?? json?.error ?? `HTTP ${res.status}`;
    throw new Error(`Google token request failed: ${detail}`);
  }
  return json;
}

/** Complete the flow: swap the authorization code for tokens and store the connection. */
export async function exchangeCodeAndStore(userId: string, code: string): Promise<{ googleEmail: string | null }> {
  const config = requireConfig();
  const tokens = await postToken({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });

  if (!tokens.refresh_token) {
    throw new Error(
      "Google returned no refresh token. Remove this app at myaccount.google.com/permissions and connect again.",
    );
  }

  const googleEmail = await fetchGoogleEmail(tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const now = new Date().toISOString();

  await gscWriteConnection(prisma, {
    userId,
    googleEmail,
    refreshTokenEnc: encryptToken(tokens.refresh_token),
    accessToken: tokens.access_token,
    accessTokenExpiresAt: expiresAt,
    scopes: tokens.scope ?? GSC_SCOPES.join(" "),
    createdAt: now,
    updatedAt: now,
  });

  return { googleEmail };
}

/** Best-effort: a missing email costs a label in the UI, not the connection. */
async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_ENDPOINT, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

/** Returns a usable access token for a user, refreshing it if it has expired. */
export async function getAccessToken(userId: string): Promise<string> {
  const connection = await gscReadConnection(prisma, userId);
  if (!connection) throw new Error("Search Console is not connected for this account.");

  const expiresAt = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : 0;
  const stillFresh = connection.accessToken && expiresAt - EXPIRY_SKEW_SECONDS * 1000 > Date.now();
  if (stillFresh) return connection.accessToken as string;

  const config = requireConfig();
  const tokens = await postToken({
    refresh_token: decryptToken(connection.refreshTokenEnc),
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });

  const updated: GscConnectionRow = {
    ...connection,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await gscWriteConnection(prisma, updated);

  return tokens.access_token;
}

/**
 * Disconnect: tell Google to drop the grant, then delete the connection. A failed revoke still
 * proceeds to the delete, because leaving a stale local row would be worse.
 */
export async function disconnect(userId: string): Promise<void> {
  const connection = await gscReadConnection(prisma, userId);
  if (!connection) return;

  try {
    await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: decryptToken(connection.refreshTokenEnc) }).toString(),
    });
  } catch (err) {
    console.error("[gsc] revoke failed, deleting local connection anyway:", err);
  }

  await gscDeleteConnection(prisma, userId);
}
