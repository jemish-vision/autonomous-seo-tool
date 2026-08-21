/**
 * Best-effort upload of a locally-saved screenshot to Supabase Storage's "screenshots" bucket.
 * Mirrors src/storage/supabaseSync.ts's dynamic-import pattern exactly: a runtime-computed import
 * path so this package's `tsc --noEmit` never resolves packages/db's types and no npm dependency
 * is added here. Never throws and never fails the crawl — a missing SUPABASE_SERVICE_ROLE_KEY
 * degrades to one visible "not configured" log line per run rather than a silent no-op or a crash.
 *
 * CAUTION verified live during this work: `await import(".../packages/db/dist/index.js")` pulls
 * in `@prisma/client`, which auto-loads `packages/db/.env` into `process.env` as a side effect —
 * so if that file holds real Supabase credentials, they become active the moment this module is
 * imported, REGARDLESS of the current process's own env. That .env file is real in this checkout.
 * Never call this from a test or a local run without knowing that — see supabaseUpload.test.ts,
 * which never performs the real dynamic import for exactly this reason.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";

export interface ArtifactUploadResult {
  configured: boolean;
  bucket?: string;
  path?: string;
  bytes?: number;
  reason?: string;
  error?: string;
}

/** The slice of packages/db's public surface this module needs — deliberately narrow so a test
 * can supply a fake implementation without touching the real dynamic import or real credentials. */
export interface DbModule {
  getServiceClient(): { configured: boolean; client: unknown; reason?: string };
  uploadArtifact(bucket: string, path: string, data: Buffer, contentType: string): Promise<{ bytes: number }>;
}

let warnedNotConfigured = false;
/** Test-only: lets a test observe a fresh "not configured" warning without cross-test bleed. */
export function _resetWarnedNotConfiguredForTests(): void {
  warnedNotConfigured = false;
}

export async function loadDbModule(): Promise<DbModule> {
  const dbModulePath = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "..",
    "packages",
    "db",
    "dist",
    "index.js",
  );
  const dbModuleUrl = new URL(`file:///${dbModulePath.replace(/\\/g, "/")}`).href;
  return (await import(dbModuleUrl)) as DbModule;
}

/**
 * `loader` defaults to the real dynamic import; tests inject a fake `DbModule` so the degrade
 * path is deterministic and never depends on ambient env or real credentials (see the CAUTION
 * above — the real import has a real, live side effect in this checkout).
 */
export async function maybeUploadScreenshot(
  runId: string,
  pageId: string,
  kind: "thumb" | "full",
  absoluteFilePath: string,
  loader: () => Promise<DbModule> = loadDbModule,
): Promise<ArtifactUploadResult> {
  try {
    const db = await loader();
    const state = db.getServiceClient();
    if (!state.configured) {
      if (!warnedNotConfigured) {
        console.log(`[artifacts] Supabase Storage not configured (${state.reason}) — screenshots stay local-only for this run.`);
        warnedNotConfigured = true;
      }
      return { configured: false, reason: state.reason };
    }

    const data = await readFile(absoluteFilePath);
    const objectPath = `${runId}/${pageId}.${kind}.webp`;
    const result = await db.uploadArtifact("screenshots", objectPath, data, "image/webp");
    return { configured: true, bucket: "screenshots", path: objectPath, bytes: result.bytes };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[artifacts] screenshot upload failed for ${pageId}/${kind}: ${message}`);
    return { configured: false, error: message };
  }
}
