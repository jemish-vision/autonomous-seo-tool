/**
 * One-time / repeatable importer for URL Inspection data.
 *
 * Loads a JSON array of inspection rows (the shape exported by the reference
 * project's `gsc_inspections` table — see the seo-indexing-data.json dump) into
 * Postgres for one (userId, domain), keyed the same way the dashboard reads
 * them. Idempotent: uses createMany skipDuplicates, so re-running only adds
 * rows that aren't there yet; delete first if you want to overwrite.
 *
 * This is what lets the dashboard survive Google's 2,000-inspections-per-day
 * quota: results accumulate in the DB across days, and the Indexing tab shows
 * the whole stored set while the quota meter only counts today's attempts.
 *
 * Usage:
 *   npm run import:gsc-inspections -- <file.json> <userId> <domain>
 */
import { readFile } from "node:fs/promises";
import { loadEnv } from "../env.js";
import { createDirectPrismaClient } from "../client.js";
import type { Prisma } from "../../generated/client/index.js";

interface SourceRow {
  page_url: string;
  verdict: string;
  coverage_state: string | null;
  robots_txt_state: string | null;
  indexing_state: string | null;
  page_fetch_state: string | null;
  google_canonical: string | null;
  user_canonical: string | null;
  last_crawl_time: string | null;
  crawled_as: string | null;
  sitemaps: string | null;
  raw: string | null;
  inspected_at: string;
}

/** The source stores sitemaps as the literal string "NULL" or a JSON array string. */
function parseSitemaps(value: string | null): string[] {
  if (!value || value === "NULL") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** The source stores `raw` as a JSON-encoded string; keep it as an object for JsonB. */
function parseRaw(value: string | null): Record<string, unknown> {
  if (!value || value === "NULL") return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return { _unparsed: value };
  }
}

/** Timestamps arrive as Postgres timestamptz text, or the literal "NULL". */
function parseTimestamp(value: string | null): Date | null {
  if (!value || value === "NULL") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Every inspection must carry an inspected_at (NOT NULL column); fail loudly otherwise. */
function requiredTimestamp(value: string | null, pageUrl: string): Date {
  const d = parseTimestamp(value);
  if (!d) throw new Error(`Missing or invalid inspected_at for ${pageUrl}`);
  return d;
}

const BATCH = 500;

export async function importInspections(
  filePath: string,
  userId: string,
  domain: string,
): Promise<{ total: number; inserted: number }> {
  const rows = JSON.parse(await readFile(filePath, "utf8")) as SourceRow[];
  const prisma = createDirectPrismaClient();
  try {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((r) => ({
        userId,
        domain,
        pageUrl: r.page_url,
        verdict: r.verdict,
        coverageState: r.coverage_state ?? null,
        robotsTxtState: r.robots_txt_state ?? null,
        indexingState: r.indexing_state ?? null,
        pageFetchState: r.page_fetch_state ?? null,
        googleCanonical: r.google_canonical ?? null,
        userCanonical: r.user_canonical ?? null,
        lastCrawlTime: parseTimestamp(r.last_crawl_time),
        crawledAs: r.crawled_as ?? null,
        sitemaps: parseSitemaps(r.sitemaps),
        raw: parseRaw(r.raw) as Prisma.InputJsonValue,
        inspectedAt: requiredTimestamp(r.inspected_at, r.page_url),
      }));
      const res = await prisma.gscInspection.createMany({ data: chunk, skipDuplicates: true });
      inserted += res.count;
    }
    return { total: rows.length, inserted };
  } finally {
    await prisma.$disconnect();
  }
}

