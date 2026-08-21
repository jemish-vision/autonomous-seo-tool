import { PrismaClient } from "../generated/client/index.js";

/**
 * Per-process connection_limit, appended onto DATABASE_URL at runtime (not baked into .env)
 * because the same pooler budget is shared by very different callers. Numbers from
 * PLAN-02-Data-Model.md §0.3, assuming a Supabase "Pool Size" of ~15-30: api(10)x1 + crawler(3)x8
 * + rollup(2)x1 + importer(5)x1 = 41 committed, leaving >=40% headroom for Studio/psql/PostgREST.
 * A crawl worker never holds a connection across network I/O (fetch outside the pool, batch-insert
 * inside it) — see PLAN-02 §0.4 — so 3 connections comfortably covers concurrent batch flushes.
 */
export const POOL_PROFILES = {
  api: 10,
  crawler: 3,
  rollup: 2,
  importer: 5,
} as const;

export type PoolProfile = keyof typeof POOL_PROFILES;

function withPoolParams(url: string, connectionLimit: number, poolTimeoutSec = 30): string {
  const u = new URL(url);
  u.searchParams.set("connection_limit", String(connectionLimit));
  u.searchParams.set("pool_timeout", String(poolTimeoutSec));
  if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", "15");
  return u.toString();
}

/**
 * Builds a PrismaClient scoped to a role's pool budget. Runs over DATABASE_URL (6543,
 * transaction pooler) — never DIRECT_URL, which is for migrate/introspection/importer DDL only.
 * pool_timeout=30 (not the 10s default) absorbs a 1000-row createMany occupying a slot briefly;
 * pool_timeout=0 is deliberately never used — that converts a shortage into a silent hang.
 */
export function createPrismaClient(profile: PoolProfile): PrismaClient {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set — see packages/db/.env.example");
  const url = withPoolParams(base, POOL_PROFILES[profile]);
  return new PrismaClient({ datasources: { db: { url } } });
}

/**
 * DIRECT_URL client (5432, session mode) — migrations, introspection, and the one-shot importer.
 * Prepared statements and DDL only work here; never use this for live crawl-worker writes.
 */
export function createDirectPrismaClient(): PrismaClient {
  const base = process.env.DIRECT_URL;
  if (!base) throw new Error("DIRECT_URL is not set — see packages/db/.env.example");
  return new PrismaClient({ datasources: { db: { url: base } } });
}
