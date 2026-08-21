import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase Storage + auth-verification client (SUPABASE_SERVICE_ROLE_KEY).
 * BYPASSES RLS entirely — equivalent to full database ownership (PLAN-02-Data-Model.md §5/§6).
 *
 * Hard boundary: this key must never reach poc/seo-dashboard client code. Two independent guards
 * enforce that rather than relying on discipline alone:
 *   1. assertServerContext() throws immediately if `window` exists (a browser bundle leaked this
 *      module in).
 *   2. This package is never imported by poc/seo-dashboard — it has no npm dependency or
 *      workspace link to @seo-platform/db (see poc/seo-crawler-poc/src/storage/supabaseSync.ts
 *      for how the crawler reaches it instead: a dynamic import of a runtime-computed path, never
 *      a static import Vite could bundle).
 */
function assertServerContext(): void {
  // No DOM lib in this package on purpose (server-only) — checked via globalThis instead of the
  // `window` global so this compiles without pulling browser types into a Node package.
  if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
    throw new Error(
      "SECURITY: supabaseStorage was reached from a browser context. The service-role key bypasses " +
        "RLS entirely and must never be bundled client-side. This code path must be removed, not worked around.",
    );
  }
}

export interface BucketDef {
  name: string;
  /** Default retention in days, per PLAN-02 §5.2 — enforced by the nightly pruning job, not by
   * Supabase itself (Storage has no native lifecycle rules). Null = life of the crawl record. */
  retentionDays: number | null;
}

export const BUCKETS: BucketDef[] = [
  { name: "crawl-artifacts", retentionDays: 30 },
  { name: "screenshots", retentionDays: 90 },
  { name: "site-files", retentionDays: null },
  { name: "exports", retentionDays: 7 },
];

export type ServiceClientState =
  | { configured: true; client: SupabaseClient }
  | { configured: false; client: null; reason: string };

/**
 * Graceful degradation (brief, both original and follow-up): every caller checks `.configured`
 * and renders/logs a "not configured" state rather than throwing when the key is absent — and
 * lights up with zero code change the moment SUPABASE_SERVICE_ROLE_KEY is set.
 */
export function getServiceClient(): ServiceClientState {
  assertServerContext();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { configured: false, client: null, reason: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set" };
  }
  return { configured: true, client: createClient(url, key, { auth: { persistSession: false } }) };
}

export interface BucketEnsureResult {
  name: string;
  status: "created" | "already-existed" | "not-configured";
}

export async function ensureBuckets(): Promise<BucketEnsureResult[]> {
  assertServerContext();
  const state = getServiceClient();
  if (!state.configured) return BUCKETS.map((b) => ({ name: b.name, status: "not-configured" as const }));

  const { data: existing, error: listErr } = await state.client.storage.listBuckets();
  if (listErr) throw new Error(`ensureBuckets: listBuckets failed: ${listErr.message}`);
  const existingNames = new Set((existing ?? []).map((b) => b.name));

  const results: BucketEnsureResult[] = [];
  for (const b of BUCKETS) {
    if (existingNames.has(b.name)) {
      results.push({ name: b.name, status: "already-existed" });
      continue;
    }
    const { error } = await state.client.storage.createBucket(b.name, { public: false });
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`ensureBuckets: createBucket(${b.name}) failed: ${error.message}`);
    }
    results.push({ name: b.name, status: error ? "already-existed" : "created" });
  }
  return results;
}

export interface UploadResult {
  configured: boolean;
  bucket: string;
  path: string;
  bytes: number;
  reason?: string;
}

/** P2: an Artifact row is written only after the upload returns success — caller's job, not this
 * function's (this only performs the object write and reports what actually landed). */
export async function uploadArtifact(
  bucket: string,
  path: string,
  data: Buffer,
  contentType: string,
): Promise<UploadResult> {
  assertServerContext();
  const state = getServiceClient();
  if (!state.configured) return { configured: false, bucket, path, bytes: 0, reason: state.reason };

  const { error } = await state.client.storage.from(bucket).upload(path, data, { contentType, upsert: true });
  if (error) throw new Error(`uploadArtifact(${bucket}/${path}) failed: ${error.message}`);
  return { configured: true, bucket, path, bytes: data.byteLength };
}

export interface SignedUrlResult {
  configured: boolean;
  url: string | null;
  reason?: string;
}

export async function mintSignedUrl(bucket: string, path: string, expiresInSec = 300): Promise<SignedUrlResult> {
  assertServerContext();
  const state = getServiceClient();
  if (!state.configured) return { configured: false, url: null, reason: state.reason };

  const { data, error } = await state.client.storage.from(bucket).createSignedUrl(path, expiresInSec);
  if (error) throw new Error(`mintSignedUrl(${bucket}/${path}) failed: ${error.message}`);
  return { configured: true, url: data.signedUrl };
}

export interface JwtVerifyResult {
  configured: boolean;
  valid: boolean;
  userId?: string;
  reason?: string;
}

/** Server-side JWT verification (§0.5 table: "Express reads a user's identity from a JWT" ->
 * service role, via auth.getUser). Never trust a client-presented projectId — resolve identity
 * from the token, then look up that user's project membership in code (§6.4). */
export async function verifyUserJwt(accessToken: string): Promise<JwtVerifyResult> {
  assertServerContext();
  const state = getServiceClient();
  if (!state.configured) return { configured: false, valid: false, reason: state.reason };

  const { data, error } = await state.client.auth.getUser(accessToken);
  if (error || !data.user) return { configured: true, valid: false, reason: error?.message ?? "no user" };
  return { configured: true, valid: true, userId: data.user.id };
}
