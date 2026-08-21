/**
 * backfill-rich-fields.ts — blocker-A data-fidelity backfill.
 *
 * For every run on disk that ALSO exists in Supabase, recompute the rich page-detail JSONB
 * (headDetail / contentDetail / assetsDetail) via the improved mapping and UPDATE it IN PLACE,
 * plus the child fields the reductive projection dropped (PageMedia.poster/mimeType/providerId,
 * StructuredDataItem.parseError, PageHeading.inMain), then re-run the findings import to enrich
 * Finding/Rule quality (priority/effort/confidence/why/...).
 *
 * Safety (hard requirements):
 *  - IDEMPOTENT — every write is an overwrite with the same recomputed value; re-running is a no-op.
 *  - NEVER deletes a crawl, page, finding, or issue. importFindingsForCrawl takes its non-destructive
 *    enrichment path for already-imported crawls, so no cascade ever reaches AiRecommendation rows.
 *
 * Run:  npx tsx scripts/backfill-rich-fields.ts           (writes)
 *       npx tsx scripts/backfill-rich-fields.ts --dry-run (reports only)
 * Storage root: CRAWLER_STORAGE_DIR env, else the POC default below.
 */
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Prisma } from "../src/db/generated/client/index.js";
import { createPrismaClient } from "../src/db/src/client.js";
import { mapLegacyPage } from "../src/db/src/mapping/legacyPage.js";
import { importFindingsForCrawl } from "../src/db/src/crawl/importIssues.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORAGE = "E:/jemish/seo/autonomous-seo-platform/poc/seo-crawler-poc/storage";

function loadEnv(): void {
  // server/.env holds DATABASE_URL (the createPrismaClient source).
  try {
    (process as { loadEnvFile?: (p: string) => void }).loadEnvFile?.(path.resolve(here, "..", ".env"));
  } catch {
    /* already exported, or absent — createPrismaClient fails loudly if truly missing */
  }
}

async function readJson(file: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** Nullable-Json setter: a JS object is stored as-is; null/undefined clears the column to SQL NULL
 *  ("not captured"), which Prisma requires via DbNull rather than a bare `null`. */
function jsonOrNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

async function main(): Promise<void> {
  loadEnv();
  const storageRoot = process.env.CRAWLER_STORAGE_DIR || DEFAULT_STORAGE;
  const runsDir = path.join(storageRoot, "runs");
  const dryRun = process.argv.includes("--dry-run");

  console.log(`[backfill] storage=${storageRoot}${dryRun ? "  (DRY RUN — no writes)" : ""}`);

  const prisma = createPrismaClient("importer");
  const grand = { runs: 0, skipped: 0, pages: 0, media: 0, sd: 0, headings: 0, findingsInserted: 0, findingsUpdated: 0 };

  try {
    let runIds: string[] = [];
    try {
      runIds = (await readdir(runsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    } catch {
      console.error(`[backfill] cannot read runs dir: ${runsDir}`);
      return;
    }

    for (const runId of runIds) {
      const runDir = path.join(runsDir, runId);
      const crawl = await prisma.crawl.findFirst({
        where: { slug: runId, deletedAt: null },
        select: { id: true, projectId: true, pagesCrawled: true },
      });
      if (!crawl) {
        grand.skipped++;
        continue; // on disk but never synced to Supabase — nothing to backfill
      }

      const pages = await prisma.page.findMany({ where: { crawlId: crawl.id }, select: { id: true, pageKey: true } });
      const pageKeyToId = new Map(pages.map((p) => [p.pageKey, p.id]));

      const pagesDir = path.join(runDir, "pages");
      let pageFiles: string[] = [];
      try {
        pageFiles = (await readdir(pagesDir)).filter((f) => f.endsWith(".json"));
      } catch {
        pageFiles = [];
      }

      let pagesUpdated = 0;
      let mediaUpdated = 0;
      let sdUpdated = 0;
      let headingsUpdated = 0;

      for (const file of pageFiles) {
        const pageKey = file.replace(/\.json$/, "");
        const pageId = pageKeyToId.get(pageKey);
        if (!pageId) continue; // page file exists on disk but wasn't synced

        const raw = await readJson(path.join(pagesDir, file));
        if (!raw) continue;
        const mapped = mapLegacyPage({ raw, pageKey, crawlId: crawl.id, projectId: crawl.projectId });

        if (!dryRun) {
          await prisma.page.update({
            where: { id: pageId },
            data: {
              headDetail: jsonOrNull(mapped.page.headDetail),
              contentDetail: jsonOrNull(mapped.page.contentDetail),
              assetsDetail: jsonOrNull(mapped.page.assetsDetail),
            },
          });
        }
        pagesUpdated++;

        // Child rows: the existing rows were inserted by the same mapping in array order, so id asc
        // (autoincrement = insertion order) aligns 1:1 with the freshly-mapped arrays by index.
        if (mapped.structuredData.length) {
          const rows = await prisma.structuredDataItem.findMany({ where: { pageId }, orderBy: { id: "asc" }, select: { id: true } });
          for (let i = 0; i < rows.length && i < mapped.structuredData.length; i++) {
            const parseError = (mapped.structuredData[i].parseError as string | null) ?? null;
            if (!dryRun) await prisma.structuredDataItem.update({ where: { id: rows[i].id }, data: { parseError } });
            sdUpdated++;
          }
        }

        if (mapped.headings.length) {
          const rows = await prisma.pageHeading.findMany({ where: { pageId }, orderBy: { id: "asc" }, select: { id: true } });
          for (let i = 0; i < rows.length && i < mapped.headings.length; i++) {
            const inMain = !!mapped.headings[i].inMain;
            if (!dryRun) await prisma.pageHeading.update({ where: { id: rows[i].id }, data: { inMain } });
            headingsUpdated++;
          }
        }

        if (mapped.media.length) {
          const rows = await prisma.pageMedia.findMany({ where: { pageId }, orderBy: { id: "asc" }, select: { id: true } });
          for (let i = 0; i < rows.length && i < mapped.media.length; i++) {
            const m = mapped.media[i] as { poster?: unknown; mimeType?: unknown; providerId?: unknown; kind?: unknown };
            if (!dryRun) {
              await prisma.pageMedia.update({
                where: { id: rows[i].id },
                data: {
                  poster: (m.poster as string | null) ?? null,
                  mimeType: (m.mimeType as string | null) ?? null,
                  providerId: (m.providerId as string | null) ?? null,
                  kind: m.kind as any,
                },
              });
            }
            mediaUpdated++;
          }
        }
      }

      // Finding quality — non-destructive enrichment (see importIssues.ts). Skipped in dry-run.
      let fInserted = 0;
      let fUpdated = 0;
      let fSkip: string | null = null;
      if (!dryRun) {
        const r = await importFindingsForCrawl(
          prisma,
          { id: crawl.id, projectId: crawl.projectId },
          runDir,
          pageKeyToId,
          crawl.pagesCrawled || pages.length || 1,
        );
        fInserted = r.findingsInserted;
        fUpdated = r.findingsUpdated;
        fSkip = r.skippedReason;
      }

      console.log(
        `- ${runId}: pages=${pagesUpdated} media=${mediaUpdated} sd=${sdUpdated} headings=${headingsUpdated} ` +
          `findings(+${fInserted}/~${fUpdated})${fSkip ? ` [${fSkip}]` : ""}`,
      );

      grand.runs++;
      grand.pages += pagesUpdated;
      grand.media += mediaUpdated;
      grand.sd += sdUpdated;
      grand.headings += headingsUpdated;
      grand.findingsInserted += fInserted;
      grand.findingsUpdated += fUpdated;
    }

    console.log(
      `\n[backfill] DONE. runsMatched=${grand.runs} runsSkipped(notInDb)=${grand.skipped} ` +
        `pages=${grand.pages} media=${grand.media} sd=${grand.sd} headings=${grand.headings} ` +
        `findingsInserted=${grand.findingsInserted} findingsUpdated=${grand.findingsUpdated}${dryRun ? "  (dry-run)" : ""}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exit(1);
});
