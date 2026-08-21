/**
 * Read-side companion to sync/syncRun.ts: reverse-maps the relational crawl data back into the
 * exact shapes the dashboard's JSON files use (report.json, pages/*.json, issues.json, ...).
 *
 * Why this exists: crawl data is written to Postgres on the machine that ran the crawl, but the
 * dashboard's read layer (poc/seo-dashboard/lib/data.ts + lib/data-issues.ts) reads flat JSON
 * files on the local disk. A dashboard on another machine has no JSON — only the shared DB — so
 * it needs these rows reconstructed into the same shapes. The mapping is best-effort: the DB is a
 * faithful projection of the JSON (see mapping/legacyPage.ts), so everything the UI renders from
 * the core page/report/issues records round-trips; deep optional detail (headMeta, favicons,
 * screenshots, ...) is not persisted and comes back absent, exactly like runs crawled before those
 * extractors shipped.
 *
 * Every returned object is JSON-safe: Date -> ISO string, BigInt avoided, enums -> the lowercase
 * strings the dashboard's own types use. Callers in the dashboard cast these to its types.
 */
import type { Prisma, PrismaClient } from "../../generated/client/index.js";

// ---------------------------------------------------------------------------
// Shapes (dashboard-compatible, declared here so this package stays decoupled)
// ---------------------------------------------------------------------------

export interface CrawlRunListItem {
  runId: string;
  startUrl: string;
  startedAt: string;
  finishedAt: string;
  attempted: number;
  successful: number;
  failed: number;
  blockedByRobots: number;
  coveragePercent: number;
  maxDepthSeen: number | null;
  state?: "completed" | "cancelled";
  analyzed?: boolean;
  healthScore?: number | null;
}

export interface CrawlReportRow {
  runId: string;
  startUrl: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  discovered: number;
  unique: number;
  allowed: number;
  blockedByRobots: number;
  attempted: number;
  successful: number;
  failed: number;
  redirects: number;
  statusHistogram: Record<string, number>;
  jsRendered: number;
  internalLinks: number;
  externalLinks: number;
  orphanCandidates: string[];
  coveragePercent: number;
  maxDepthSeen?: number;
  sitemap: {
    urlsInSitemap: number;
    inSitemapNotCrawled: string[];
    crawledNotInSitemap: string[];
    sitemapEntriesFailed: string[];
  };
  failuresByClass: Record<string, number>;
}

export interface RobotsEvidenceRow {
  url: string;
  statusCode: number | null;
  content: string | null;
  sitemaps: string[];
  parseStatus: "ok" | "empty" | "unavailable" | "error";
  fetchedAt: string;
}

export interface SitemapResultRow {
  entries: { url: string; sourceSitemap: string }[];
  files: { url: string; statusCode: number | null; kind: "urlset" | "index" | "unknown"; urlCount: number; error: string | null }[];
  errors: string[];
}

export interface FailureRow {
  url: string;
  normalizedUrl: string | null;
  reason: string;
  statusCode: number | null;
  attempts: number;
  error: string | null;
  depth: number | null;
  parentUrl: string | null;
}

export interface SkippedUrlRow {
  url: string;
  reason: "logout" | "destructive" | "user-excluded";
  matchedPattern: string;
  foundOn: string | null;
}

export interface CrawlRunDetailRow {
  report: CrawlReportRow | null;
  robots: RobotsEvidenceRow | null;
  sitemaps: SitemapResultRow | null;
  blocked: string[];
  failures: FailureRow[];
}

export interface CrawledPageRow {
  pageId: string;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robots: { meta: string[]; noindex: boolean; nofollow: boolean };
  headings: { h1: string[]; h2: string[]; h3: string[] };
  links: {
    source: string;
    target: string;
    targetNormalized: string | null;
    anchor: string;
    type: "internal" | "external";
    rel: string | null;
    nofollow: boolean;
    sponsored: boolean;
    ugc: boolean;
    targetAttr: string | null;
  }[];
  images: { url: string; alt: string | null; width: number | null; height: number | null; format: string | null }[];
  videos: { url: string; kind: "file" | "youtube" | "vimeo" | "iframe"; poster: string | null; mimeType: string | null; providerId: string | null }[];
  structuredData: { type: "application/ld+json"; raw: string; parsed: unknown | null; parseError: string | null }[];
  content: { text: string; wordCount: number; contentHash: string };
  runId: string;
  url: string;
  normalizedUrl: string;
  finalUrl: string | null;
  statusCode: number | null;
  redirectChain: { from: string; to: string | null; statusCode: number }[];
  headers: Record<string, string>;
  performance: { responseTimeMs: number | null };
  renderedWith: "http" | "playwright";
  renderSignals: string[];
  fetchedAt: string;
  crawl: { depth: number; parentUrl: string | null; discoverySources: string[] };
  // --- rich page-detail (blocker-A fidelity) — reconstructed from the Page JSONB detail columns
  // written by mapping/legacyPage.ts. `undefined` means the extractor never produced it (the UI
  // renders "Not captured"); typed loosely here to keep this package decoupled from the dashboard's
  // exact interfaces (their shapes round-trip verbatim through JSONB). See CrawledPage optional set.
  headMeta?: unknown;
  favicons?: unknown;
  structure?: unknown;
  fonts?: unknown;
  charset?: unknown;
  headBoundary?: unknown;
  baseHref?: unknown;
}

export interface AnalysisIssueRow {
  ruleId: string;
  category: string;
  severity: "error" | "warning" | "notice";
  scope: "page" | "site";
  url: string | null;
  pageId: string | null;
  message: string;
  howToFix: string;
  evidence: unknown[];
  threshold?: string;
}

export interface AnalysisFindingRow {
  ruleId: string;
  category: string;
  scope: "page" | "site";
  severity: "error" | "warning" | "notice";
  status: "failing" | "passed" | "skipped-data-unavailable" | "errored" | "muted";
  affectedPages: number;
  affectedInstances: number;
  evaluatedPages: number;
  reach: number | null;
  importance: number | null;
  confidence: number | null;
  priority: number;
  priorityFactors: unknown;
  damage: number | null;
  effort: "low" | "medium" | "high";
  effortWhy: string;
  automation: "auto-safe" | "auto-with-review" | "human-only";
  detectionTier: "observed" | "derived" | "heuristic";
  automationReviewed: boolean;
  why: string;
  howToFix: string;
  sampleUrls: string[];
  skipReason: string | null;
  errorNote: string | null;
  mutedAt: string | null;
  mutedNote: string | null;
}

export interface AnalysisReportRow {
  runId: string;
  generatedAt: string;
  rulebookVersion: string | null;
  configSnapshot: unknown;
  healthScore: number;
  pagesAnalyzed: number;
  counts: { error: number; warning: number; notice: number };
  rulesRun: number;
  rulesSkippedDataUnavailable: string[];
  issues: AnalysisIssueRow[];
  findings?: AnalysisFindingRow[];
  categories?: { name: string; categoryKey: string; weight: number; score: number }[];
  worstPages?: { pageId: string; url: string; harm: number; issueCount: number; topRuleIds: string[] }[];
  mutedRuleIds?: string[];
}

// ---------------------------------------------------------------------------
// Enum -> dashboard-lowercase maps
// ---------------------------------------------------------------------------

function severityToLower(sev: string): "error" | "warning" | "notice" {
  if (sev === "WARNING") return "warning";
  if (sev === "NOTICE") return "notice";
  return "error"; // CRITICAL + ERROR both render as error
}

function failureClassToLower(cls: string): string {
  const map: Record<string, string> = {
    TIMEOUT: "timeout",
    DNS: "dns",
    HTTP_4XX: "http-4xx",
    HTTP_5XX: "http-5xx",
    REDIRECT_LOOP: "redirect-loop",
    PARSE_ERROR: "parse-error",
    TLS: "other",
    CONN_REFUSED: "other",
    CONN_RESET: "other",
    RATE_LIMITED: "other",
    NON_HTML: "other",
  };
  return map[cls] ?? "other";
}

function blockedReasonToLower(reason: string): "logout" | "destructive" | "user-excluded" {
  if (reason === "SAFETY_LOGOUT") return "logout";
  if (reason === "SAFETY_DESTRUCTIVE") return "destructive";
  return "user-excluded";
}

function mediaKindToLower(kind: string): "file" | "youtube" | "vimeo" | "iframe" {
  if (kind === "YOUTUBE") return "youtube";
  if (kind === "VIMEO") return "vimeo";
  if (kind === "IFRAME") return "iframe";
  return "file"; // VIDEO/AUDIO/EMBED/OBJECT/FILE all degrade to the generic video kind
}

function findingStatusToLower(status: string): AnalysisFindingRow["status"] {
  const map: Record<string, AnalysisFindingRow["status"]> = {
    FAILING: "failing",
    PASSED: "passed",
    SKIPPED_DATA_UNAVAILABLE: "skipped-data-unavailable",
    ERRORED: "errored",
    MUTED: "muted",
  };
  return map[status] ?? "failing";
}

function effortToLower(e: string): "low" | "medium" | "high" {
  if (e === "LOW") return "low";
  if (e === "HIGH") return "high";
  return "medium";
}

function automationToLower(a: string): "auto-safe" | "auto-with-review" | "human-only" {
  if (a === "AUTO_SAFE") return "auto-safe";
  if (a === "AUTO_WITH_REVIEW") return "auto-with-review";
  return "human-only";
}

function detectionTierToLower(t: string): "observed" | "derived" | "heuristic" {
  if (t === "DERIVED") return "derived";
  if (t === "HEURISTIC") return "heuristic";
  return "observed";
}

function iso(d: Date | null | undefined): string {
  return d ? d.toISOString() : new Date(0).toISOString();
}

function isoNullable(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ---------------------------------------------------------------------------
// Pure mappers (exported for unit tests — no DB required)
// ---------------------------------------------------------------------------

export function mapCrawlToRunItem(row: {
  slug: string;
  startUrl: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  requestsMade: number;
  pagesCrawled: number;
  pagesFailed: number;
  pagesBlocked: number;
  coveragePercent: number | null;
  maxDepthSeen: number;
  status: string;
  healthScore: number | null;
}): CrawlRunListItem {
  return {
    runId: row.slug,
    startUrl: row.startUrl,
    startedAt: iso(row.startedAt ?? row.createdAt),
    finishedAt: iso(row.finishedAt ?? row.updatedAt),
    attempted: row.requestsMade,
    successful: row.pagesCrawled,
    failed: row.pagesFailed,
    blockedByRobots: row.pagesBlocked,
    coveragePercent: row.coveragePercent ?? 0,
    maxDepthSeen: row.maxDepthSeen,
    state: row.status === "CANCELLED" ? "cancelled" : "completed",
    // healthScore is only written when issues.json was imported, so its presence is the
    // "analyzed" flag — exactly what hasIssues() means on the JSON side.
    analyzed: row.healthScore !== null,
    healthScore: row.healthScore,
  };
}

/** Catches a JSON-serialised "NULL" string (the reference importer wrote some) and normalises. */
function safeNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function mapCrawlToReport(
  row: {
    slug: string;
    startUrl: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    durationMs: number | null;
    pagesDiscovered: number;
    pagesCrawled: number;
    pagesFailed: number;
    pagesBlocked: number;
    pagesRendered: number;
    requestsMade: number;
    maxDepthSeen: number;
    coveragePercent: number | null;
    statusHistogram: unknown;
    failuresByClass: unknown;
    notes: unknown;
  },
  extras: { internalLinks: number; externalLinks: number; redirects: number },
): CrawlReportRow {
  const notes = (row.notes ?? {}) as { sitemap?: unknown; orphanCandidates?: string[] };
  const sitemapRaw = (notes.sitemap ?? {}) as Record<string, unknown>;
  const failuresByClass = (row.failuresByClass ?? {}) as Record<string, number>;
  return {
    runId: row.slug,
    startUrl: row.startUrl,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    durationMs: row.durationMs ?? 0,
    discovered: row.pagesDiscovered,
    // `unique`/`allowed` aren't persisted as their own columns — closest faithful values.
    unique: row.pagesCrawled,
    allowed: row.pagesDiscovered,
    blockedByRobots: row.pagesBlocked,
    attempted: row.requestsMade,
    successful: row.pagesCrawled,
    failed: row.pagesFailed,
    redirects: extras.redirects,
    statusHistogram: (row.statusHistogram ?? {}) as Record<string, number>,
    jsRendered: row.pagesRendered,
    internalLinks: extras.internalLinks,
    externalLinks: extras.externalLinks,
    orphanCandidates: notes.orphanCandidates ?? [],
    coveragePercent: row.coveragePercent ?? 0,
    maxDepthSeen: row.maxDepthSeen,
    sitemap: {
      urlsInSitemap: safeNumber(sitemapRaw.urlsInSitemap),
      inSitemapNotCrawled: Array.isArray(sitemapRaw.inSitemapNotCrawled) ? sitemapRaw.inSitemapNotCrawled.map(String) : [],
      crawledNotInSitemap: Array.isArray(sitemapRaw.crawledNotInSitemap) ? sitemapRaw.crawledNotInSitemap.map(String) : [],
      sitemapEntriesFailed: Array.isArray(sitemapRaw.sitemapEntriesFailed) ? sitemapRaw.sitemapEntriesFailed.map(String) : [],
    },
    failuresByClass,
  };
}

export function mapFailureRow(row: {
  url: string;
  normalizedUrl: string | null;
  failureClass: string;
  statusCode: number | null;
  attempts: number;
  errorMessage: string | null;
  depth: number | null;
  parentUrl: string | null;
}): FailureRow {
  return {
    url: row.url,
    normalizedUrl: row.normalizedUrl,
    reason: failureClassToLower(row.failureClass),
    statusCode: row.statusCode,
    attempts: row.attempts,
    error: row.errorMessage,
    depth: row.depth,
    parentUrl: row.parentUrl,
  };
}

export function mapPageRow(
  runId: string,
  row: {
    pageKey: string;
    url: string;
    normalizedUrl: string;
    finalUrl: string | null;
    statusCode: number | null;
    depth: number;
    fetchedAt: Date;
    responseTimeMs: number | null;
    parentUrl: string | null;
    discoverySources: string[];
    canonical: string | null;
    noindex: boolean;
    nofollow: boolean;
    robotsDirectives: string[];
    title: string | null;
    metaDescription: string | null;
    wordCount: number | null;
    contentHash: string | null;
    httpDetail: unknown;
    headDetail?: unknown;
    contentDetail?: unknown;
    assetsDetail?: unknown;
    renderedWith: string;
    renderSignals: string[];
  },
  children: {
    text?: string;
    links?: { targetUrl: string; targetNormalized: string | null; anchor: string | null; scope: string; rel: string | null; nofollow: boolean; sponsored: boolean; ugc: boolean; targetAttr: string | null }[];
    images?: { url: string | null; alt: string | null; declaredWidth: number | null; declaredHeight: number | null; format: string | null }[];
    videos?: { url: string; kind: string; poster: string | null; mimeType: string | null; providerId: string | null }[];
    headings?: { level: number; text: string }[];
    structuredData?: { raw: string | null; parsed: unknown; parseError: string | null }[];
    redirectChain?: { fromUrl: string; toUrl: string | null; statusCode: number }[];
  },
): CrawledPageRow {
  const httpDetail = (row.httpDetail ?? {}) as { headers?: Record<string, string>; performance?: { responseTimeMs?: number | null } };
  // Rich detail reconstruction (blocker-A): reverse of mapping/legacyPage.ts's JSONB writes.
  const headDetail = (row.headDetail ?? {}) as { headMeta?: unknown; headBoundary?: unknown; charset?: unknown; baseHref?: unknown; favicons?: unknown };
  const contentDetail = (row.contentDetail ?? {}) as { structure?: unknown };
  const assetsDetail = (row.assetsDetail ?? {}) as { fonts?: unknown };
  const h1: string[] = [];
  const h2: string[] = [];
  const h3: string[] = [];
  for (const h of children.headings ?? []) {
    if (h.level === 1) h1.push(h.text);
    else if (h.level === 2) h2.push(h.text);
    else if (h.level === 3) h3.push(h.text);
  }
  return {
    pageId: row.pageKey,
    title: row.title,
    metaDescription: row.metaDescription,
    canonical: row.canonical,
    robots: { meta: row.robotsDirectives, noindex: row.noindex, nofollow: row.nofollow },
    headings: { h1, h2, h3 },
    links: (children.links ?? []).map((l) => ({
      source: row.url,
      target: l.targetUrl,
      targetNormalized: l.targetNormalized,
      anchor: l.anchor ?? "",
      type: l.scope === "EXTERNAL" ? "external" : "internal",
      rel: l.rel,
      nofollow: l.nofollow,
      sponsored: l.sponsored,
      ugc: l.ugc,
      targetAttr: l.targetAttr,
    })),
    images: (children.images ?? []).map((im) => ({
      url: im.url ?? "",
      alt: im.alt,
      width: im.declaredWidth,
      height: im.declaredHeight,
      format: im.format,
    })),
    videos: (children.videos ?? []).map((v) => ({
      url: v.url,
      kind: mediaKindToLower(v.kind),
      poster: v.poster,
      mimeType: v.mimeType,
      providerId: v.providerId,
    })),
    structuredData: (children.structuredData ?? []).map((sd) => ({
      type: "application/ld+json",
      raw: sd.raw ?? "",
      parsed: sd.parsed ?? null,
      parseError: sd.parseError,
    })),
    content: {
      text: children.text ?? "",
      wordCount: row.wordCount ?? 0,
      contentHash: row.contentHash ?? "",
    },
    runId,
    url: row.url,
    normalizedUrl: row.normalizedUrl,
    finalUrl: row.finalUrl,
    statusCode: row.statusCode,
    redirectChain: (children.redirectChain ?? []).map((r) => ({ from: r.fromUrl, to: r.toUrl, statusCode: r.statusCode })),
    headers: httpDetail.headers ?? {},
    performance: { responseTimeMs: row.responseTimeMs ?? httpDetail.performance?.responseTimeMs ?? null },
    renderedWith: row.renderedWith === "BROWSER" ? "playwright" : "http",
    renderSignals: row.renderSignals,
    fetchedAt: iso(row.fetchedAt),
    crawl: { depth: row.depth, parentUrl: row.parentUrl, discoverySources: row.discoverySources },
    // Rich page-detail — only surfaced when actually captured; absent keys serialize away, so the
    // dashboard sees `undefined` ("Not captured") for runs whose extractor produced nothing.
    headMeta: headDetail.headMeta,
    favicons: headDetail.favicons,
    charset: headDetail.charset,
    headBoundary: headDetail.headBoundary,
    baseHref: headDetail.baseHref,
    structure: contentDetail.structure,
    fonts: assetsDetail.fonts,
  };
}

// ---------------------------------------------------------------------------
// DB-backed reads
// ---------------------------------------------------------------------------

async function findCrawl(prisma: PrismaClient, runId: string): Promise<Prisma.CrawlGetPayload<{}> | null> {
  return prisma.crawl.findFirst({ where: { slug: runId, deletedAt: null } });
}

export async function dbCrawlExists(prisma: PrismaClient, runId: string): Promise<boolean> {
  return (await findCrawl(prisma, runId)) !== null;
}

export async function dbListCrawlRuns(prisma: PrismaClient): Promise<CrawlRunListItem[]> {
  const rows = await prisma.crawl.findMany({
    where: { deletedAt: null },
    orderBy: { startedAt: "desc" },
    select: {
      slug: true,
      startUrl: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      updatedAt: true,
      requestsMade: true,
      pagesCrawled: true,
      pagesFailed: true,
      pagesBlocked: true,
      coveragePercent: true,
      maxDepthSeen: true,
      status: true,
      healthScore: true,
    },
  });
  return rows.map(mapCrawlToRunItem);
}

export async function dbGetCrawlRun(prisma: PrismaClient, runId: string): Promise<CrawlRunDetailRow | null> {
  const crawl = await findCrawl(prisma, runId);
  if (!crawl) return null;

  const [linkCounts, redirectAgg, robots, sitemapFiles, blocked, failures] = await Promise.all([
    prisma.pageLink.groupBy({ by: ["scope"], where: { crawlId: crawl.id }, _count: { _all: true } }),
    prisma.page.aggregate({ where: { crawlId: crawl.id }, _sum: { redirectHops: true } }),
    prisma.siteFile.findFirst({ where: { crawlId: crawl.id, kind: "ROBOTS_TXT" } }),
    prisma.sitemapFile.findMany({ where: { crawlId: crawl.id }, include: { entries: true } }),
    prisma.blockedUrl.findMany({ where: { crawlId: crawl.id, reason: "ROBOTS" }, select: { url: true } }),
    prisma.failure.findMany({ where: { crawlId: crawl.id } }),
  ]);

  let internalLinks = 0;
  let externalLinks = 0;
  for (const row of linkCounts) {
    if (row.scope === "INTERNAL") internalLinks = row._count._all;
    else if (row.scope === "EXTERNAL") externalLinks = row._count._all;
  }

  const report = mapCrawlToReport(crawl, {
    internalLinks,
    externalLinks,
    redirects: redirectAgg._sum.redirectHops ?? 0,
  });

  let robotsRow: RobotsEvidenceRow | null = null;
  if (robots) {
    const parseStatus = robots.parseStatus === "LOADED" ? "ok" : robots.parseStatus === "EMPTY" ? "empty" : robots.parseStatus === "UNREACHABLE" ? "unavailable" : "error";
    robotsRow = {
      url: robots.url,
      statusCode: robots.statusCode,
      content: robots.contentPreview,
      sitemaps: robots.declaredSitemaps,
      parseStatus,
      fetchedAt: iso(robots.fetchedAt),
    };
  }

  let sitemapsRow: SitemapResultRow | null = null;
  if (sitemapFiles.length > 0) {
    sitemapsRow = {
      entries: sitemapFiles.flatMap((f) => f.entries.map((e) => ({ url: e.loc, sourceSitemap: f.url }))),
      files: sitemapFiles.map((f) => ({
        url: f.url,
        statusCode: f.statusCode,
        // SitemapFile has no kind column; the dashboard treats unknown as a plain urlset.
        kind: "unknown" as const,
        urlCount: f.urlCount,
        error: f.error,
      })),
      errors: sitemapFiles.map((f) => f.error).filter((e): e is string => !!e),
    };
  }

  return {
    report,
    robots: robotsRow,
    sitemaps: sitemapsRow,
    blocked: blocked.map((b) => b.url),
    failures: failures.map(mapFailureRow),
  };
}

export async function dbReadCrawlSkipped(prisma: PrismaClient, runId: string): Promise<SkippedUrlRow[]> {
  const crawl = await findCrawl(prisma, runId);
  if (!crawl) return [];
  const rows = await prisma.blockedUrl.findMany({
    where: { crawlId: crawl.id, reason: { in: ["SAFETY_LOGOUT", "SAFETY_DESTRUCTIVE", "USER_EXCLUDED"] } },
  });
  return rows.map((r) => ({
    url: r.url,
    reason: blockedReasonToLower(r.reason),
    matchedPattern: r.matchedPattern ?? "",
    foundOn: r.foundOn,
  }));
}

const PAGE_SELECT = {
  id: true,
  pageKey: true,
  url: true,
  normalizedUrl: true,
  finalUrl: true,
  statusCode: true,
  depth: true,
  fetchedAt: true,
  responseTimeMs: true,
  parentUrl: true,
  discoverySources: true,
  canonical: true,
  noindex: true,
  nofollow: true,
  robotsDirectives: true,
  title: true,
  metaDescription: true,
  wordCount: true,
  contentHash: true,
  httpDetail: true,
  headDetail: true,
  contentDetail: true,
  assetsDetail: true,
  renderedWith: true,
  renderSignals: true,
} as const;

interface PageChildBundles {
  textByPage: Map<string, string>;
  linksByPage: Map<string, PageChildrenLinks[]>;
  imagesByPage: Map<string, PageChildrenImages[]>;
  videosByPage: Map<string, PageChildrenVideos[]>;
  headingsByPage: Map<string, { level: number; text: string }[]>;
  sdByPage: Map<string, { raw: string | null; parsed: unknown; parseError: string | null }[]>;
  hopsByPage: Map<string, { fromUrl: string; toUrl: string | null; statusCode: number }[]>;
}

type PageChildrenLinks = {
  targetUrl: string;
  targetNormalized: string | null;
  anchor: string | null;
  scope: string;
  rel: string | null;
  nofollow: boolean;
  sponsored: boolean;
  ugc: boolean;
  targetAttr: string | null;
};

type PageChildrenImages = {
  url: string | null;
  alt: string | null;
  declaredWidth: number | null;
  declaredHeight: number | null;
  format: string | null;
};

type PageChildrenVideos = {
  url: string;
  kind: string;
  poster: string | null;
  mimeType: string | null;
  providerId: string | null;
};

async function loadPageChildren(prisma: PrismaClient, crawlId: string): Promise<PageChildBundles> {
  const [contents, links, images, videos, headings, sds, hops] = await Promise.all([
    prisma.pageContent.findMany({ where: { crawlId }, select: { pageId: true, text: true } }),
    prisma.pageLink.findMany({
      where: { crawlId },
      select: { pageId: true, targetUrl: true, targetNormalized: true, anchor: true, scope: true, rel: true, nofollow: true, sponsored: true, ugc: true, targetAttr: true },
      orderBy: { position: "asc" },
    }),
    prisma.pageImage.findMany({
      where: { crawlId },
      select: { pageId: true, url: true, alt: true, declaredWidth: true, declaredHeight: true, format: true },
      orderBy: { position: "asc" },
    }),
    prisma.pageMedia.findMany({
      where: { crawlId },
      select: { pageId: true, kind: true, url: true, poster: true, mimeType: true, providerId: true },
      orderBy: { position: "asc" },
    }),
    prisma.pageHeading.findMany({ where: { crawlId }, select: { pageId: true, level: true, text: true }, orderBy: { position: "asc" } }),
    prisma.structuredDataItem.findMany({ where: { crawlId }, select: { pageId: true, raw: true, parsed: true, parseError: true }, orderBy: { position: "asc" } }),
    prisma.pageRedirectHop.findMany({ where: { crawlId }, select: { pageId: true, fromUrl: true, toUrl: true, statusCode: true }, orderBy: { hopIndex: "asc" } }),
  ]);

  const textByPage = new Map<string, string>();
  const linksByPage = new Map<string, PageChildrenLinks[]>();
  const imagesByPage = new Map<string, PageChildrenImages[]>();
  const videosByPage = new Map<string, PageChildrenVideos[]>();
  const headingsByPage = new Map<string, { level: number; text: string }[]>();
  const sdByPage = new Map<string, { raw: string | null; parsed: unknown; parseError: string | null }[]>();
  const hopsByPage = new Map<string, { fromUrl: string; toUrl: string | null; statusCode: number }[]>();

  const push = <T,>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  for (const c of contents) textByPage.set(c.pageId, c.text);
  for (const l of links) push(linksByPage, l.pageId, l);
  for (const im of images) push(imagesByPage, im.pageId, im);
  for (const v of videos) push(videosByPage, v.pageId, v);
  for (const h of headings) push(headingsByPage, h.pageId, { level: h.level, text: h.text });
  for (const sd of sds) push(sdByPage, sd.pageId, { raw: sd.raw, parsed: sd.parsed, parseError: sd.parseError });
  for (const r of hops) push(hopsByPage, r.pageId, { fromUrl: r.fromUrl, toUrl: r.toUrl, statusCode: r.statusCode });

  return { textByPage, linksByPage, imagesByPage, videosByPage, headingsByPage, sdByPage, hopsByPage };
}

export async function dbGetCrawlPages(prisma: PrismaClient, runId: string): Promise<CrawledPageRow[]> {
  const crawl = await findCrawl(prisma, runId);
  if (!crawl) return [];
  const [pages, children] = await Promise.all([prisma.page.findMany({ where: { crawlId: crawl.id }, select: PAGE_SELECT }), loadPageChildren(prisma, crawl.id)]);
  return pages.map((p) =>
    mapPageRow(crawl.slug, p as Prisma.PageGetPayload<{ select: typeof PAGE_SELECT }>, {
      text: children.textByPage.get(p.id),
      links: children.linksByPage.get(p.id),
      images: children.imagesByPage.get(p.id),
      videos: children.videosByPage.get(p.id),
      headings: children.headingsByPage.get(p.id),
      structuredData: children.sdByPage.get(p.id),
      redirectChain: children.hopsByPage.get(p.id),
    }),
  );
}

export async function dbGetCrawlPage(prisma: PrismaClient, runId: string, pageKey: string): Promise<CrawledPageRow | null> {
  const crawl = await findCrawl(prisma, runId);
  if (!crawl) return null;
  const page = await prisma.page.findUnique({ where: { crawlId_pageKey: { crawlId: crawl.id, pageKey } }, select: PAGE_SELECT });
  if (!page) return null;
  const children = await loadPageChildren(prisma, crawl.id);
  return mapPageRow(crawl.slug, page as Prisma.PageGetPayload<{ select: typeof PAGE_SELECT }>, {
    text: children.textByPage.get(page.id),
    links: children.linksByPage.get(page.id),
    images: children.imagesByPage.get(page.id),
    videos: children.videosByPage.get(page.id),
    headings: children.headingsByPage.get(page.id),
    structuredData: children.sdByPage.get(page.id),
    redirectChain: children.hopsByPage.get(page.id),
  });
}

// ---------------------------------------------------------------------------
// Analysis report (issues.json) reconstruction
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT: Record<string, number> = { CRITICAL: 1, ERROR: 0.8, WARNING: 0.5, NOTICE: 0.2 };
const CATEGORY_WEIGHT: Record<string, number> = {
  indexability: 30,
  content: 25,
  links: 15,
  media: 15,
  performance: 15,
};

/** Category scores aren't persisted (they're derived at analysis time); rebuild a faithful
 *  approximation from the stored findings: 100 minus severity × reach deductions per category. */
function deriveCategories(findings: AnalysisFindingRow[]): { name: string; categoryKey: string; weight: number; score: number }[] {
  const byCategory = new Map<string, AnalysisFindingRow[]>();
  for (const f of findings) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }
  const order = ["indexability", "content", "links", "media", "performance"];
  return [...byCategory.entries()]
    .map(([category, list]) => {
      let deduction = 0;
      for (const f of list) {
        if (f.status !== "failing") continue;
        const weight = SEVERITY_WEIGHT[f.severity] ?? 0.5;
        const reach = Math.min(1, f.reach ?? (f.evaluatedPages > 0 ? f.affectedInstances / f.evaluatedPages : 0));
        deduction += weight * reach * 60;
      }
      return {
        name: category.charAt(0).toUpperCase() + category.slice(1),
        categoryKey: category,
        weight: CATEGORY_WEIGHT[category] ?? 15,
        score: Math.max(0, Math.round(100 - deduction)),
      };
    })
    .sort((a, b) => (order.indexOf(a.categoryKey) - order.indexOf(b.categoryKey)) || 0);
}

export async function dbReadCrawlAnalysis(prisma: PrismaClient, runId: string): Promise<AnalysisReportRow | null> {
  const crawl = await findCrawl(prisma, runId);
  if (!crawl) return null;

  const [findings, issues, mutes, pages] = await Promise.all([
    prisma.finding.findMany({ where: { crawlId: crawl.id }, include: { rule: true }, orderBy: { priority: "desc" } }),
    prisma.issue.findMany({ where: { crawlId: crawl.id }, orderBy: { priority: "desc" } }),
    prisma.ruleMute.findMany({ where: { siteId: crawl.siteId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { ruleSlug: true } }),
    prisma.page.findMany({ where: { crawlId: crawl.id }, select: { id: true, pageKey: true, url: true } }),
  ]);

  if (findings.length === 0 && issues.length === 0) return null;

  const pageByUuid = new Map(pages.map((p) => [p.id, p]));

  const issuesMapped: AnalysisIssueRow[] = issues.map((issue) => {
    const page = issue.pageId ? pageByUuid.get(issue.pageId) : undefined;
    const finding = issue.findingId ? findings.find((f) => f.id === issue.findingId) : undefined;
    const rule = finding?.rule;
    // Per-issue threshold has no dedicated column; importIssues stashes it in the otherwise-unused
    // proposedFix JSONB as { threshold }. Read it back defensively.
    const proposed = (issue.proposedFix ?? null) as { threshold?: unknown } | null;
    const threshold = typeof proposed?.threshold === "string" ? proposed.threshold : undefined;
    return {
      ruleId: issue.ruleSlug,
      category: issue.category,
      severity: severityToLower(issue.severity),
      // Real scope carried from the parent finding (was hardcoded to "page").
      scope: finding?.scope === "SITE" ? "site" : "page",
      url: page?.url ?? null,
      pageId: page?.pageKey ?? null,
      message: issue.message,
      howToFix: rule?.howToFix ?? "",
      evidence: (issue.evidence as unknown[]) ?? [],
      ...(threshold !== undefined ? { threshold } : {}),
    };
  });

  const findingsMapped: AnalysisFindingRow[] = findings.map((f) => ({
    ruleId: f.ruleSlug,
    category: f.category,
    scope: f.scope === "SITE" ? "site" : "page",
    severity: severityToLower(f.severity),
    status: findingStatusToLower(f.status),
    affectedPages: f.affectedPages,
    affectedInstances: f.affectedInstances,
    evaluatedPages: f.evaluatedPages,
    reach: f.reach,
    importance: f.importance,
    confidence: f.confidence,
    priority: f.priority,
    priorityFactors: f.priorityFactors ?? null,
    damage: f.damage,
    effort: effortToLower(f.effort),
    effortWhy: f.effortWhy ?? "",
    automation: automationToLower(f.automation),
    detectionTier: detectionTierToLower(f.rule?.detectionTier ?? "OBSERVED"),
    automationReviewed: false,
    why: f.rule?.why ?? "",
    howToFix: f.rule?.howToFix ?? "",
    sampleUrls: f.sampleUrls,
    skipReason: f.skipReason,
    errorNote: null,
    mutedAt: isoNullable(f.mutedAt),
    mutedNote: f.mutedNote,
  }));

  const issueCountByPage = new Map<string, { count: number; rules: Set<string> }>();
  for (const issue of issues) {
    if (!issue.pageId) continue;
    const entry = issueCountByPage.get(issue.pageId) ?? { count: 0, rules: new Set<string>() };
    entry.count++;
    entry.rules.add(issue.ruleSlug);
    issueCountByPage.set(issue.pageId, entry);
  }
  const worstPages = [...issueCountByPage.entries()]
    .map(([uuid, { count, rules }]) => {
      const page = pageByUuid.get(uuid);
      return { pageId: page?.pageKey ?? uuid, url: page?.url ?? "", harm: count, issueCount: count, topRuleIds: [...rules].slice(0, 5) };
    })
    .sort((a, b) => b.issueCount - a.issueCount)
    .slice(0, 10);

  return {
    runId: crawl.slug,
    generatedAt: iso(crawl.updatedAt),
    rulebookVersion: crawl.rulebookVersion,
    configSnapshot: crawl.config,
    healthScore: crawl.healthScore ?? 0,
    pagesAnalyzed: crawl.pagesCrawled,
    counts: { error: crawl.errorCount, warning: crawl.warningCount, notice: crawl.noticeCount },
    rulesRun: findings.length,
    rulesSkippedDataUnavailable: findings.filter((f) => f.status === "SKIPPED_DATA_UNAVAILABLE").map((f) => f.ruleSlug),
    issues: issuesMapped,
    findings: findingsMapped,
    // Rebuilt category scores (was computed but never returned).
    categories: deriveCategories(findingsMapped),
    worstPages,
    mutedRuleIds: mutes.map((m) => m.ruleSlug),
  };
}

/**
 * Per-rule issue counts for the nearest EARLIER *analyzed* crawl of the SAME site — the "previous
 * run" the issues page diffs against in its "Since the last crawl" view. Mirrors the old dashboard's
 * readHealthHistory walk (poc app/issues/page.tsx): take the same-site runs newest-first, step past
 * the current one, and use the first that was actually analyzed (healthScore set = issues imported;
 * un-analyzed crawls have no rule counts to compare and are skipped, exactly like the old ruleCounts
 * !== null guard). Returns a { [ruleId]: issueCount } map, or null when there is no earlier analyzed
 * run — in which case the UI keeps its unchanged "no earlier crawl to compare" state.
 *
 * Reads only shared crawl-data tables (Crawl/Issue), scoped by siteId — the same tables the /issues
 * route reads; those carry no userId column (RLS + the mounted requireAuth guard the surface).
 */
export async function dbReadPreviousRuleCounts(prisma: PrismaClient, runId: string): Promise<Record<string, number> | null> {
  const crawl = await findCrawl(prisma, runId);
  if (!crawl) return null;

  const sameSite = await prisma.crawl.findMany({
    where: { siteId: crawl.siteId, deletedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true, slug: true, healthScore: true },
  });
  const idx = sameSite.findIndex((c) => c.slug === runId);
  if (idx < 0) return null;

  let previousCrawlId: string | null = null;
  for (let i = idx + 1; i < sameSite.length; i++) {
    if (sameSite[i].healthScore !== null) {
      previousCrawlId = sameSite[i].id;
      break;
    }
  }
  if (!previousCrawlId) return null;

  const grouped = await prisma.issue.groupBy({
    by: ["ruleSlug"],
    where: { crawlId: previousCrawlId },
    _count: { _all: true },
  });
  if (grouped.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.ruleSlug] = g._count._all;
  return counts;
}
