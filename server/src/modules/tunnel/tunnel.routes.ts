/**
 * WordPress tunnel / pairing subsystem — poll-based command queue backed by Supabase.
 *
 * Ported from the old Next.js app's app/api/tunnel/** routes, which used on-disk JSON
 * (pending-pairings.json / tunnel-connections.json / tunnel-commands.json). This app persists to
 * three Supabase tables (see scripts/tunnel-supabase-migration.sql):
 *   public.tunnel_pairings     — a pending pairing code the plugin verifies against
 *   public.tunnel_connections  — a paired site (token stored HASHED; id = plugin siteId)
 *   public.tunnel_commands     — SEO/content/media writes queued for the plugin to poll
 *
 * Transport: the WordPress plugin (autonomous-seo-connector) verifies its code, then heartbeats on a
 * cron poll — each heartbeat drains any pending commands, and it reports each result back. The plugin
 * is the FIXED client; this module matches its contract exactly:
 *   code   = ASC-XXXXXX   token = tnk_...   namespace /wp-json/autonomous-seo/v1
 *   siteId = wp-<md5(home_url())[:8]>
 *
 * Two routers are exported:
 *   tunnelPublicRouter  — plugin-facing (/verify, /heartbeat, /result). NO session; authenticated by
 *                         the secret pairing code or the bearer tunnel token. Mounted BEFORE requireAuth.
 *   tunnelRouter        — dashboard-facing (/pair, /sites). Session-authed like the sources module:
 *                         SERVICE-ROLE Supabase client, every query scoped by user_id = req.userId.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { asyncHandler } from "../../middleware/error.js";
import { getServiceClient } from "../../supabase/service.js";

// ── Shared crypto / id helpers — must mirror the WordPress plugin's contract ───────────────────

const CODE = () => `ASC-${randomBytes(3).toString("hex").toUpperCase()}`;
const TOKEN = () => `tnk_${randomBytes(24).toString("hex")}`;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const siteIdFor = (homeUrl: string) => `wp-${createHash("md5").update(homeUrl).digest("hex").slice(0, 8)}`;
const HEARTBEAT_FRESH_MS = 120_000,
  PAIR_TTL_MS = 3_600_000,
  CMD_TTL_MS = 3_600_000;

// ── Row shapes ─────────────────────────────────────────────────────────────────────────────────

interface PairingRow {
  id: string;
  user_id: string;
  code: string;
  source_id: string | null;
  site_url: string;
  status: string;
  created_at: string;
  expires_at: string;
}

interface ConnectionRow {
  id: string;
  user_id: string;
  source_id: string | null;
  kind: string;
  site_url: string;
  name: string;
  token_hash: string;
  paired_at: string;
  last_heartbeat: string | null;
  status: string;
  site_info: Record<string, unknown>;
  writable_capabilities: unknown;
}

interface CommandRow {
  id: string;
  site_id: string;
  action: string;
  target: Record<string, unknown>;
  changes: Record<string, unknown>;
}

// ── Service-client + per-user scoping helpers (same pattern as sources.routes.ts) ──────────────

/** The service-role Supabase client, or a 500 if the key is unset. */
function client(res: Response) {
  const state = getServiceClient();
  if (!state.configured) {
    res.status(500).json({ error: "Supabase service client not configured", reason: state.reason });
    return null;
  }
  return state.client;
}

/** The verified user id, or a 401. Every dashboard-facing query is scoped to this. */
function userId(req: Request, res: Response): string | null {
  const id = req.userId;
  if (!id) {
    res.status(401).json({ error: "Unauthorized", reason: "no user id on request" });
    return null;
  }
  return id;
}

/** Read the Bearer token from the Authorization header (or null). */
function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice(7);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PUBLIC router — plugin-facing. NO session. Authenticated by the pairing code or the tunnel token.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const tunnelPublicRouter = Router();

/**
 * POST /verify — the WordPress plugin exchanges a pairing code for a tunnel token.
 * Body: { code, siteInfo? }. Matches the plugin's ajax_verify contract.
 */
tunnelPublicRouter.post(
  "/verify",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;

    const body = (req.body ?? {}) as { code?: unknown; siteInfo?: Record<string, unknown> };
    if (!body.code || typeof body.code !== "string") {
      res.status(400).json({ error: "Missing required field: code" });
      return;
    }
    const code = body.code.trim().toUpperCase();

    // Load the pending pairing by code. Service-role read — plugin has no session, we match by the
    // secret code alone (it carries the user_id it was created under).
    const { data: pairingData, error: pairingErr } = await supabase
      .from("tunnel_pairings")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    if (pairingErr) throw new Error(`[tunnel] verify load failed: ${pairingErr.message}`);
    const pairing = (pairingData as PairingRow | null) ?? null;
    if (!pairing) {
      res.status(404).json({ error: "Invalid or expired pairing code." });
      return;
    }

    // Expiry check — mark expired + 410.
    if (new Date(pairing.expires_at).getTime() < Date.now()) {
      await supabase.from("tunnel_pairings").update({ status: "expired" }).eq("id", pairing.id);
      res.status(410).json({ error: "Pairing code has expired. Generate a new one." });
      return;
    }

    const siteInfo = body.siteInfo ?? {};
    const homeUrl = (typeof siteInfo.siteUrl === "string" && siteInfo.siteUrl) || pairing.site_url;
    const siteId = siteIdFor(homeUrl);
    const token = TOKEN();
    let name = homeUrl;
    try {
      name = new URL(homeUrl).hostname;
    } catch {
      /* keep homeUrl as name */
    }

    // Upsert the connection (id = siteId) — re-pairing replaces the old row (new token).
    const nowIso = new Date().toISOString();
    const { error: upsertErr } = await supabase.from("tunnel_connections").upsert(
      {
        id: siteId,
        user_id: pairing.user_id,
        source_id: pairing.source_id,
        kind: "wordpress",
        site_url: homeUrl,
        name,
        token_hash: hashToken(token),
        paired_at: nowIso,
        status: "online",
        site_info: siteInfo,
      },
      { onConflict: "id" },
    );
    if (upsertErr) throw new Error(`[tunnel] verify upsert failed: ${upsertErr.message}`);

    // If the pairing was tied to a source, flip that source to connected + persist capabilities
    // from the tunnel siteInfo (mirrors the old connect tunnel branch; meta.tunnel = true).
    if (pairing.source_id) {
      const caps = (siteInfo.capabilities as Record<string, unknown>) ?? {};
      const status = {
        sourceId: pairing.source_id,
        state: "connected" as const,
        lastCheckedAt: nowIso,
        meta: {
          plugin: "autonomous-seo-connector",
          version: (siteInfo.pluginVersion as string) ?? "unknown",
          apiVersion: "1",
          wordpressVersion: (siteInfo.wpVersion as string) ?? "unknown",
          phpVersion: (siteInfo.phpVersion as string) ?? "unknown",
          seoProvider: (siteInfo.seoProvider as string) ?? "unknown",
          woocommerce: false,
          connectorTimestamp: nowIso,
          tunnel: true,
        },
      };
      const capabilities = {
        sourceId: pairing.source_id,
        wordpress: true,
        wordpressVersion: (siteInfo.wpVersion as string) ?? "unknown",
        pages: true,
        posts: true,
        media: true,
        woocommerce: false,
        woocommerceVersion: null,
        seoProvider: (siteInfo.seoProvider as string) ?? "unknown",
        capabilities: caps as Record<string, { read: boolean; write: boolean }>,
        fetchedAt: nowIso,
      };
      await supabase
        .from("sources")
        .update({ status, capabilities, updated_at: nowIso })
        .eq("user_id", pairing.user_id)
        .eq("id", pairing.source_id);
    }

    // Mark the pairing claimed.
    await supabase.from("tunnel_pairings").update({ status: "claimed" }).eq("id", pairing.id);

    res.json({ success: true, token, siteId, message: "Pairing successful. Store this token securely." });
  }),
);

/**
 * authPlugin — load a connection by siteId and verify the request's Bearer token against its hash.
 * Returns the row, or null after sending a 401 response.
 */
async function authPlugin(
  req: Request,
  res: Response,
  supabase: NonNullable<ReturnType<typeof client>>,
  siteId: string,
): Promise<ConnectionRow | null> {
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: "Missing token" });
    return null;
  }
  const { data, error } = await supabase.from("tunnel_connections").select("*").eq("id", siteId).maybeSingle();
  if (error) throw new Error(`[tunnel] auth load failed: ${error.message}`);
  const conn = (data as ConnectionRow | null) ?? null;
  if (!conn || conn.token_hash !== hashToken(token)) {
    res.status(401).json({ error: "Invalid token" });
    return null;
  }
  return conn;
}

/**
 * POST /heartbeat — the plugin reports presence and drains queued commands.
 * Bearer token + body { siteId, capabilities? }.
 */
tunnelPublicRouter.post(
  "/heartbeat",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;

    const body = (req.body ?? {}) as { siteId?: unknown; capabilities?: unknown };
    if (!body.siteId || typeof body.siteId !== "string") {
      res.status(400).json({ error: "Missing required field: siteId" });
      return;
    }
    const conn = await authPlugin(req, res, supabase, body.siteId);
    if (!conn) return;

    const nowIso = new Date().toISOString();
    const update: Record<string, unknown> = { last_heartbeat: nowIso, status: "online" };
    if (body.capabilities !== undefined) update.writable_capabilities = body.capabilities;
    const { error: updErr } = await supabase.from("tunnel_connections").update(update).eq("id", conn.id);
    if (updErr) throw new Error(`[tunnel] heartbeat update failed: ${updErr.message}`);

    // Pending, unexpired commands for this site.
    const { data: cmdData, error: cmdErr } = await supabase
      .from("tunnel_commands")
      .select("id, site_id, action, target, changes")
      .eq("site_id", conn.id)
      .eq("status", "pending")
      .gt("expires_at", nowIso);
    if (cmdErr) throw new Error(`[tunnel] heartbeat commands failed: ${cmdErr.message}`);
    const commands = (cmdData as CommandRow[] | null) ?? [];

    // Mark them sent so the next poll doesn't re-deliver them.
    if (commands.length > 0) {
      const ids = commands.map((c) => c.id);
      const { error: sentErr } = await supabase
        .from("tunnel_commands")
        .update({ status: "sent", sent_at: nowIso })
        .in("id", ids);
      if (sentErr) throw new Error(`[tunnel] heartbeat mark-sent failed: ${sentErr.message}`);
    }

    res.json({
      success: true,
      commands: commands.map((c) => ({
        commandId: c.id,
        action: c.action,
        target: c.target,
        changes: c.changes,
      })),
    });
  }),
);

/**
 * POST /result — the plugin reports the outcome of a command.
 * Bearer token + body { commandId, siteId, result }.
 */
tunnelPublicRouter.post(
  "/result",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;

    const body = (req.body ?? {}) as {
      commandId?: unknown;
      siteId?: unknown;
      result?: Record<string, unknown>;
    };
    if (!body.commandId || typeof body.commandId !== "string" || !body.siteId || typeof body.siteId !== "string" || !body.result) {
      res.status(400).json({ error: "Missing required fields: commandId, siteId, result" });
      return;
    }
    const conn = await authPlugin(req, res, supabase, body.siteId);
    if (!conn) return;

    const status = body.result.status === "success" ? "completed" : "failed";
    const { error } = await supabase
      .from("tunnel_commands")
      .update({ status, receipt: body.result, completed_at: new Date().toISOString() })
      .eq("id", body.commandId)
      .eq("site_id", conn.id);
    if (error) throw new Error(`[tunnel] result update failed: ${error.message}`);

    res.json({ success: true });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PROTECTED router — dashboard-facing. Session-authed; scoped by user_id = req.userId in code.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const tunnelRouter = Router();

/**
 * POST /pair — the dashboard starts a pairing. Creates (or reuses) a source for this site and a
 * pending pairing code the user pastes into the WordPress plugin.
 * Body: { siteUrl, kind?, name? }.
 */
tunnelRouter.post(
  "/pair",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const body = (req.body ?? {}) as { siteUrl?: unknown; kind?: unknown; name?: unknown };
    if (!body.siteUrl || typeof body.siteUrl !== "string") {
      res.status(400).json({ error: "Missing required field: siteUrl" });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(body.siteUrl);
    } catch {
      res.status(400).json({ error: `"${body.siteUrl}" is not a valid URL.` });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      res.status(400).json({ error: "URL must use http or https protocol." });
      return;
    }
    const origin = parsed.origin;
    const kind = body.kind === "shopify" ? "shopify" : "wordpress";
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : parsed.hostname;

    // Find this user's source with the same origin, else create one (credential-less, tunnel-based).
    const { data: sourcesData, error: sourcesErr } = await supabase.from("sources").select("*").eq("user_id", uid);
    if (sourcesErr) throw new Error(`[tunnel] pair source list failed: ${sourcesErr.message}`);
    const sources = (sourcesData as { id: string; site_url: string }[]) ?? [];
    const existing = sources.find((s) => {
      try {
        return new URL(s.site_url).origin === origin;
      } catch {
        return false;
      }
    });

    let sourceId: string;
    if (existing) {
      sourceId = existing.id;
    } else {
      const newId = `wp-${randomBytes(4).toString("hex")}`;
      const { data: created, error: createErr } = await supabase
        .from("sources")
        .insert({ id: newId, user_id: uid, kind, name, site_url: origin, credentials: {} })
        .select("id")
        .single();
      if (createErr) throw new Error(`[tunnel] pair source create failed: ${createErr.message}`);
      sourceId = (created as { id: string }).id;
    }

    // Drop any prior pending pairing for this user + origin, then insert a fresh one.
    await supabase.from("tunnel_pairings").delete().eq("user_id", uid).eq("site_url", origin).eq("status", "pending");

    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAIR_TTL_MS).toISOString();
    const code = CODE();
    const { error: insErr } = await supabase.from("tunnel_pairings").insert({
      id: `pair_${randomBytes(8).toString("hex")}`,
      user_id: uid,
      code,
      source_id: sourceId,
      site_url: origin,
      status: "pending",
      expires_at: expiresAt,
    });
    if (insErr) throw new Error(`[tunnel] pair insert failed: ${insErr.message}`);

    res.json({
      success: true,
      code,
      siteId: siteIdFor(origin),
      sourceId,
      siteUrl: origin,
      expiresAt,
    });
  }),
);

/**
 * GET /sites — this user's paired sites, with tokens stripped and status recomputed from the last
 * heartbeat freshness.
 */
tunnelRouter.get(
  "/sites",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { data, error } = await supabase
      .from("tunnel_connections")
      .select("*")
      .eq("user_id", uid)
      .order("paired_at", { ascending: true });
    if (error) throw new Error(`[tunnel] sites list failed: ${error.message}`);
    const rows = (data as ConnectionRow[]) ?? [];

    const now = Date.now();
    const sites = rows.map((row) => {
      const { token_hash: _drop, ...rest } = row;
      const lastBeat = row.last_heartbeat ? new Date(row.last_heartbeat).getTime() : 0;
      const status = now - lastBeat > HEARTBEAT_FRESH_MS ? "offline" : "online";
      return { ...rest, status };
    });

    res.json({
      success: true,
      sites,
      total: sites.length,
      online: sites.filter((s) => s.status === "online").length,
      offline: sites.filter((s) => s.status !== "online").length,
    });
  }),
);

/**
 * GET /commands/:id — poll one queued SEO write's outcome. Tunnel writes are fire-and-forget from the
 * dashboard's side (POST /api/sources/:id/seo returns { queued, commandId }); the WordPress plugin
 * applies it on its next poll and reports back a receipt. The Fix & Apply UI polls this to turn a
 * "queued" into a real applied/failed result. Scoped to this user's commands.
 */
tunnelRouter.get(
  "/commands/:id",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { id } = req.params;
    if (typeof id !== "string" || !/^cmd_[a-f0-9]+$/.test(id)) {
      res.status(422).json({ error: "id must be a tunnel command id." });
      return;
    }

    const { data, error } = await supabase
      .from("tunnel_commands")
      .select("id,status,receipt,action,created_at,sent_at,completed_at")
      .eq("user_id", uid)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`[tunnel] command lookup failed: ${error.message}`);
    if (!data) {
      res.status(404).json({ error: `Command "${id}" not found.` });
      return;
    }
    res.json({ success: true, command: data });
  }),
);
