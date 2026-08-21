/**
 * Additive, idempotent DDL: add the `aiRecsGeneratedAt` marker column to public.crawls.
 *
 * The AI-recommendations read route distinguishes "never generated" from "generated zero recs"
 * via crawls.aiRecsGeneratedAt (Prisma field `Crawl.aiRecsGeneratedAt @db.Timestamptz(6)`).
 * The project is schema-first (prisma db push), but a full push would reconcile away the
 * raw-SQL tables (sources/exports/comparisons/tunnel_*) that don't live in schema.prisma — so we
 * add just this one nullable column with a targeted ALTER over DIRECT_URL. Safe to re-run.
 *
 * Run:  npx tsx scripts/apply-airecs-column.mts     (from server/)
 */
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
  await prisma.$executeRawUnsafe(
    'ALTER TABLE public.crawls ADD COLUMN IF NOT EXISTS "aiRecsGeneratedAt" timestamptz(6)',
  );
  const cols = await prisma.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='crawls' AND column_name='aiRecsGeneratedAt'",
  );
  console.log(cols.length ? `OK: crawls.aiRecsGeneratedAt present (${cols[0].data_type})` : "FAILED: column not found");
} finally {
  await prisma.$disconnect();
}
