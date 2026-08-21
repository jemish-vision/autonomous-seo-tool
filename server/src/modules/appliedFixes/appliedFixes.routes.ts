/**
 * Applied fixes — the record of which AI recommendations were actually written to the customer's
 * site for a run (old app: applied-fixes.json + lib/data-applied-fixes.ts). Now persisted in
 * Supabase (public.applied_fixes) so an "Applied" badge survives a refresh AND a later Regenerate
 * (which rewrites ai-recommendations wholesale).
 *
 *   GET  /api/crawls/:runId/applied-fixes  -> { runId, fixes: AppliedFix[] }  (this user's records)
 *   POST /api/crawls/:runId/applied-fixes  -> { runId, fix: AppliedFix }      (record one write)
 *
 * Per-user scoping mirrors the sources module: the SERVICE-ROLE client bypasses RLS, so every
 * query is scoped IN CODE by user_id = req.userId (from the verified JWT). The RLS policies in
 * scripts/applied-fixes-migration.sql remain as defense-in-depth.
 *
 * Storage shape: the table breaks out rule_id / page_url / field for indexing, and stashes the full
 * client AppliedFix payload (pageId, instanceKey, changes, sourceId, queued, commandId) in the
 * `detail` JSONB. GET reconstructs the exact AppliedFix shape the client reads
 * (client/src/lib/data-applied-fixes.ts) from `detail` + `applied_at`.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { asyncHandler } from "../../middleware/error.js";
import { getServiceClient } from "../../supabase/service.js";
import { isSafeId } from "../../lib/apiShared.js";

// ── Client contract (mirrors client/src/lib/data-applied-fixes.ts) ────────────────────────────
export interface AppliedFix {
  ruleId: string;
  pageId: string | null;
  instanceKey: string | null;
  url: string | null;
  appliedAt: string;
  changes: Record<string, string>;
  sourceId: string;
  queued: boolean;
  commandId: string | null;
}

/** What the row's `detail` JSONB holds — everything the AppliedFix carries except the timestamp,
 *  which lives in the dedicated `applied_at` column. */
interface AppliedFixDetail {
  pageId: string | null;
  instanceKey: string | null;
  url: string | null;
  changes: Record<string, string>;
  sourceId: string;
  queued: boolean;
  commandId: string | null;
}

interface AppliedFixRow {
  id: string;
  user_id: string;
  crawl_id: string;
  rule_id: string | null;
  page_url: string | null;
  field: string | null;
  detail: AppliedFixDetail | null;
  applied_at: string;
}

function rowToFix(row: AppliedFixRow): AppliedFix {
  const detail = row.detail ?? ({} as Partial<AppliedFixDetail>);
  return {
    ruleId: row.rule_id ?? "",
    pageId: detail.pageId ?? null,
    instanceKey: detail.instanceKey ?? null,
    url: detail.url ?? row.page_url ?? null,
    appliedAt: row.applied_at,
    changes: detail.changes ?? {},
    sourceId: detail.sourceId ?? "",
    queued: detail.queued ?? false,
    commandId: detail.commandId ?? null,
  };
}

// ── Service-client + per-user scoping helpers (same pattern as modules/sources) ───────────────
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

/**
 * Reusable reader — this user's recorded fixes for one run, newest first. Returns [] (never throws)
 * when the service client is unconfigured or there is no user, so callers that only want to enrich
 * a response (e.g. the fix plan's `applied` flag) can degrade gracefully. Exported for fixPlan.
 */
export async function readAppliedFixes(uid: string | undefined, runId: string): Promise<AppliedFix[]> {
  if (!uid) return [];
  const state = getServiceClient();
  if (!state.configured) return [];
  const { data, error } = await state.client
    .from("applied_fixes")
    .select("*")
    .eq("user_id", uid)
    .eq("crawl_id", runId)
    .order("applied_at", { ascending: false });
  if (error) throw new Error(`[applied-fixes] read failed: ${error.message}`);
  return (data as AppliedFixRow[]).map(rowToFix);
}

// ── Router ────────────────────────────────────────────────────────────────────────────────────
export const appliedFixesRouter = Router();

/** GET — every fix this user has recorded for the run. */
appliedFixesRouter.get(
  "/:runId/applied-fixes",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { data, error } = await supabase
      .from("applied_fixes")
      .select("*")
      .eq("user_id", uid)
      .eq("crawl_id", runId)
      .order("applied_at", { ascending: false });
    if (error) throw new Error(`[applied-fixes] list failed: ${error.message}`);
    res.json({ runId, fixes: (data as AppliedFixRow[]).map(rowToFix) });
  }),
);

interface RecordBody {
  ruleId?: unknown;
  pageId?: unknown;
  instanceKey?: unknown;
  url?: unknown;
  changes?: unknown;
  sourceId?: unknown;
  queued?: unknown;
  commandId?: unknown;
}

/** POST — record that a Fix & Apply write succeeded, so the applied state survives refresh + regenerate. */
appliedFixesRouter.post(
  "/:runId/applied-fixes",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const body = (req.body ?? {}) as RecordBody;
    if (typeof body.ruleId !== "string" || body.ruleId.length === 0) {
      res.status(400).json({ error: "Missing required field: ruleId." });
      return;
    }

    const pageId = typeof body.pageId === "string" ? body.pageId : null;
    const instanceKey = typeof body.instanceKey === "string" ? body.instanceKey : null;
    const url = typeof body.url === "string" ? body.url : null;
    const changes =
      body.changes && typeof body.changes === "object" ? (body.changes as Record<string, string>) : {};
    const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
    const queued = Boolean(body.queued);
    const commandId = typeof body.commandId === "string" ? body.commandId : null;

    const detail: AppliedFixDetail = { pageId, instanceKey, url, changes, sourceId, queued, commandId };
    const appliedAt = new Date().toISOString();
    // `field` is a coarse index handle only — the detail JSONB is the source of truth.
    const field = instanceKey ?? Object.keys(changes)[0] ?? null;

    const { data, error } = await supabase
      .from("applied_fixes")
      .insert({
        id: `fix_${randomBytes(8).toString("hex")}`,
        user_id: uid, // service role bypasses the auth.uid() default — set it explicitly
        crawl_id: runId,
        rule_id: body.ruleId,
        page_url: url,
        field,
        detail,
        applied_at: appliedAt,
      })
      .select("*")
      .single();
    if (error) throw new Error(`[applied-fixes] insert failed: ${error.message}`);

    res.status(201).json({ runId, fix: rowToFix(data as AppliedFixRow) });
  }),
);
