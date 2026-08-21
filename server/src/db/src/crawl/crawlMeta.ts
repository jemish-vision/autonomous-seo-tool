import type { PrismaClient } from "../../generated/client/index.js";

export interface CrawlMeta {
  label: string | null;
  notes: string | null;
  tags: string[];
}

/**
 * Dashboard run metadata (label / notes / tags) persisted on the Crawl row so an edit made on
 * one machine is visible on every machine. label maps to Crawl.label; notes+tags live under
 * Crawl.notes.dashboard (preserving the existing notes keys like sitemap/orphanCandidates).
 * Null when the run has no crawl row (never synced) — callers fall back to local JSON.
 */
export async function dbReadCrawlMeta(prisma: PrismaClient, runId: string): Promise<CrawlMeta | null> {
  const crawl = await prisma.crawl.findFirst({ where: { slug: runId }, select: { label: true, notes: true } });
  if (!crawl) return null;
  const dashboard = (crawl.notes as Record<string, unknown> | null)?.dashboard as Partial<CrawlMeta> | undefined;
  return {
    label: crawl.label ?? null,
    notes: typeof dashboard?.notes === "string" ? dashboard.notes : null,
    tags: Array.isArray(dashboard?.tags) ? dashboard.tags.filter((t): t is string => typeof t === "string") : [],
  };
}

/** Best-effort — returns false when the run has no crawl row yet (e.g. still crawling). */
export async function dbWriteCrawlMeta(prisma: PrismaClient, runId: string, meta: CrawlMeta): Promise<boolean> {
  const crawl = await prisma.crawl.findFirst({ where: { slug: runId }, select: { id: true, notes: true } });
  if (!crawl) return false;
  const notes = (crawl.notes as Record<string, unknown> | null) ?? {};
  await prisma.crawl.update({
    where: { id: crawl.id },
    data: {
      label: meta.label ?? null,
      notes: { ...notes, dashboard: { notes: meta.notes, tags: meta.tags } },
    },
  });
  return true;
}
