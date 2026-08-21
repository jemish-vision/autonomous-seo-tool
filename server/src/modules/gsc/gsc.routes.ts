/**
 * Google Search Console — the full read + live surface behind the /gsc page.
 *
 * The old Next.js app talked to Google live (OAuth + the Search Console API) and cached the results.
 * The vendored db layer (db/src/gsc/store.ts) replaced that JSON store with Postgres rows of the
 * exact same shape. This module now exposes BOTH:
 *   - the STORED side (connection, linked properties, crawled sites, cached metrics/inspections);
 *   - the LIVE side, ported into modules/gsc/lib/ (OAuth connect/callback, live property listing,
 *     link validation, sync, URL inspection). The date-range layer backfills metrics live so the
 *     dashboard's date picker never lies with stale data.
 *
 *   GET    /api/gsc/status            -> configured? connected? + public connection view
 *   GET    /api/gsc/connect           -> { authUrl } — the Google consent URL (state carries userId)
 *   GET    /api/gsc/callback          -> PUBLIC — Google's redirect; exchanges code, stores tokens
 *   GET    /api/gsc/connection        -> the caller's connection (public view) or null
 *   DELETE /api/gsc/connection        -> revoke the Google grant + drop the stored connection
 *   GET    /api/gsc/sites             -> every crawled domain + its linked property
 *   GET    /api/gsc/properties        -> LIVE listing of the Google account's readable properties
 *   POST   /api/gsc/link              -> validate + link a property to a crawled domain
 *   DELETE /api/gsc/link?domain=      -> unlink
 *   GET    /api/gsc/metrics/:domain   -> metrics bundle (+ live range backfill + range object)
 *   POST   /api/gsc/sync/:domain      -> live Search Analytics pull into storage
 *   POST   /api/gsc/inspect/:domain   -> URL Inspection API, quota-clamped batch
 *   POST   /api/gsc/crawl-reason/:domain -> 501 (needs the crawler worker, not in this service)
 *
 * userId always comes from the verified JWT (req.userId) — never from the URL or body — EXCEPT the
 * public /callback, which recovers the user id from the signed OAuth `state`. Every store call
 * filters by that userId so one user can never read or mutate another's Google data.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import {
  gscReadConnection,
  gscListLinkedDomains,
  gscReadLinkedProperty,
  gscWriteLinkedProperty,
  gscDeleteLinkedProperty,
  gscReadMetrics,
  gscReadInspections,
  type GscLinkedPropertyRow,
} from "../../db/src/gsc/store.js";
import { dbListCrawlRuns } from "../../db/src/crawl/readStore.js";

import {
  buildAuthUrl,
  verifyState,
  exchangeCodeAndStore,
  disconnect,
  GscConnectionExpiredError,
  GscNotConfiguredError,
} from "./lib/oauth.js";
import { listSites as listGoogleSites, canReadData } from "./lib/client.js";
import { listCrawledSites } from "./lib/sites.js";
import { propertyTypeOf, propertyMatchesDomain, domainKey } from "./lib/url.js";
import { resolveRange } from "./lib/dateRange.js";
import { syncPropertyMetrics, ensureRangeData, type CoverageResult } from "./lib/sync.js";
import { getMetricsResponse } from "./lib/metrics.js";
import { inspectPropertyUrls } from "./lib/inspect.js";

export const gscRouter = Router();
/** Callback only — mounted BEFORE requireAuth in app.ts (Google's browser redirect has no JWT). */
export const gscPublicRouter = Router();

/** Whether the server itself has Google OAuth credentials (mirrors the old gscConfig() check). */
function gscConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Lowercased, www/port-stripped domain of a start URL — matches lib/gsc/sites.ts derivation. */
function domainOf(startUrl: string): string | null {
  try {
    return new URL(startUrl).hostname.toLowerCase().replace(/^www\./i, "").replace(/:\d+$/, "");
  } catch {
    return null;
  }
}

/** The verified user id, or a 401. */
function userId(req: Request, res: Response): string | null {
  const id = req.userId;
  if (!id) {
    res.status(401).json({ error: "Unauthorized", reason: "no user id on request" });
    return null;
  }
  return id;
}

/**
 * Maps known Google/OAuth failures to typed responses so the UI can act on them: a dead grant is a
 * 409 ("reconnect"), an unconfigured server is a 503. Anything else is rethrown to the error mw.
 * Returns true when it handled the error.
 */
function handleGscError(err: unknown, res: Response): boolean {
  if (err instanceof GscConnectionExpiredError) {
    res.status(409).json({ error: "connection_expired", message: err.message });
    return true;
  }
  if (err instanceof GscNotConfiguredError) {
    res.status(503).json({ error: "not_configured", message: err.message });
    return true;
  }
  return false;
}

/** Loads the linked property for a URL-segment domain, or writes a 404 and returns null. */
async function resolveLinkedProperty(
  uid: string,
  domainParam: string,
  res: Response,
): Promise<{ domain: string; property: GscLinkedPropertyRow } | null> {
  const domain = domainKey(domainParam);
  const property = await gscReadLinkedProperty(prisma, uid, domain);
  if (!property) {
    res.status(404).json({ error: "not_found", message: "No Search Console property is linked to this site." });
    return null;
  }
  return { domain, property };
}

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------
gscRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    const configured = gscConfigured();
    const connection = req.userId ? await gscReadConnection(prisma, req.userId) : null;
    res.json({
      configured,
      connected: Boolean(connection),
      connection: connection
        ? { id: connection.userId, googleEmail: connection.googleEmail, scopes: connection.scopes, createdAt: connection.createdAt }
        : null,
      setupHint: configured
        ? null
        : "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the server's .env, then restart the API.",
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /connect — the Google consent URL. The user id rides in the signed `state`.
// ---------------------------------------------------------------------------
gscRouter.get(
  "/connect",
  asyncHandler(async (req, res) => {
    const uid = userId(req, res);
    if (!uid) return;
    try {
      const authUrl = buildAuthUrl(uid);
      // `url` alias kept for forward-compat; the client reads `authUrl` (gsc-api.ts:152).
      res.json({ authUrl, url: authUrl });
    } catch (err) {
      if (!handleGscError(err, res)) throw err;
    }
  }),
);

// ---------------------------------------------------------------------------
// GET /callback — PUBLIC. Mounted before requireAuth. Recovers userId from state.
// ---------------------------------------------------------------------------
gscPublicRouter.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const appUrl = env.clientOrigin.replace(/\/+$/, "");
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const error = typeof req.query.error === "string" ? req.query.error : null;

    if (error) {
      res.redirect(`${appUrl}/gsc?gsc=denied`);
      return;
    }

    const uid = verifyState(state);
    if (!uid || !code) {
      res.redirect(`${appUrl}/gsc?gsc=invalid_state`);
      return;
    }

    try {
      await exchangeCodeAndStore(uid, code);
      res.redirect(`${appUrl}/gsc?gsc=connected`);
    } catch (err) {
      console.error("[gsc] callback failed:", err instanceof Error ? err.message : err);
      res.redirect(`${appUrl}/gsc?gsc=failed`);
    }
  }),
);

// ---------------------------------------------------------------------------
// GET/DELETE /connection
// ---------------------------------------------------------------------------
gscRouter.get(
  "/connection",
  asyncHandler(async (req, res) => {
    const connection = req.userId ? await gscReadConnection(prisma, req.userId) : null;
    res.json({
      connection: connection
        ? { id: connection.userId, googleEmail: connection.googleEmail, scopes: connection.scopes, createdAt: connection.createdAt }
        : null,
    });
  }),
);

gscRouter.delete(
  "/connection",
  asyncHandler(async (req, res) => {
    const uid = userId(req, res);
    if (!uid) return;
    // Revoke the Google grant, then drop the local row (disconnect() does both, revoke best-effort).
    await disconnect(uid);
    res.json({ disconnected: true });
  }),
);

// ---------------------------------------------------------------------------
// GET /sites — every crawled domain, annotated with its linked GSC property (if any).
// ---------------------------------------------------------------------------
gscRouter.get(
  "/sites",
  asyncHandler(async (req, res) => {
    const runs = await dbListCrawlRuns(prisma);

    const byDomain = new Map<string, { startUrl: string; lastCrawledAt: string | null; runCount: number }>();
    for (const run of runs) {
      const domain = domainOf(run.startUrl);
      if (!domain) continue;
      const cur = byDomain.get(domain);
      if (cur) {
        cur.runCount += 1;
        if (!cur.lastCrawledAt || run.startedAt > cur.lastCrawledAt) cur.lastCrawledAt = run.startedAt;
      } else {
        byDomain.set(domain, { startUrl: run.startUrl, lastCrawledAt: run.startedAt || null, runCount: 1 });
      }
    }

    const sites = [];
    for (const [domain, v] of byDomain) {
      const prop = req.userId ? await gscReadLinkedProperty(prisma, req.userId, domain) : null;
      sites.push({ domain, startUrl: v.startUrl, runCount: v.runCount, lastCrawledAt: v.lastCrawledAt, linkedSiteUrl: prop?.siteUrl ?? null });
    }
    sites.sort((a, b) => b.lastCrawledAt?.localeCompare(a.lastCrawledAt ?? "") ?? 0);
    res.json({ sites });
  }),
);

// ---------------------------------------------------------------------------
// GET /properties — LIVE listing of every property the connected Google account can read, each
// annotated with the domain it is already linked to and which crawled domains look like a match.
// ---------------------------------------------------------------------------
gscRouter.get(
  "/properties",
  asyncHandler(async (req, res) => {
    const uid = userId(req, res);
    if (!uid) return;

    const connection = await gscReadConnection(prisma, uid);
    if (!connection) {
      res.status(409).json({ error: "not_connected" });
      return;
    }

    try {
      const [sites, linkedDomains, crawledSites] = await Promise.all([
        listGoogleSites(uid),
        gscListLinkedDomains(prisma, uid),
        listCrawledSites(),
      ]);

      const linkedBySiteUrl = new Map<string, string>();
      for (const domain of linkedDomains) {
        const prop = await gscReadLinkedProperty(prisma, uid, domain);
        if (prop) linkedBySiteUrl.set(prop.siteUrl, domain);
      }
      const crawledDomains = crawledSites.map((s) => s.domain);

      const properties = sites.map((s) => ({
        siteUrl: s.siteUrl,
        permissionLevel: s.permissionLevel,
        propertyType: propertyTypeOf(s.siteUrl),
        canReadData: canReadData(s.permissionLevel),
        linkedDomain: linkedBySiteUrl.get(s.siteUrl) ?? null,
        suggestedDomains: crawledDomains.filter((d) => propertyMatchesDomain(s.siteUrl, d)),
      }));

      res.json({ properties, liveListingAvailable: true });
    } catch (err) {
      if (!handleGscError(err, res)) throw err;
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /link { domain, siteUrl } — validate via live listSites, then write the link.
// DELETE /link?domain=... — remove the link.
// ---------------------------------------------------------------------------
gscRouter.post(
  "/link",
  asyncHandler(async (req, res) => {
    const uid = userId(req, res);
    if (!uid) return;

    const body = (req.body ?? {}) as { domain?: unknown; siteUrl?: unknown };
    const rawDomain = body.domain;
    const siteUrl = body.siteUrl;
    if (typeof rawDomain !== "string" || typeof siteUrl !== "string" || !rawDomain.trim() || !siteUrl.trim()) {
      res.status(400).json({ error: "domain and siteUrl are required" });
      return;
    }
    const domain = domainKey(rawDomain);

    const connection = await gscReadConnection(prisma, uid);
    if (!connection) {
      res.status(409).json({ error: "not_connected" });
      return;
    }

    try {
      // Confirm the property is one this Google account can actually read, so a crafted siteUrl
      // cannot create a link that only fails later at sync time.
      const sites = await listGoogleSites(uid);
      const match = sites.find((s) => s.siteUrl === siteUrl);
      if (!match) {
        res.status(404).json({ error: "property_not_found" });
        return;
      }
      if (!canReadData(match.permissionLevel)) {
        res.status(409).json({
          error: "property_unverified",
          message:
            `Google lists "${siteUrl}" for this account but ownership was never verified (${match.permissionLevel}), ` +
            "so it returns no data. Open Search Console, verify the property, then link it again.",
        });
        return;
      }

      const property: GscLinkedPropertyRow = {
        userId: uid,
        domain,
        siteUrl,
        propertyType: propertyTypeOf(siteUrl),
        permissionLevel: match.permissionLevel,
        lastSyncedAt: null,
        createdAt: new Date().toISOString(),
      };
      await gscWriteLinkedProperty(prisma, property);
      res.json({ property });
    } catch (err) {
      if (!handleGscError(err, res)) throw err;
    }
  }),
);

gscRouter.delete(
  "/link",
  asyncHandler(async (req, res) => {
    const uid = userId(req, res);
    if (!uid) return;

    const rawDomain = typeof req.query.domain === "string" ? req.query.domain : "";
    if (!rawDomain) {
      res.status(400).json({ error: "domain is required" });
      return;
    }
    const domain = domainKey(rawDomain);
    const existing = await gscReadLinkedProperty(prisma, uid, domain);
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await gscDeleteLinkedProperty(prisma, uid, domain);
    res.json({ unlinked: true });
  }),
);

// ---------------------------------------------------------------------------
// POST /sync/:domain — live Search Analytics pull into storage.
// ---------------------------------------------------------------------------
gscRouter.post(
  "/sync/:domain",
  asyncHandler(async (req, res) => {
    const uid = userId(req, res);
    if (!uid) return;
    const linked = await resolveLinkedProperty(uid, req.params.domain, res);
    if (!linked) return;

    try {
      const result = await syncPropertyMetrics(uid, linked.domain, linked.property.siteUrl);
      res.json(result);
    } catch (err) {
      if (!handleGscError(err, res)) throw err;
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /inspect/:domain { batchSize? } — URL Inspection API, quota-clamped batch.
// ---------------------------------------------------------------------------
gscRouter.post(
  "/inspect/:domain",
  asyncHandler(async (req, res) => {
    const uid = userId(req, res);
    if (!uid) return;
    const linked = await resolveLinkedProperty(uid, req.params.domain, res);
    if (!linked) return;

    const requested = Number((req.body as { batchSize?: unknown } | undefined)?.batchSize);
    const batchSize = Number.isFinite(requested) ? Math.min(2000, Math.max(1, requested)) : undefined;

    try {
      const result = await inspectPropertyUrls(uid, linked.domain, linked.property.siteUrl, batchSize);
      res.json(result);
    } catch (err) {
      if (!handleGscError(err, res)) throw err;
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /crawl-reason/:domain — queue the crawler for Google-excluded URLs. Needs the crawler
// worker (separate disk-based process), which this Supabase-only service does not run, so it
// answers 501 honestly rather than 404 or faking a spawn (mirrors newCrawl.routes.ts).
// ---------------------------------------------------------------------------
gscRouter.post(
  "/crawl-reason/:domain",
  asyncHandler(async (req, res) => {
    const uid = userId(req, res);
    if (!uid) return;
    const linked = await resolveLinkedProperty(uid, req.params.domain, res);
    if (!linked) return;

    res.status(501).json({
      error: "crawl_unavailable",
      message:
        "Queuing a targeted crawl requires the crawler worker (a separate, disk-based process that " +
        "fetches/renders pages and syncs results to Supabase); this dashboard reads results only. " +
        "Run the excluded URLs through the crawler directly.",
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /metrics/:domain — the metrics bundle, with a bounded LIVE range backfill so the date picker
// never serves stale data, and the `range` object the client hard-requires.
// ---------------------------------------------------------------------------
const RANGE_FETCH_TIMEOUT_MS = 25_000;

gscRouter.get(
  "/metrics/:domain",
  asyncHandler(async (req, res) => {
    const uid = userId(req, res);
    if (!uid) return;
    const linked = await resolveLinkedProperty(uid, req.params.domain, res);
    if (!linked) return;

    const searchType = req.query.type === "image" ? "image" : "web";
    const range = resolveRange(
      typeof req.query.start === "string" ? req.query.start : undefined,
      typeof req.query.end === "string" ? req.query.end : undefined,
    );

    // Pull anything the requested window doesn't already cover. Bounded: on timeout we serve stored
    // data and flag it as possibly partial — the fetch still completes in the background.
    let coverage: CoverageResult;
    try {
      coverage = await Promise.race([
        ensureRangeData(uid, linked.domain, linked.property.siteUrl, range, searchType),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("range fetch exceeded 25s")), RANGE_FETCH_TIMEOUT_MS)),
      ]);
    } catch (err) {
      if (err instanceof GscConnectionExpiredError) {
        res.status(409).json({ error: "connection_expired", message: err.message });
        return;
      }
      console.warn("[gsc] range fetch failed, serving stored data:", err instanceof Error ? err.message : err);
      coverage = { fetched: false, daysFetched: 0, rowsWritten: 0, failed: true };
    }

    // Warm Image Search rows in the background so its toggle is ready without blocking Web Search.
    if (searchType === "web") {
      void ensureRangeData(uid, linked.domain, linked.property.siteUrl, range, "image").catch((err) => {
        console.warn("[gsc] background image sync failed:", err instanceof Error ? err.message : err);
      });
    }

    const response = await getMetricsResponse(
      uid,
      linked.domain,
      linked.property.siteUrl,
      linked.property.propertyType,
      linked.property.lastSyncedAt,
      range,
      searchType,
      coverage,
    );
    res.json(response);
  }),
);
