/**
 * Idempotent: add the `active` column to public.sources (Fix & Apply active-connection selector).
 * Run:  npx tsx scripts/apply-sources-active-migration.mts     (from server/)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDirectPrismaClient } from "../src/db/src/client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, "..", ".env"));
} catch {
  /* already exported */
}

const prisma = createDirectPrismaClient();
try {
  const sql = readFileSync(path.join(here, "sources-active-migration.sql"), "utf8");
  // Strip comment lines FIRST, then split — otherwise a statement preceded by a comment line is
  // dropped whole because the chunk starts with "--".
  const stripped = sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  for (const stmt of stripped.split(";").map((s) => s.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(stmt);
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='sources' ORDER BY ordinal_position",
  );
  console.log("columns:", cols.map((c) => c.column_name).join(", "));
  const hasActive = cols.some((c) => c.column_name === "active");
  console.log(JSON.stringify({ hasActive }, null, 2));
} finally {
  await prisma.$disconnect();
}
