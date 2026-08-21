import path from "node:path";

/**
 * Optional Postgres dual-write adapter — additive, never a replacement for RunStore's flat JSON.
 * OFF by default. Enabled with POSTGRES_SYNC_ENABLED=true (and DATABASE_URL/DIRECT_URL set in
 * packages/db/.env). Any failure here is caught and logged; it can never fail or slow down the
 * flat-JSON write path, which stays the source of truth for this POC.
 *
 * The import below is a runtime-computed path, not a string literal, so `tsc --noEmit` in this
 * package never resolves packages/db's types — zero build-time coupling, no new dependency in
 * this package's package.json. See packages/db/src/index.ts for what's exported.
 */
export async function maybeSyncRunToPostgres(outDir: string, runId: string): Promise<void> {
  if (process.env.POSTGRES_SYNC_ENABLED !== "true") return;

  try {
    const dbModulePath = path.resolve(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "dist", "index.js");
    const dbModuleUrl = new URL(`file:///${dbModulePath.replace(/\\/g, "/")}`).href;
    const db = (await import(dbModuleUrl)) as any;

    db.loadEnv();
    const prisma = db.createPrismaClient("crawler");
    const runDir = path.resolve(outDir, "runs", runId);
    try {
      const result = await db.syncRunToPostgres(prisma, runDir, runId, { allowFindings: true });
      console.log(
        `[postgres-sync] ${runId}: pages=${result.pagesInserted} links=${result.linksInserted} ` +
          `images=${result.imagesInserted} findings=${result.findingsInserted}`,
      );
    } finally {
      await prisma.$disconnect();
    }
  } catch (err) {
    console.error("[postgres-sync] failed — flat JSON is unaffected:", err instanceof Error ? err.message : err);
  }
}
