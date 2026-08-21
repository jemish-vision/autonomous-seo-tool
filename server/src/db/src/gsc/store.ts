/**
 * Google Search Console persistence for the dashboard.
 *
 * Replaces the dashboard's flat-JSON store (storage/gsc/<userId>) with Postgres
 * rows, keeping the exact same shapes and semantics so the dashboard's
 * oauth/sync/inspect code doesn't change: date *keys* stay as text, real
 * timestamps come back as ISO strings, and each bundle is replaced atomically
 * the way the JSON file used to be overwritten.
 *
 * Every function takes the Prisma client as its first argument (the caller
 * owns its lifecycle — see src/client.ts createPrismaClient), and every query
 * filters by userId so one user can never read another's Google data.
 */
import type { PrismaClient } from "../../generated/client/index.js";

// ---------------------------------------------------------------------------
// Shapes — identical to the dashboard's JSON store types (lib/gsc/types.ts)
// ---------------------------------------------------------------------------

export interface GscConnectionRow {
  userId: string;
  googleEmail: string | null;
  refreshTokenEnc: string;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  scopes: string;
  createdAt: string;
  updatedAt: string;
}

export interface GscLinkedPropertyRow {
  userId: string;
  domain: string;
  siteUrl: string;
  propertyType: string;
  permissionLevel: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface GscPageMetricRow {
  date: string;
  pageUrl: string;
  normalizedUrl: string | null;
  searchType: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscBreakdownRow {
  dimension: string;
  searchType: string;
  keyValue: string;
  windowStart: string;
  windowEnd: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscMetricsBundle {
  siteUrl: string;
  propertyType: string;
  lastSyncedAt: string | null;
  pageMetrics: GscPageMetricRow[];
  breakdowns: GscBreakdownRow[];
}

export interface GscInspectionRow {
  pageUrl: string;
  verdict: string;
  coverageState: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  lastCrawlTime: string | null;
  crawledAs: string | null;
  sitemaps: string[] | null;
  raw: Record<string, unknown> | null;
  inspectedAt: string;
}

export interface GscInspectionAttemptRow {
  date: string;
  succeeded: boolean;
}

export interface GscInspectionsBundle {
  rows: GscInspectionRow[];
  attempts: GscInspectionAttemptRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** createMany in chunks so a big bundle stays under Postgres's 65535-parameter limit. */
async function chunkedCreateMany<T>(rows: T[], batch: (chunk: T[]) => Promise<unknown>): Promise<void> {
  const SIZE = 1_000;
  for (let i = 0; i < rows.length; i += SIZE) {
    await batch(rows.slice(i, i + SIZE));
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export async function gscReadConnection(prisma: PrismaClient, userId: string): Promise<GscConnectionRow | null> {
  const row = await prisma.gscConnection.findUnique({ where: { userId } });
  if (!row) return null;
  return {
    userId: row.userId,
    googleEmail: row.googleEmail,
    refreshTokenEnc: row.refreshTokenEnc,
    accessToken: row.accessToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt ? row.accessTokenExpiresAt.toISOString() : null,
    scopes: row.scopes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function gscWriteConnection(prisma: PrismaClient, conn: GscConnectionRow): Promise<void> {
  await prisma.gscConnection.upsert({
    where: { userId: conn.userId },
    create: {
      userId: conn.userId,
      googleEmail: conn.googleEmail,
      refreshTokenEnc: conn.refreshTokenEnc,
      accessToken: conn.accessToken,
      accessTokenExpiresAt: conn.accessTokenExpiresAt ? new Date(conn.accessTokenExpiresAt) : null,
      scopes: conn.scopes,
      createdAt: new Date(conn.createdAt),
      updatedAt: new Date(conn.updatedAt),
    },
    update: {
      googleEmail: conn.googleEmail,
      refreshTokenEnc: conn.refreshTokenEnc,
      accessToken: conn.accessToken,
      accessTokenExpiresAt: conn.accessTokenExpiresAt ? new Date(conn.accessTokenExpiresAt) : null,
      scopes: conn.scopes,
      updatedAt: new Date(conn.updatedAt),
    },
  });
}

export async function gscDeleteConnection(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.gscConnection.deleteMany({ where: { userId } });
}

// ---------------------------------------------------------------------------
// Linked property
// ---------------------------------------------------------------------------

export async function gscReadLinkedProperty(prisma: PrismaClient, userId: string, domain: string): Promise<GscLinkedPropertyRow | null> {
  const row = await prisma.gscLinkedProperty.findUnique({ where: { userId_domain: { userId, domain } } });
  if (!row) return null;
  return {
    userId: row.userId,
    domain: row.domain,
    siteUrl: row.siteUrl,
    propertyType: row.propertyType,
    permissionLevel: row.permissionLevel,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function gscWriteLinkedProperty(prisma: PrismaClient, property: GscLinkedPropertyRow): Promise<void> {
  const { domain, siteUrl, propertyType, permissionLevel, lastSyncedAt, createdAt } = property;
  await prisma.gscLinkedProperty.upsert({
    where: { userId_domain: { userId: property.userId, domain } },
    create: {
      userId: property.userId,
      domain,
      siteUrl,
      propertyType,
      permissionLevel,
      lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt) : null,
      createdAt: new Date(createdAt),
    },
    update: {
      siteUrl,
      propertyType,
      permissionLevel,
      lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt) : null,
    },
  });
}

export async function gscDeleteLinkedProperty(prisma: PrismaClient, userId: string, domain: string): Promise<void> {
  await prisma.gscLinkedProperty.deleteMany({ where: { userId, domain } });
}

export async function gscListLinkedDomains(prisma: PrismaClient, userId: string): Promise<string[]> {
  const rows = await prisma.gscLinkedProperty.findMany({
    where: { userId },
    select: { domain: true },
    orderBy: { domain: "asc" },
  });
  return rows.map((r) => r.domain);
}

// ---------------------------------------------------------------------------
// Metrics bundle (meta + page metrics + breakdowns) — replaced atomically
// ---------------------------------------------------------------------------

export async function gscReadMetrics(prisma: PrismaClient, userId: string, domain: string): Promise<GscMetricsBundle | null> {
  const [meta, pageMetrics, breakdowns] = await Promise.all([
    prisma.gscMetricsMeta.findUnique({ where: { userId_domain: { userId, domain } } }),
    prisma.gscPageMetric.findMany({ where: { userId, domain } }),
    prisma.gscBreakdown.findMany({ where: { userId, domain } }),
  ]);
  if (!meta) return null;
  return {
    siteUrl: meta.siteUrl,
    propertyType: meta.propertyType,
    lastSyncedAt: meta.lastSyncedAt ? meta.lastSyncedAt.toISOString() : null,
    pageMetrics: pageMetrics.map((r) => ({
      date: r.date,
      pageUrl: r.pageUrl,
      normalizedUrl: r.normalizedUrl,
      searchType: r.searchType,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    })),
    breakdowns: breakdowns.map((r) => ({
      dimension: r.dimension,
      searchType: r.searchType,
      keyValue: r.keyValue,
      windowStart: r.windowStart,
      windowEnd: r.windowEnd,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    })),
  };
}

export async function gscWriteMetrics(prisma: PrismaClient, userId: string, domain: string, bundle: GscMetricsBundle): Promise<void> {
  const pageRows = bundle.pageMetrics.map((r) => ({ userId, domain, ...r }));
  const breakdownRows = bundle.breakdowns.map((r) => ({ userId, domain, ...r }));

  await prisma.$transaction([
    prisma.gscMetricsMeta.upsert({
      where: { userId_domain: { userId, domain } },
      create: {
        userId,
        domain,
        siteUrl: bundle.siteUrl,
        propertyType: bundle.propertyType,
        lastSyncedAt: bundle.lastSyncedAt ? new Date(bundle.lastSyncedAt) : null,
      },
      update: {
        siteUrl: bundle.siteUrl,
        propertyType: bundle.propertyType,
        lastSyncedAt: bundle.lastSyncedAt ? new Date(bundle.lastSyncedAt) : null,
      },
    }),
    prisma.gscPageMetric.deleteMany({ where: { userId, domain } }),
    prisma.gscBreakdown.deleteMany({ where: { userId, domain } }),
  ]);

  await chunkedCreateMany(pageRows, (chunk) => prisma.gscPageMetric.createMany({ data: chunk }));
  await chunkedCreateMany(breakdownRows, (chunk) => prisma.gscBreakdown.createMany({ data: chunk }));
}

// ---------------------------------------------------------------------------
// URL inspections bundle (rows + quota attempts) — replaced atomically
// ---------------------------------------------------------------------------

export async function gscReadInspections(prisma: PrismaClient, userId: string, domain: string): Promise<GscInspectionsBundle | null> {
  const [rows, attempts] = await Promise.all([
    prisma.gscInspection.findMany({ where: { userId, domain } }),
    prisma.gscInspectionAttempt.findMany({ where: { userId, domain } }),
  ]);
  return {
    rows: rows.map((r) => ({
      pageUrl: r.pageUrl,
      verdict: r.verdict,
      coverageState: r.coverageState,
      robotsTxtState: r.robotsTxtState,
      indexingState: r.indexingState,
      pageFetchState: r.pageFetchState,
      googleCanonical: r.googleCanonical,
      userCanonical: r.userCanonical,
      lastCrawlTime: r.lastCrawlTime ? r.lastCrawlTime.toISOString() : null,
      crawledAs: r.crawledAs,
      sitemaps: r.sitemaps.length > 0 ? r.sitemaps : null,
      raw: r.raw as Record<string, unknown> | null,
      inspectedAt: r.inspectedAt.toISOString(),
    })),
    attempts: attempts.map((a) => ({ date: a.date, succeeded: a.succeeded })),
  };
}

export async function gscWriteInspections(prisma: PrismaClient, userId: string, domain: string, bundle: GscInspectionsBundle): Promise<void> {
  const rowData = bundle.rows.map((r) => ({
    userId,
    domain,
    pageUrl: r.pageUrl,
    verdict: r.verdict,
    coverageState: r.coverageState,
    robotsTxtState: r.robotsTxtState,
    indexingState: r.indexingState,
    pageFetchState: r.pageFetchState,
    googleCanonical: r.googleCanonical,
    userCanonical: r.userCanonical,
    lastCrawlTime: r.lastCrawlTime ? new Date(r.lastCrawlTime) : null,
    crawledAs: r.crawledAs,
    sitemaps: r.sitemaps ?? [],
    raw: (r.raw ?? {}) as object,
    inspectedAt: new Date(r.inspectedAt),
  }));
  const attemptData = bundle.attempts.map((a) => ({ userId, domain, date: a.date, succeeded: a.succeeded }));

  await prisma.$transaction([
    prisma.gscInspection.deleteMany({ where: { userId, domain } }),
    prisma.gscInspectionAttempt.deleteMany({ where: { userId, domain } }),
  ]);

  await chunkedCreateMany(rowData, (chunk) => prisma.gscInspection.createMany({ data: chunk }));
  await chunkedCreateMany(attemptData, (chunk) => prisma.gscInspectionAttempt.createMany({ data: chunk }));
}
