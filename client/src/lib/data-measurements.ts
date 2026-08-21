/**
 * Client type shim for the old server-only `lib/data-measurements.ts` (computed measurements from
 * node:fs page reads). The measurement payload is computed server-side and returned by the API —
 * this file keeps ONLY the shared TYPES the /measurements screen + api hook import.
 *
 * TODO(api): use @/api/measurements (GET /api/crawls/:id/measurements) for the Measurements payload.
 */
export interface Histogram {
  buckets: { key: string; count: number }[];
  available: true;
}

export interface Percentiles {
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  available: true;
  caveat: string;
}

export interface Unavailable {
  available: false;
  reason: string;
}

export interface Measurements {
  runId: string;
  generatedAt: string;
  overview: {
    discovered: number;
    unique: number;
    allowed: number;
    attempted: number;
    successful: number;
    failed: number;
    blockedByRobots: number;
    coveragePercent: number;
    durationMs: number;
    pagesPerMinute: number;
    maxDepthSeen: number | null;
  };
  statusHistogram: Histogram;
  depthHistogram: Histogram;
  responseTimeMs: Percentiles;
  wordCount: {
    avg: number | null;
    median: number | null;
    thinContentUnder300: number;
    available: true;
  };
  pageWeight: Unavailable;
  bytesDownloaded: Unavailable;
  indexability: {
    indexable: number;
    noindex: number;
    blockedByRobots: number;
    nonOkStatus: number;
    available: true;
  };
  renderStats: {
    http: number;
    playwright: number;
    renderRatePercent: number;
    available: true;
  };
  linksAndOrphans: {
    internalLinks: number;
    externalLinks: number;
    orphanCandidates: number;
    available: true;
  };
  sitemapCoverage: {
    urlsInSitemap: number;
    inSitemapNotCrawled: number;
    crawledNotInSitemap: number;
    sitemapEntriesFailed: number;
    available: true;
  };
  failuresByClass: Histogram;
}
