/**
 * Content sources (WordPress / Shopify connectors) — CRUD backed by Supabase (public.sources).
 *
 * Replicates the old Next.js app/api/sources/** routes + lib/data-sources.ts, which migrated
 * source configs off a disk sources.json into Supabase (commit 5f22e20, "migrate source
 * configurations to Supabase + implement RLS"). Same per-user scoping, but enforced differently:
 *
 *   Old app: request-scoped anon Supabase client + session cookie → RLS (auth.uid()) is the boundary.
 *   This app: SERVICE-ROLE Supabase client (bypasses RLS) → we scope EVERY query by
 *             user_id = req.userId (from the verified JWT) IN CODE. The RLS policies still exist in
 *             the DB as defense-in-depth (see scripts/sources-supabase-migration.sql).
 *
 *   GET    /api/sources            -> SourceConfig[]      (this user's sources)
 *   POST   /api/sources            -> SourceConfig (201)  (create; generates id, defaults)
 *   POST   /api/sources/resolve    -> { resolved, source?, connection? }  (match a URL to a source)
 *   GET    /api/sources/:id        -> SourceConfig
 *   PATCH  /api/sources/:id        -> SourceConfig
 *   DELETE /api/sources/:id        -> { ok: true }
 *   POST   /api/sources/:id/connect-> { ok, status, capabilities }  (health check)
 *   GET    /api/sources/:id/seo    -> connector SEO fields
 *   POST   /api/sources/:id/seo    -> write receipt
 *
 * The credential-less TUNNEL paths (connect + queued SEO writes) are backed by the Supabase tunnel_*
 * tables (see server/src/modules/tunnel) rather than the old app's storage/tunnel-*.json on disk:
 *   /:id/connect  reads the paired tunnel_connections row (kept fresh by the plugin heartbeat).
 *   POST /:id/seo queues a tunnel_commands row the plugin applies on its next poll.
 * GET /:id/seo has no tunnel equivalent (the old app had no tunnel read) and returns a clear 501.
 * The DIRECT (Basic Auth) connector paths are pure outbound HTTP and are fully ported.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { asyncHandler } from "../../middleware/error.js";
import { getServiceClient } from "../../supabase/service.js";
import { isSafeId } from "../../lib/apiShared.js";
import {
  readCloudArcadeCredentials,
  cloudArcadeConnect,
  cloudArcadeApply,
} from "./cloudarcadeConnector.js";

// ── Types (platform-neutral contract, mirrors client/src/lib/types-sources.ts) ──────────────

type SourceKind = "wordpress" | "shopify" | "cloudarcade";
type SourceConnectionState = "connected" | "disconnected" | "error" | "unchecked";

interface SourceConfig {
  id: string;
  kind: SourceKind;
  name: string;
  siteUrl: string;
  credentials: Record<string, string>;
  /** True for the single connection Fix & Apply writes through. Only one per user. */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SourceStatus {
  sourceId: string;
  state: SourceConnectionState;
  lastCheckedAt: string | null;
  error?: string;
  meta?: Record<string, unknown>;
}

interface SourceCapabilities {
  sourceId: string;
  wordpress?: boolean;
  wordpressVersion?: string;
  pages?: boolean;
  posts?: boolean;
  customPostTypes?: string[];
  media?: boolean;
  woocommerce?: boolean;
  woocommerceVersion?: string | null;
  seoProvider?: string;
  capabilities?: Record<string, { read: boolean; write: boolean }>;
  fetchedAt: string;
}

interface SourceRow {
  id: string;
  user_id: string;
  kind: SourceKind;
  name: string;
  site_url: string;
  credentials: Record<string, string> | null;
  status: SourceStatus | null;
  capabilities: SourceCapabilities | null;
  active: boolean | null;
  created_at: string;
  updated_at: string;
}

/** A paired tunnel connection (public.tunnel_connections), joined to a source by source_id. */
interface TunnelConnectionRow {
  id: string;
  user_id: string;
  source_id: string | null;
  site_url: string;
  last_heartbeat: string | null;
  status: string;
  site_info: Record<string, unknown> | null;
}

// ── Row <-> config mapping ──────────────────────────────────────────────────────────────────

function rowToConfig(row: SourceRow): SourceConfig {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    siteUrl: row.site_url,
    credentials: row.credentials ?? {},
    active: row.active ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateId(kind: SourceKind): string {
  const prefix = kind === "wordpress" ? "wp" : kind === "shopify" ? "shopify" : kind === "cloudarcade" ? "ca" : kind;
  const suffix = randomBytes(4).toString("hex");
  return `${prefix}-${suffix}`;
}

// ── Service-client + per-user scoping helpers ────────────────────────────────────────────────

/** The service-role Supabase client, or a 500 if the key is unset. */
function client(res: Response) {
  const state = getServiceClient();
  if (!state.configured) {
    res.status(500).json({ error: "Supabase service client not configured", reason: state.reason });
    return null;
  }
  return state.client;
}

/** The verified user id, or a 401. Every sources query is scoped to this — never to a
 *  client-presented id. */
function userId(req: Request, res: Response): string | null {
  const id = req.userId;
  if (!id) {
    res.status(401).json({ error: "Unauthorized", reason: "no user id on request" });
    return null;
  }
  return id;
}

/** Load one source row for this user (or null). */
async function loadRow(
  supabase: NonNullable<ReturnType<typeof client>>,
  uid: string,
  id: string,
): Promise<SourceRow | null> {
  const { data, error } = await supabase
    .from("sources")
    .select("*")
    .eq("user_id", uid)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`[sources] load failed: ${error.message}`);
  return (data as SourceRow | null) ?? null;
}

async function persistStatus(
  supabase: NonNullable<ReturnType<typeof client>>,
  uid: string,
  status: SourceStatus,
): Promise<void> {
  const { error } = await supabase
    .from("sources")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("user_id", uid)
    .eq("id", status.sourceId);
  if (error) throw new Error(`[sources] setStatus failed: ${error.message}`);
}

async function persistCapabilities(
  supabase: NonNullable<ReturnType<typeof client>>,
  uid: string,
  caps: SourceCapabilities,
): Promise<void> {
  const { error } = await supabase
    .from("sources")
    .update({ capabilities: caps, updated_at: new Date().toISOString() })
    .eq("user_id", uid)
    .eq("id", caps.sourceId);
  if (error) throw new Error(`[sources] setCapabilities failed: ${error.message}`);
}

// ── WordPress connector (direct Basic Auth) — pure outbound HTTP, portable ────────────────────

const NAMESPACE = "/wp-json/autonomous-seo/v1";
const TIMEOUT_MS = 15_000;

const TUNNEL_UNAVAILABLE =
  "Tunnel-based connection requires the crawler/tunnel service, which is not available in this " +
  "Supabase-only dashboard. Add WordPress credentials (username + application password) to test a " +
  "direct connection instead.";

interface ConnectorStatusResponse {
  plugin?: string;
  version?: string;
  api_version?: string;
  wordpress_version?: string;
  php_version?: string;
  status?: string;
  seo_provider?: string;
  woocommerce?: boolean;
  timestamp?: string;
}

interface ConnectorCapabilitiesResponse {
  wordpress?: boolean;
  wordpress_version?: string;
  pages?: boolean;
  posts?: boolean;
  customPostTypes?: string[];
  media?: boolean;
  woocommerce?: boolean;
  woocommerce_version?: string | null;
  seo_provider?: string;
  capabilities?: Record<string, { read: boolean; write: boolean }>;
  timestamp?: string;
}

function authHeaders(credentials: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.appPassword}`).toString("base64")}`,
  };
  if (credentials.apiKey) headers["X-ASC-API-Key"] = credentials.apiKey;
  return headers;
}

async function connectorRequest(
  siteUrl: string,
  credentials: Record<string, string>,
  reqPath: string,
  method = "GET",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const origin = new URL(siteUrl).origin;
  const headers: Record<string, string> = {
    ...authHeaders(credentials),
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
  };
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(`${origin}${NAMESPACE}${reqPath}`, init);
  const json = (await res.json()) as Record<string, unknown>;

  if (json.success === false && json.error) {
    const err = json.error as Record<string, unknown>;
    throw new Error(`${err.code ?? "connector_error"}: ${err.message ?? "Unknown error"}`);
  }
  if (typeof json.code === "string" && typeof json.message === "string" && json.success === undefined) {
    throw new Error(`${json.code}: ${json.message}`);
  }
  if (json.success !== true) {
    throw new Error(`Unexpected response from connector (${res.status})`);
  }
  const { success: _ok, ...payload } = json;
  return payload;
}

// ── Router ───────────────────────────────────────────────────────────────────────────────────

export const sourcesRouter = Router();

/** GET / — list this user's sources. */
sourcesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { data, error } = await supabase
      .from("sources")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`[sources] list failed: ${error.message}`);
    res.json((data as SourceRow[]).map(rowToConfig));
  }),
);

/** POST / — create a source (generates id, defaults credentials). */
sourcesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const body = (req.body ?? {}) as {
      kind?: unknown;
      name?: unknown;
      siteUrl?: unknown;
      credentials?: unknown;
    };
    const kind = body.kind;
    const name = typeof body.name === "string" ? body.name : "";
    const siteUrl = typeof body.siteUrl === "string" ? body.siteUrl : "";
    const credentials =
      body.credentials && typeof body.credentials === "object"
        ? (body.credentials as Record<string, string>)
        : {};

    if (!kind || !name || !siteUrl) {
      res.status(400).json({ error: "Missing required fields: kind, name, siteUrl" });
      return;
    }
    if (kind !== "wordpress" && kind !== "shopify" && kind !== "cloudarcade") {
      res.status(400).json({ error: `Unsupported source kind: "${String(kind)}". Supported: wordpress, shopify, cloudarcade.` });
      return;
    }
    try {
      new URL(siteUrl);
    } catch {
      res.status(400).json({ error: `"${siteUrl}" is not a valid URL.` });
      return;
    }

    const { data, error } = await supabase
      .from("sources")
      .insert({
        id: generateId(kind),
        user_id: uid, // service role bypasses the auth.uid() default — set it explicitly
        kind,
        name,
        site_url: siteUrl.replace(/\/+$/, ""),
        credentials,
      })
      .select("*")
      .single();
    if (error) throw new Error(`[sources] create failed: ${error.message}`);
    res.status(201).json(rowToConfig(data as SourceRow));
  }),
);

/** POST /resolve — given a page URL, find the connected source with the same origin. Registered
 *  before /:id so "resolve" is never captured as an id. */
sourcesRouter.post(
  "/resolve",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const url = typeof (req.body as { url?: unknown })?.url === "string" ? (req.body as { url: string }).url : "";
    if (!url) {
      res.status(400).json({ error: "Missing required field: url" });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      res.status(400).json({ error: `"${url}" is not a valid URL.` });
      return;
    }

    const { data, error } = await supabase.from("sources").select("*").eq("user_id", uid);
    if (error) throw new Error(`[sources] resolve list failed: ${error.message}`);
    const rows = (data as SourceRow[]).map(rowToConfig);
    const match = rows.find((s) => {
      try {
        return new URL(s.siteUrl).origin === parsed.origin;
      } catch {
        return false;
      }
    });

    if (!match) {
      res.json({
        resolved: false,
        error: `No source connected for ${parsed.origin}. Add a source on the Sources page first.`,
      });
      return;
    }

    const row = await loadRow(supabase, uid, match.id);
    const status = row?.status ?? { sourceId: match.id, state: "unchecked" as const, lastCheckedAt: null };
    res.json({
      resolved: true,
      source: { id: match.id, kind: match.kind, name: match.name, siteUrl: match.siteUrl },
      connection: { state: status.state, lastCheckedAt: status.lastCheckedAt, error: status.error },
    });
  }),
);

/** GET /active — the single source this user has marked active (or null). Registered before /:id so
 *  "active" is never captured as an id. Fix & Apply reads this to decide where to write. */
sourcesRouter.get(
  "/active",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { data, error } = await supabase
      .from("sources")
      .select("*")
      .eq("user_id", uid)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`[sources] active lookup failed: ${error.message}`);
    res.json({ active: data ? rowToConfig(data as SourceRow) : null });
  }),
);

/** POST /:id/activate — mark this source active and every other of this user's sources inactive.
 *  Single-active is enforced here (two UPDATEs), not by a DB constraint. */
sourcesRouter.post(
  "/:id/activate",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { id } = req.params;
    if (!isSafeId(id)) {
      res.status(422).json({ error: "id must be a safe id." });
      return;
    }
    const target = await loadRow(supabase, uid, id);
    if (!target) {
      res.status(404).json({ error: `Source "${id}" not found.` });
      return;
    }

    const now = new Date().toISOString();
    // Clear any currently-active source for this user, then set this one.
    const { error: clearErr } = await supabase
      .from("sources")
      .update({ active: false, updated_at: now })
      .eq("user_id", uid)
      .eq("active", true);
    if (clearErr) throw new Error(`[sources] activate clear failed: ${clearErr.message}`);

    const { error: setErr } = await supabase
      .from("sources")
      .update({ active: true, updated_at: now })
      .eq("user_id", uid)
      .eq("id", id);
    if (setErr) throw new Error(`[sources] activate set failed: ${setErr.message}`);

    const { data, error: listErr } = await supabase
      .from("sources")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: true });
    if (listErr) throw new Error(`[sources] activate relist failed: ${listErr.message}`);
    res.json({ ok: true, sources: (data as SourceRow[]).map(rowToConfig) });
  }),
);

/** GET /:id — one source. */
sourcesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { id } = req.params;
    if (!isSafeId(id)) {
      res.status(422).json({ error: "id must be a safe id." });
      return;
    }
    const row = await loadRow(supabase, uid, id);
    if (!row) {
      res.status(404).json({ error: `Source "${id}" not found.` });
      return;
    }
    res.json(rowToConfig(row));
  }),
);

/** PATCH /:id — update name / siteUrl / credentials. */
sourcesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { id } = req.params;
    if (!isSafeId(id)) {
      res.status(422).json({ error: "id must be a safe id." });
      return;
    }
    const existing = await loadRow(supabase, uid, id);
    if (!existing) {
      res.status(404).json({ error: `Source "${id}" not found.` });
      return;
    }

    const body = (req.body ?? {}) as { name?: unknown; siteUrl?: unknown; credentials?: unknown };
    const name = typeof body.name === "string" ? body.name : existing.name;
    const siteUrl = (typeof body.siteUrl === "string" ? body.siteUrl : existing.site_url).replace(/\/+$/, "");
    const credentials =
      body.credentials && typeof body.credentials === "object"
        ? (body.credentials as Record<string, string>)
        : (existing.credentials ?? {});

    const { data, error } = await supabase
      .from("sources")
      .update({ name, site_url: siteUrl, credentials, updated_at: new Date().toISOString() })
      .eq("user_id", uid)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`[sources] update failed: ${error.message}`);
    if (!data) {
      res.status(404).json({ error: `Source "${id}" not found.` });
      return;
    }
    res.json(rowToConfig(data as SourceRow));
  }),
);

/** DELETE /:id — remove a source. */
sourcesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { id } = req.params;
    if (!isSafeId(id)) {
      res.status(422).json({ error: "id must be a safe id." });
      return;
    }
    const { data, error } = await supabase
      .from("sources")
      .delete()
      .eq("user_id", uid)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(`[sources] delete failed: ${error.message}`);
    if ((data?.length ?? 0) === 0) {
      res.status(404).json({ error: `Source "${id}" not found.` });
      return;
    }
    res.json({ ok: true });
  }),
);

/** POST /:id/connect — health-check a source. Direct Basic Auth probe is fully supported; the
 *  tunnel path (credential-less pairing) needs the crawler/tunnel service and degrades. */
sourcesRouter.post(
  "/:id/connect",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { id } = req.params;
    if (!isSafeId(id)) {
      res.status(422).json({ error: "id must be a safe id." });
      return;
    }
    const row = await loadRow(supabase, uid, id);
    if (!row) {
      res.status(404).json({ error: `Source "${id}" not found.` });
      return;
    }
    const source = rowToConfig(row);

    // ── CloudArcade (ATM Games) — direct MySQL health check ──
    if (source.kind === "cloudarcade") {
      const now = new Date().toISOString();
      const creds = readCloudArcadeCredentials(source.credentials);
      if (!creds) {
        const message = "Missing database credentials (need dbHost, dbName, dbUser).";
        const status: SourceStatus = { sourceId: id, state: "error", lastCheckedAt: now, error: message };
        await persistStatus(supabase, uid, status);
        res.status(400).json({ ok: false, error: message, status });
        return;
      }
      try {
        const counts = await cloudArcadeConnect(creds);
        const status: SourceStatus = {
          sourceId: id,
          state: "connected",
          lastCheckedAt: now,
          meta: { kind: "cloudarcade", database: creds.dbName, ...counts },
        };
        await persistStatus(supabase, uid, status);
        const caps: SourceCapabilities = {
          sourceId: id,
          pages: counts.pages > 0,
          posts: counts.posts > 0,
          media: false,
          fetchedAt: now,
          capabilities: {
            games: { read: true, write: true },
            posts: { read: true, write: true },
            pages: { read: true, write: true },
            categories: { read: true, write: true },
          },
        };
        await persistCapabilities(supabase, uid, caps);
        res.json({ ok: true, status, capabilities: counts });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status: SourceStatus = { sourceId: id, state: "error", lastCheckedAt: now, error: message };
        await persistStatus(supabase, uid, status);
        res.status(502).json({ ok: false, error: message, status });
      }
      return;
    }

    if (source.kind !== "wordpress") {
      res.status(400).json({ error: `Connection testing not yet supported for kind "${source.kind}".` });
      return;
    }

    const now = new Date().toISOString();
    const hasCredentials = source.credentials.username && source.credentials.appPassword;

    // ── Tunnel-based check (no credentials) — poll-based connection via the WordPress plugin ──
    // Instead of an outbound probe, read the paired tunnel_connections row (kept fresh by the
    // plugin's heartbeat) and derive status/capabilities from its site_info. Mirrors the old app's
    // connect tunnel branch (meta.tunnel = true).
    if (!hasCredentials) {
      const { data: connData, error: connErr } = await supabase
        .from("tunnel_connections")
        .select("*")
        .eq("user_id", uid)
        .eq("source_id", id)
        .maybeSingle();
      if (connErr) throw new Error(`[sources] tunnel load failed: ${connErr.message}`);
      const conn = (connData as TunnelConnectionRow | null) ?? null;

      if (!conn) {
        const message = "No tunnel connection found. Install the WordPress plugin and pair it.";
        const status: SourceStatus = { sourceId: id, state: "error", lastCheckedAt: now, error: message };
        await persistStatus(supabase, uid, status);
        res.status(502).json({ ok: false, error: message, status });
        return;
      }

      const lastBeat = conn.last_heartbeat ? new Date(conn.last_heartbeat).getTime() : 0;
      const isStale = Date.now() - lastBeat > 120_000;
      if (isStale && conn.last_heartbeat) {
        const message = `Tunnel connection is stale (last heartbeat: ${conn.last_heartbeat}). The WordPress site may be offline.`;
        const status: SourceStatus = { sourceId: id, state: "error", lastCheckedAt: now, error: message };
        await persistStatus(supabase, uid, status);
        res.status(502).json({ ok: false, error: message, status });
        return;
      }

      const siteInfo = conn.site_info ?? {};
      const status: SourceStatus = {
        sourceId: id,
        state: "connected",
        lastCheckedAt: now,
        meta: {
          plugin: "autonomous-seo-connector",
          version: (siteInfo.pluginVersion as string) ?? "unknown",
          apiVersion: "1",
          wordpressVersion: (siteInfo.wpVersion as string) ?? "unknown",
          phpVersion: (siteInfo.phpVersion as string) ?? "unknown",
          seoProvider: (siteInfo.seoProvider as string) ?? "unknown",
          woocommerce: false,
          connectorTimestamp: conn.last_heartbeat,
          tunnel: true,
        },
      };
      await persistStatus(supabase, uid, status);

      const capsMatrix = (siteInfo.capabilities as Record<string, { read: boolean; write: boolean }>) ?? {};
      const caps: SourceCapabilities = {
        sourceId: id,
        wordpress: true,
        wordpressVersion: (siteInfo.wpVersion as string) ?? "unknown",
        pages: true,
        posts: true,
        media: true,
        woocommerce: false,
        woocommerceVersion: null,
        seoProvider: (siteInfo.seoProvider as string) ?? "unknown",
        capabilities: capsMatrix,
        fetchedAt: now,
      };
      await persistCapabilities(supabase, uid, caps);

      res.json({ ok: true, status, capabilities: capsMatrix });
      return;
    }

    // ── Direct connection check (Basic Auth) — fully ported ──
    try {
      const [statusPayload, capsPayload] = (await Promise.all([
        connectorRequest(source.siteUrl, source.credentials, "/status"),
        connectorRequest(source.siteUrl, source.credentials, "/capabilities"),
      ])) as [ConnectorStatusResponse, ConnectorCapabilitiesResponse];

      const status: SourceStatus = {
        sourceId: id,
        state: "connected",
        lastCheckedAt: now,
        meta: {
          plugin: statusPayload.plugin,
          version: statusPayload.version,
          apiVersion: statusPayload.api_version,
          wordpressVersion: statusPayload.wordpress_version,
          phpVersion: statusPayload.php_version,
          seoProvider: statusPayload.seo_provider,
          woocommerce: statusPayload.woocommerce,
          connectorTimestamp: statusPayload.timestamp,
        },
      };
      await persistStatus(supabase, uid, status);

      const caps: SourceCapabilities = {
        sourceId: id,
        wordpress: capsPayload.wordpress,
        wordpressVersion: capsPayload.wordpress_version,
        pages: capsPayload.pages,
        posts: capsPayload.posts,
        customPostTypes: (capsPayload as Record<string, unknown>).custom_post_types as string[] | undefined,
        media: capsPayload.media,
        woocommerce: capsPayload.woocommerce,
        woocommerceVersion: capsPayload.woocommerce_version,
        seoProvider: capsPayload.seo_provider,
        capabilities: capsPayload.capabilities,
        fetchedAt: now,
      };
      await persistCapabilities(supabase, uid, caps);

      res.json({ ok: true, status, capabilities: capsPayload });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status: SourceStatus = { sourceId: id, state: "error", lastCheckedAt: now, error: message };
      await persistStatus(supabase, uid, status);
      res.status(502).json({ ok: false, error: message, status });
    }
  }),
);

/** GET /:id/seo?type=&id= — read SEO fields for a resource (direct Basic Auth proxy). */
sourcesRouter.get(
  "/:id/seo",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { id } = req.params;
    if (!isSafeId(id)) {
      res.status(422).json({ error: "id must be a safe id." });
      return;
    }
    const row = await loadRow(supabase, uid, id);
    if (!row) {
      res.status(404).json({ error: `Source "${id}" not found.` });
      return;
    }
    const source = rowToConfig(row);
    if (source.kind !== "wordpress") {
      res.status(400).json({ error: `SEO read not yet supported for kind "${source.kind}".` });
      return;
    }
    const hasCredentials = source.credentials.username && source.credentials.appPassword;
    if (!hasCredentials) {
      res.status(501).json({ error: TUNNEL_UNAVAILABLE });
      return;
    }

    const type = typeof req.query.type === "string" ? req.query.type : "";
    const resourceId = typeof req.query.id === "string" ? req.query.id : "";
    if (!type || !resourceId) {
      res.status(400).json({ error: "Missing ?type= and ?id= query parameters." });
      return;
    }
    const numId = Number(resourceId);
    if (!Number.isInteger(numId) || numId <= 0) {
      res.status(400).json({ error: "?id= must be a positive integer." });
      return;
    }

    try {
      const seo = await connectorRequest(source.siteUrl, source.credentials, `/resource/${type}/${numId}/seo`, "GET");
      res.json(seo);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }),
);

/** POST /:id/seo — write SEO / content / media fields (direct Basic Auth proxy). The tunnel-queued
 *  write path (credential-less) needs the crawler/tunnel service and degrades. */
sourcesRouter.post(
  "/:id/seo",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { id } = req.params;
    if (!isSafeId(id)) {
      res.status(422).json({ error: "id must be a safe id." });
      return;
    }
    const row = await loadRow(supabase, uid, id);
    if (!row) {
      res.status(404).json({ error: `Source "${id}" not found.` });
      return;
    }
    const source = rowToConfig(row);

    const body = (req.body ?? {}) as {
      type?: string;
      id?: number;
      url?: string;
      changes?: Record<string, unknown>;
      provider?: string;
      kind?: "seo" | "content" | "media";
    };
    if (!body.changes) {
      res.status(400).json({ error: "Missing required field: changes" });
      return;
    }

    // ── CloudArcade (ATM Games) — direct MySQL write, synchronous (never queued) ──
    if (source.kind === "cloudarcade") {
      const creds = readCloudArcadeCredentials(source.credentials);
      if (!creds) {
        res.status(400).json({ error: "Missing database credentials (need dbHost, dbName, dbUser)." });
        return;
      }
      if (typeof body.url !== "string" || !body.url) {
        res.status(400).json({ error: "CloudArcade writes require the page url." });
        return;
      }
      // Coerce every change value to a string — CloudArcade stores plain text meta fields.
      const changes: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.changes)) {
        if (typeof v === "string") changes[k] = v;
        else if (v != null) changes[k] = String(v);
      }
      try {
        const receipt = await cloudArcadeApply(creds, body.url, changes);
        res.json({
          success: true,
          applied: true,
          queued: false,
          resource: receipt.resource,
          changes: receipt.changes,
        });
      } catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (source.kind !== "wordpress") {
      res.status(400).json({ error: `SEO write not yet supported for kind "${source.kind}".` });
      return;
    }
    const writeKind: "seo" | "content" | "media" =
      body.kind === "content" || body.kind === "media" ? body.kind : "seo";

    const hasCredentials = source.credentials.username && source.credentials.appPassword;

    // ── Tunnel-based write (no credentials) — queue a command the plugin applies on its next poll ──
    if (!hasCredentials) {
      const { data: connData, error: connErr } = await supabase
        .from("tunnel_connections")
        .select("id")
        .eq("user_id", uid)
        .eq("source_id", id)
        .maybeSingle();
      if (connErr) throw new Error(`[sources] tunnel load failed: ${connErr.message}`);
      const conn = (connData as { id: string } | null) ?? null;
      if (!conn) {
        res.status(502).json({ error: "No tunnel connection found. Connect the site via tunnel first." });
        return;
      }

      // Build the target — the plugin resolves URL locally.
      const target: Record<string, unknown> = {};
      if (body.type && body.id) {
        target.type = body.type;
        target.id = body.id;
      } else if (body.url) {
        target.url = body.url;
      } else {
        res.status(400).json({ error: "Provide either (type + id) or url." });
        return;
      }

      const commandId = `cmd_${randomBytes(8).toString("hex")}`;
      const nowIso = new Date().toISOString();
      const { error: insErr } = await supabase.from("tunnel_commands").insert({
        id: commandId,
        user_id: uid,
        site_id: conn.id,
        source_id: id,
        action: writeKind === "content" ? "update_content" : writeKind === "media" ? "update_alt_text" : "update_seo",
        target,
        changes: body.changes,
        provider: body.provider ?? null,
        status: "pending",
        created_at: nowIso,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      if (insErr) throw new Error(`[sources] tunnel command insert failed: ${insErr.message}`);

      res.json({
        success: true,
        queued: true,
        commandId,
        message: "Command queued. The WordPress plugin will apply it on the next poll (up to 10 seconds).",
      });
      return;
    }

    // ── Direct write (Basic Auth) ──
    let resourceType: string;
    let resourceId: number;
    if (body.type && body.id) {
      resourceType = body.type;
      resourceId = body.id;
    } else if (body.url) {
      try {
        const resolved = (await connectorRequest(source.siteUrl, source.credentials, "/resolve-url", "POST", {
          url: body.url,
        })) as { resource: { type: string; id: number } };
        resourceType = resolved.resource.type;
        resourceId = resolved.resource.id;
      } catch (err) {
        res.status(502).json({ error: `Failed to resolve URL: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
    } else {
      res.status(400).json({ error: "Provide either (type + id) or url." });
      return;
    }

    try {
      const payload: Record<string, unknown> = { changes: body.changes };
      if (writeKind === "seo" && body.provider) payload.provider = body.provider;
      const endpoint =
        writeKind === "media"
          ? `/media/${resourceId}`
          : `/resource/${resourceType}/${resourceId}/${writeKind}`;
      const receipt = await connectorRequest(source.siteUrl, source.credentials, endpoint, "POST", payload);
      res.json(receipt);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }),
);
