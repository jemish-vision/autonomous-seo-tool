import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../../generated/client/index.js";
import { ensureProjectAndSite } from "../seed.js";
import { mapLegacyPage } from "../mapping/legacyPage.js";
import { runRollups } from "./rollup.js";
import { importFindingsForCrawl } from "../crawl/importIssues.js";

const BATCH_SIZE = 500;

const FAILURE_CLASS_MAP: Record<string, string> = {
  timeout: "TIMEOUT",
  dns: "DNS",
  "http-4xx": "HTTP_4XX",
  "http-5xx": "HTTP_5XX",
  "redirect-loop": "REDIRECT_LOOP",
  "parse-error": "PARSE_ERROR",
  "blocked-robots": "OTHER", // no direct Prisma equivalent — evidence stays in errorMessage
  other: "OTHER",
};

const SKIPPED_REASON_MAP: Record<string, string> = {
  logout: "SAFETY_LOGOUT",
  destructive: "SAFETY_DESTRUCTIVE",
  "user-excluded": "USER_EXCLUDED",
};

const PARSE_STATUS_MAP: Record<string, string> = {
  ok: "LOADED",
  empty: "EMPTY",
  unavailable: "UNREACHABLE",
  error: "MALFORMED",
};

export interface SyncOptions {
  /** Whether issues.json (Finding/Issue/healthScore) may be imported for this run. The importer
   * gates this on a scoring-model-era check (§7.2 of PLAN-02); the live-crawl adapter always
   * passes true since it is syncing the run that was JUST produced by the current code. */
  allowFindings: boolean;
  /** Why findings were refused, if allowFindings is false — surfaced in the result for logging. */
  refusedReason?: string;
  label?: string;
}

export interface SyncResult {
  runId: string;
  crawlId: string;
  projectId: string;
  siteId: string;
  pagesInserted: number;
  linksInserted: number;
  imagesInserted: number;
  mediaInserted: number;
  headingsInserted: number;
  structuredDataInserted: number;
  redirectHopsInserted: number;
  failuresInserted: number;
  blockedInserted: number;
  siteFilesInserted: number;
  sitemapEntriesInserted: number;
  findingsInserted: number;
  issuesInserted: number;
  findingsRefused: boolean;
  refusedReason: string | null;
}

async function readJsonIfExists(file: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Cursor-based: readdir once, then process one page file at a time, flushing a <=500-page buffer
 * per table. Never Promise.all's the file list and never holds the whole run in memory (P4,
 * PLAN-02-Data-Model.md §1) — retained heap stays bounded by BATCH_SIZE regardless of crawl size.
 */
export async function syncRunToPostgres(
  prisma: PrismaClient,
  runDir: string,
  runId: string,
  options: SyncOptions,
): Promise<SyncResult> {
  const report = await readJsonIfExists(path.join(runDir, "report.json"));
  if (!report) throw new Error(`syncRunToPostgres: no report.json in ${runDir} — refusing to guess crawl metadata`);

  const host = new URL(report.startUrl).hostname;
  const { projectId, siteId } = await ensureProjectAndSite(prisma, host, options.label ?? host);

  const configSnapshot = {
    startUrl: report.startUrl,
    discovered: report.discovered,
    allowed: report.allowed,
    blockedByRobots: report.blockedByRobots,
    note: "legacy on-disk report.json snapshot — original CrawlOptions were not persisted by this run",
  };
  const configHash = createHash("sha256").update(JSON.stringify(configSnapshot)).digest("hex");

  const crawl = await prisma.crawl.upsert({
    where: { siteId_slug: { siteId, slug: runId } },
    update: {},
    create: {
      projectId,
      siteId,
      slug: runId,
      startUrl: report.startUrl,
      status: report.finishedAt ? "COMPLETED" : "PARTIAL",
      startedAt: report.startedAt ? new Date(report.startedAt) : null,
      finishedAt: report.finishedAt ? new Date(report.finishedAt) : null,
      durationMs: report.durationMs ?? null,
      config: configSnapshot,
      configHash,
      extractorVersion: "poc-legacy",
      pagesCrawled: report.successful ?? 0,
      pagesDiscovered: report.discovered ?? 0,
      pagesFailed: report.failed ?? 0,
      requestsMade: report.attempted ?? 0,
      maxDepthSeen: report.maxDepthSeen ?? 0,
      coveragePercent: report.coveragePercent ?? null,
      statusHistogram: report.statusHistogram ?? null,
      failuresByClass: report.failuresByClass ?? null,
      notes: { sitemap: report.sitemap ?? null, orphanCandidates: report.orphanCandidates ?? [] },
    },
  });

  const capturedFieldsUnion = new Set<string>();
  const pageKeyToId = new Map<string, string>();

  let pagesInserted = 0,
    linksInserted = 0,
    imagesInserted = 0,
    mediaInserted = 0,
    headingsInserted = 0,
    structuredDataInserted = 0,
    redirectHopsInserted = 0;

  const pagesDir = path.join(runDir, "pages");
  let pageFiles: string[] = [];
  try {
    pageFiles = (await readdir(pagesDir)).filter((f) => f.endsWith(".json"));
  } catch {
    pageFiles = [];
  }

  // Idempotent resume (brief requirement #5): a page already landed for this crawl is skipped
  // rather than reprocessed, so a re-run after a partial failure never tries to insert child rows
  // (links/images/headings) against a Page.id that was silently skipped by skipDuplicates below —
  // that mismatch is a real FK violation, not a cosmetic duplicate.
  const existingPages = await prisma.page.findMany({ where: { crawlId: crawl.id }, select: { id: true, pageKey: true } });
  const alreadyImported = new Set(existingPages.map((p) => p.pageKey));
  
  for (const p of existingPages) {
    pageKeyToId.set(p.pageKey, p.id);
  }

  let pageBuf: any[] = [];
  let contentBuf: any[] = [];
  let linkBuf: any[] = [];
  let imageBuf: any[] = [];
  let mediaBuf: any[] = [];
  let headingBuf: any[] = [];
  let sdBuf: any[] = [];
  let redirectBuf: any[] = [];

  async function flush(): Promise<void> {
    if (pageBuf.length === 0) return;
    await prisma.page.createMany({ data: pageBuf, skipDuplicates: true });
    pagesInserted += pageBuf.length;
    if (contentBuf.length) await prisma.pageContent.createMany({ data: contentBuf, skipDuplicates: true });
    if (linkBuf.length) {
      await prisma.pageLink.createMany({ data: linkBuf });
      linksInserted += linkBuf.length;
    }
    if (imageBuf.length) {
      await prisma.pageImage.createMany({ data: imageBuf });
      imagesInserted += imageBuf.length;
    }
    if (mediaBuf.length) {
      await prisma.pageMedia.createMany({ data: mediaBuf });
      mediaInserted += mediaBuf.length;
    }
    if (headingBuf.length) {
      await prisma.pageHeading.createMany({ data: headingBuf });
      headingsInserted += headingBuf.length;
    }
    if (sdBuf.length) {
      await prisma.structuredDataItem.createMany({ data: sdBuf });
      structuredDataInserted += sdBuf.length;
    }
    if (redirectBuf.length) {
      await prisma.pageRedirectHop.createMany({ data: redirectBuf, skipDuplicates: true });
      redirectHopsInserted += redirectBuf.length;
    }
    pageBuf = [];
    contentBuf = [];
    linkBuf = [];
    imageBuf = [];
    mediaBuf = [];
    headingBuf = [];
    sdBuf = [];
    redirectBuf = [];
  }

  for (const file of pageFiles) {
    const pageKey = file.replace(/\.json$/, "");
    if (alreadyImported.has(pageKey)) continue; // resumed run — this page already landed

    const raw = JSON.parse(await readFile(path.join(pagesDir, file), "utf8"));
    for (const k of Object.keys(raw)) capturedFieldsUnion.add(k);

    const mapped = mapLegacyPage({ raw, pageKey, crawlId: crawl.id, projectId });
    const id = randomUUID();
    pageKeyToId.set(pageKey, id);
    pageBuf.push({ id, ...mapped.page });
    if (mapped.content) contentBuf.push({ ...mapped.content, pageId: id });
    for (const l of mapped.links) linkBuf.push({ ...l, pageId: id });
    for (const im of mapped.images) imageBuf.push({ ...im, pageId: id });
    for (const m of mapped.media) mediaBuf.push({ ...m, pageId: id });
    for (const h of mapped.headings) headingBuf.push({ ...h, pageId: id });
    for (const sd of mapped.structuredData) sdBuf.push({ ...sd, pageId: id });
    for (const r of mapped.redirectHops) redirectBuf.push({ ...r, pageId: id });

    if (pageBuf.length >= BATCH_SIZE) await flush();
  }
  await flush();

  await prisma.crawl.update({
    where: { id: crawl.id },
    data: { capturedFields: [...capturedFieldsUnion] },
  });

  // --- secondary evidence files (small; whole-file reads are fine) ---
  let failuresInserted = 0;
  const failures = await readJsonIfExists(path.join(runDir, "failures.json"));
  if (Array.isArray(failures) && failures.length) {
    await prisma.failure.createMany({
      data: failures.map((f: any) => ({
        crawlId: crawl.id,
        projectId,
        url: f.url,
        normalizedUrl: f.normalizedUrl ?? f.url,
        failureClass: (FAILURE_CLASS_MAP[f.reason] ?? "OTHER") as any,
        statusCode: f.statusCode ?? null,
        attempts: f.attempts ?? 1,
        depth: f.depth ?? null,
        parentUrl: f.parentUrl ?? null,
        errorMessage: f.error ? String(f.error).slice(0, 300) : null,
      })),
      skipDuplicates: true,
    });
    failuresInserted = failures.length;
  }

  let blockedInserted = 0;
  const blocked = await readJsonIfExists(path.join(runDir, "blocked.json"));
  if (Array.isArray(blocked) && blocked.length) {
    await prisma.blockedUrl.createMany({
      data: blocked.map((u: string) => ({
        crawlId: crawl.id,
        projectId,
        url: u,
        normalizedUrl: u,
        reason: "ROBOTS",
      })),
      skipDuplicates: true,
    });
    blockedInserted += blocked.length;
  }

  const skipped = await readJsonIfExists(path.join(runDir, "skipped.json"));
  if (Array.isArray(skipped) && skipped.length) {
    await prisma.blockedUrl.createMany({
      data: skipped.map((s: any) => ({
        crawlId: crawl.id,
        projectId,
        url: s.url,
        normalizedUrl: s.url,
        reason: (SKIPPED_REASON_MAP[s.reason] ?? "USER_EXCLUDED") as any,
        matchedPattern: s.matchedPattern ?? null,
        foundOn: s.foundOn ?? null,
      })),
      skipDuplicates: true,
    });
    blockedInserted += skipped.length;
  }

  let siteFilesInserted = 0;
  const robots = await readJsonIfExists(path.join(runDir, "robots.json"));
  if (robots) {
    await prisma.siteFile.upsert({
      where: { crawlId_kind_url: { crawlId: crawl.id, kind: "ROBOTS_TXT", url: robots.url } },
      update: {},
      create: {
        crawlId: crawl.id,
        projectId,
        kind: "ROBOTS_TXT",
        url: robots.url,
        statusCode: robots.statusCode ?? null,
        bytes: robots.content ? Buffer.byteLength(robots.content) : null,
        parseStatus: (PARSE_STATUS_MAP[robots.parseStatus] as any) ?? "NONE",
        fetchedAt: robots.fetchedAt ? new Date(robots.fetchedAt) : null,
        contentPreview: robots.content ? String(robots.content).slice(0, 20_000) : null,
        truncated: !!robots.content && robots.content.length > 20_000,
        declaredSitemaps: robots.sitemaps ?? [],
      },
    });
    siteFilesInserted++;
  }

  let sitemapEntriesInserted = 0;
  const sitemaps = await readJsonIfExists(path.join(runDir, "sitemaps.json"));
  if (sitemaps?.files?.length) {
    for (const f of sitemaps.files) {
      const sf = await prisma.sitemapFile.upsert({
        where: { crawlId_url: { crawlId: crawl.id, url: f.url } },
        update: {},
        create: {
          crawlId: crawl.id,
          projectId,
          url: f.url,
          statusCode: f.statusCode ?? null,
          urlCount: f.urlCount ?? 0,
          parseStatus: f.statusCode === 200 ? "LOADED" : "NOT_FOUND",
          error: f.error ?? null,
        },
      });
      const entries = (sitemaps.entries ?? []).filter((e: any) => e.sitemapUrl === f.url);
      if (entries.length) {
        await prisma.sitemapEntry.createMany({
          data: entries.map((e: any) => ({
            crawlId: crawl.id,
            projectId,
            sitemapFileId: sf.id,
            loc: e.loc,
            normalizedLoc: e.loc,
            lastmod: e.lastmod ? new Date(e.lastmod) : null,
            changefreq: e.changefreq ?? null,
            priority: e.priority ?? null,
          })),
          skipDuplicates: true,
        });
        sitemapEntriesInserted += entries.length;
      }
    }
  }

  // --- findings/issues, gated by the scoring-model-era check the caller already applied ---
  // Shared implementation with the dashboard's post-analyze sync (crawl/importIssues.ts) so the
  // two paths can never drift; idempotent via the findingsAlreadyImported guard inside it.
  let findingsInserted = 0;
  let issuesInserted = 0;
  if (options.allowFindings) {
    const result = await importFindingsForCrawl(prisma, crawl, runDir, pageKeyToId, pagesInserted || 1);
    findingsInserted = result.findingsInserted;
    issuesInserted = result.issuesInserted;
  }

  await runRollups(prisma, crawl.id);

  return {
    runId,
    crawlId: crawl.id,
    projectId,
    siteId,
    pagesInserted,
    linksInserted,
    imagesInserted,
    mediaInserted,
    headingsInserted,
    structuredDataInserted,
    redirectHopsInserted,
    failuresInserted,
    blockedInserted,
    siteFilesInserted,
    sitemapEntriesInserted,
    findingsInserted,
    issuesInserted,
    findingsRefused: !options.allowFindings,
    refusedReason: options.refusedReason ?? null,
  };
}
