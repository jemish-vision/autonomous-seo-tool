/**
 * Dataset exports — CSV / JSON / NDJSON downloads of a crawl run's data.
 *
 * Restores the old Next.js app's exports feature (app/api/crawls/[runId]/exports + app/api/exports/*
 * + lib/data-export.ts). Same LOGIC, three ports:
 *
 *   1. DATA source. The old app read the run's pages/issues/failures/sitemap off disk. This app has
 *      no filesystem — it reconstructs the same datasets from Supabase/Postgres via the vendored
 *      read layer (dbGetCrawlPages / dbReadCrawlAnalysis / dbGetCrawlRun), exactly like every other
 *      read module (pages/issues/links).
 *   2. STORAGE. The old app wrote the serialized file to storage/exports/<id>.<ext> on disk and
 *      streamed it back same-origin. This app is serverless-friendly (no local disk): the file is
 *      uploaded to the private Supabase Storage "exports" bucket and handed back as a short-lived
 *      SIGNED URL. Download is a 302 to a fresh signed URL.
 *   3. SCOPING. Service-role Supabase client (bypasses RLS) → every query is scoped by
 *      user_id = req.userId in code (public.exports RLS policies remain as defense-in-depth).
 *
 * Two routers are exported because the base paths differ (mirrors the old route tree):
 *   crawlExportsRouter  ->  mounted at /api/crawls
 *       POST /:runId/exports        { dataset, format }  -> { id, status, url }
 *   exportsRouter       ->  mounted at /api/exports
 *       GET  /?crawlId=             -> ExportSummary[]    (this user's exports)
 *       GET  /:id                   -> ExportMeta + fresh signed url when completed
 *       GET  /:id/download          -> 302 redirect to a fresh signed url (attachment)
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { getServiceClient, uploadArtifact, mintSignedUrl } from "../../supabase/service.js";
import { isSafeId } from "../../lib/apiShared.js";
import { dbGetCrawlPages, dbReadCrawlAnalysis, dbGetCrawlRun } from "../../db/src/crawl/readStore.js";

// ── Types ─────────────────────────────────────────────────────────────────────────────────────

export type ExportDataset = "pages" | "issues" | "links" | "media" | "failures" | "sitemap" | "fix-plan" | "full";
export type ExportFormat = "csv" | "json" | "ndjson";

const DATASETS: ExportDataset[] = ["pages", "issues", "links", "media", "failures", "sitemap", "fix-plan", "full"];
const FORMATS: ExportFormat[] = ["csv", "json", "ndjson"];

const BUCKET = "exports";
const SIGNED_URL_TTL_SEC = 300;

interface ExportRow {
  id: string;
  user_id: string;
  crawl_id: string;
  dataset: ExportDataset;
  format: ExportFormat;
  status: string;
  storage_path: string | null;
  row_count: number | null;
  byte_size: number | null;
  created_at: string;
}

interface ExportMeta {
  id: string;
  crawlId: string;
  dataset: ExportDataset;
  format: ExportFormat;
  status: string;
  rows: number | null;
  bytes: number | null;
  createdAt: string;
}

function rowToMeta(row: ExportRow): ExportMeta {
  return {
    id: row.id,
    crawlId: row.crawl_id,
    dataset: row.dataset,
    format: row.format,
    status: row.status,
    rows: row.row_count,
    bytes: row.byte_size,
    createdAt: row.created_at,
  };
}

// ── Service-client + per-user scoping helpers (same pattern as sources.routes.ts) ──────────────

function client(res: Response) {
  const state = getServiceClient();
  if (!state.configured) {
    res.status(500).json({ error: "Supabase service client not configured", reason: state.reason });
    return null;
  }
  return state.client;
}

function userId(req: Request, res: Response): string | null {
  const id = req.userId;
  if (!id) {
    res.status(401).json({ error: "Unauthorized", reason: "no user id on request" });
    return null;
  }
  return id;
}

// ── Serialization (ported from lib/csv.ts + lib/data-export.ts) ────────────────────────────────

/** Minimal RFC-4180 CSV serializer — no dependency added (verbatim from the old lib/csv.ts). */
function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0 && !columns) return "";
  const cols = columns ?? Object.keys(rows[0]);
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const row of rows) lines.push(cols.map((c) => esc(row[c])).join(","));
  return lines.join("\n");
}

function extFor(format: ExportFormat): string {
  return format === "csv" ? "csv" : format === "ndjson" ? "ndjson" : "json";
}

function contentTypeFor(format: ExportFormat): string {
  return format === "csv" ? "text/csv" : format === "ndjson" ? "application/x-ndjson" : "application/json";
}

function serialize(rows: Record<string, unknown>[], format: ExportFormat): string {
  if (format === "csv") return toCsv(rows);
  if (format === "ndjson") return rows.map((r) => JSON.stringify(r)).join("\n");
  return JSON.stringify(rows, null, 2);
}

// ── Dataset assembly (ports lib/data-export.ts buildRows, but from Postgres, not disk) ─────────

class ExportError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function buildRows(runId: string, dataset: ExportDataset): Promise<Record<string, unknown>[]> {
  if (dataset === "pages") {
    const pages = await dbGetCrawlPages(prisma, runId);
    return pages.map((p) => ({
      pageId: p.pageId,
      url: p.url,
      statusCode: p.statusCode,
      title: p.title,
      metaDescription: p.metaDescription,
      canonical: p.canonical,
      noindex: p.robots.noindex,
      depth: p.crawl.depth,
      wordCount: p.content.wordCount,
      responseTimeMs: p.performance.responseTimeMs,
      renderedWith: p.renderedWith,
    }));
  }
  if (dataset === "issues" || dataset === "fix-plan") {
    const report = await dbReadCrawlAnalysis(prisma, runId);
    if (!report) return [];
    return report.issues.map((i) => ({
      ruleId: i.ruleId,
      category: i.category,
      severity: i.severity,
      scope: i.scope,
      url: i.url,
      pageId: i.pageId,
      message: i.message,
      howToFix: i.howToFix,
    }));
  }
  if (dataset === "links") {
    const pages = await dbGetCrawlPages(prisma, runId);
    const rows: Record<string, unknown>[] = [];
    for (const p of pages)
      for (const l of p.links) rows.push({ sourceUrl: p.url, target: l.target, type: l.type, anchor: l.anchor, nofollow: l.nofollow });
    return rows;
  }
  if (dataset === "media") {
    const pages = await dbGetCrawlPages(prisma, runId);
    const rows: Record<string, unknown>[] = [];
    for (const p of pages)
      for (const img of p.images) rows.push({ pageUrl: p.url, kind: "image", src: img.url, alt: img.alt, width: img.width, height: img.height });
    return rows;
  }
  if (dataset === "failures") {
    const detail = await dbGetCrawlRun(prisma, runId);
    return (detail?.failures ?? []).map((f) => ({ url: f.url, reason: f.reason, statusCode: f.statusCode, attempts: f.attempts, error: f.error }));
  }
  if (dataset === "sitemap") {
    const detail = await dbGetCrawlRun(prisma, runId);
    return (detail?.sitemaps?.entries ?? []).map((e) => ({ url: e.url, sourceSitemap: e.sourceSitemap }));
  }
  return []; // "full" never reaches here — rejected up front
}

// ── Router: POST under /api/crawls ─────────────────────────────────────────────────────────────

export const crawlExportsRouter = Router();

/** POST /:runId/exports { dataset, format } — build + serialize + upload + record, return the id,
 *  status and a fresh signed download url. Computed synchronously (no job queue at this scale),
 *  so status is 'completed' immediately (parity with the old POC). */
crawlExportsRouter.post(
  "/:runId/exports",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }

    const body = (req.body ?? {}) as { dataset?: unknown; format?: unknown };
    const dataset = body.dataset;
    const format = body.format;
    if (!DATASETS.includes(dataset as ExportDataset)) {
      res.status(400).json({ error: `dataset must be one of ${DATASETS.join(", ")}.` });
      return;
    }
    if (!FORMATS.includes(format as ExportFormat)) {
      res.status(400).json({ error: `format must be one of ${FORMATS.join(", ")}.` });
      return;
    }
    if (dataset === "full") {
      res.status(422).json({
        error:
          'dataset "full" is not implemented — export one dataset at a time (pages, issues, links, media, failures, sitemap, fix-plan).',
      });
      return;
    }

    // Validate the run exists (mirrors the old createExport 404 guard).
    const detail = await dbGetCrawlRun(prisma, runId);
    if (!detail) {
      res.status(404).json({ error: `No crawl run found for "${runId}".` });
      return;
    }

    try {
      const rows = await buildRows(runId, dataset as ExportDataset);
      const fmt = format as ExportFormat;
      const content = serialize(rows, fmt);
      const buffer = Buffer.from(content, "utf8");

      const id = randomUUID();
      const storagePath = `${uid}/${id}.${extFor(fmt)}`;

      const upload = await uploadArtifact(BUCKET, storagePath, buffer, contentTypeFor(fmt));
      if (!upload.configured) {
        res.status(500).json({ error: "Supabase Storage not configured", reason: upload.reason });
        return;
      }

      const { error: insertErr } = await supabase.from("exports").insert({
        id,
        user_id: uid, // service role bypasses the auth.uid() default — set it explicitly
        crawl_id: runId,
        dataset,
        format: fmt,
        status: "completed",
        storage_path: storagePath,
        row_count: rows.length,
        byte_size: buffer.byteLength,
      });
      if (insertErr) throw new Error(`[exports] insert failed: ${insertErr.message}`);

      const signed = await mintSignedUrl(BUCKET, storagePath, SIGNED_URL_TTL_SEC);
      res.status(201).json({ id, status: "completed", url: signed.url });
    } catch (err) {
      if (err instanceof ExportError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);

// ── Router: GET under /api/exports ─────────────────────────────────────────────────────────────

export const exportsRouter = Router();

/** GET /?crawlId= — list this user's exports (optionally filtered to one crawl), newest first. */
exportsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const crawlId = typeof req.query.crawlId === "string" ? req.query.crawlId : null;
    let query = supabase.from("exports").select("*").eq("user_id", uid).order("created_at", { ascending: false });
    if (crawlId) query = query.eq("crawl_id", crawlId);

    const { data, error } = await query;
    if (error) throw new Error(`[exports] list failed: ${error.message}`);
    res.json((data as ExportRow[]).map(rowToMeta));
  }),
);

/** GET /:id — export metadata + a fresh signed download url when completed. */
exportsRouter.get(
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

    const { data, error } = await supabase.from("exports").select("*").eq("user_id", uid).eq("id", id).maybeSingle();
    if (error) throw new Error(`[exports] get failed: ${error.message}`);
    if (!data) {
      res.status(404).json({ error: `No export found for id "${id}".` });
      return;
    }
    const row = data as ExportRow;
    let url: string | null = null;
    if (row.status === "completed" && row.storage_path) {
      const signed = await mintSignedUrl(BUCKET, row.storage_path, SIGNED_URL_TTL_SEC);
      url = signed.url;
    }
    res.json({ ...rowToMeta(row), url });
  }),
);

/** GET /:id/download — 302 redirect to a fresh signed url (forced attachment). */
exportsRouter.get(
  "/:id/download",
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

    const { data, error } = await supabase.from("exports").select("*").eq("user_id", uid).eq("id", id).maybeSingle();
    if (error) throw new Error(`[exports] download lookup failed: ${error.message}`);
    if (!data) {
      res.status(404).json({ error: `No export found for id "${id}".` });
      return;
    }
    const row = data as ExportRow;
    if (row.status !== "completed" || !row.storage_path) {
      res.status(409).json({ error: `Export "${id}" is not downloadable (status: ${row.status}).` });
      return;
    }

    const fileName = `${row.crawl_id}-${row.dataset}-${row.id}.${extFor(row.format)}`;
    const signed = await mintSignedUrl(BUCKET, row.storage_path, SIGNED_URL_TTL_SEC);
    if (!signed.url) {
      res.status(500).json({ error: "Supabase Storage not configured", reason: signed.reason });
      return;
    }
    // Supabase honours a ?download=<name> query param to force Content-Disposition: attachment on
    // the object response; also set it on our redirect for clients that respect it.
    const target = `${signed.url}${signed.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(fileName)}`;
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.redirect(302, target);
  }),
);
