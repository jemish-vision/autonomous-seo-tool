/**
 * Idempotent check-and-apply for the public.applied_fixes table (applied-fix history → Supabase).
 *
 *  1. Checks whether public.applied_fixes already exists.
 *  2. If missing, applies scripts/applied-fixes-migration.sql over DIRECT_URL (session mode, the
 *     connection Prisma DDL must use — never the 6543 transaction pooler).
 *  3. Verifies RLS: 4 policies + rowsecurity enabled.
 *
 * Run:  npx tsx scripts/apply-applied-fixes-migration.mts     (from server/)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDirectPrismaClient } from "../src/db/src/client.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Load env the same way the server does (native .env loader), so DIRECT_URL is present.
try {
  process.loadEnvFile(path.resolve(here, "..", ".env"));
} catch {
  /* already exported */
}

/** Split a .sql file into individual statements, honouring $tag$…$tag$ dollar-quoted bodies. */
function splitStatements(sql: string): string[] {
  const stripped = sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const out: string[] = [];
  let buf = "";
  let dollarTag: string | null = null;
  for (let i = 0; i < stripped.length; i++) {
    const rest = stripped.slice(i);
    const tagMatch = rest.match(/^\$[a-zA-Z0-9_]*\$/);
    if (tagMatch) {
      const tag = tagMatch[0];
      if (dollarTag === null) dollarTag = tag;
      else if (dollarTag === tag) dollarTag = null;
      buf += tag;
      i += tag.length - 1;
      continue;
    }
    const ch = stripped[i];
    if (ch === ";" && dollarTag === null) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const prisma = createDirectPrismaClient();

try {
  // 1. Does the table exist?
  const existsRows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'applied_fixes') AS exists",
  );
  const existedBefore = existsRows[0]?.exists === true;
  console.log(existedBefore ? "public.applied_fixes ALREADY EXISTS" : "public.applied_fixes is MISSING — applying migration");

  // 2. Apply (idempotent) if missing. Safe to re-run either way, but we only touch DDL when needed.
  if (!existedBefore) {
    const sql = readFileSync(path.join(here, "applied-fixes-migration.sql"), "utf8");
    for (const stmt of splitStatements(sql)) {
      await prisma.$executeRawUnsafe(stmt);
    }
    console.log("migration applied");
  }

  // 3. Verify RLS (4 policies + rowsecurity on).
  const policyRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    "SELECT count(*)::bigint AS count FROM pg_policies WHERE tablename = 'applied_fixes'",
  );
  const rlsRows = await prisma.$queryRawUnsafe<{ on: boolean }[]>(
    "SELECT relrowsecurity AS on FROM pg_class WHERE relname = 'applied_fixes'",
  );
  const policyCount = Number(policyRows[0]?.count ?? 0);
  const rlsOn = rlsRows[0]?.on === true;
  console.log(`RLS: policies=${policyCount} rowsecurity=${rlsOn}`);

  // 4. Column sanity — confirm the expected shape.
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='applied_fixes' ORDER BY ordinal_position",
  );
  console.log("columns:", cols.map((c) => c.column_name).join(", "));

  console.log(JSON.stringify({ existedBefore, policyCount, rlsOn }, null, 2));
} finally {
  await prisma.$disconnect();
}
