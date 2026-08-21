/**
 * Public surface for external callers (the crawler's dynamic-import adapter — see
 * poc/seo-crawler-poc/src/storage/supabaseSync.ts). Compiled to dist/index.js so a caller in
 * another package can `await import()` it at a runtime-computed path with zero build-time
 * coupling: no npm dependency, no workspace link, and the crawler's own `tsc --noEmit` never has
 * to resolve this package's types.
 */
export { loadEnv } from "./env.js";
export { createPrismaClient, createDirectPrismaClient, POOL_PROFILES } from "./client.js";
export { syncRunToPostgres } from "./sync/syncRun.js";
export type { SyncOptions, SyncResult } from "./sync/syncRun.js";
export { syncAiRecommendations } from "./sync/syncAiRecommendations.js";
export type { SyncAiRecommendationsResult } from "./sync/syncAiRecommendations.js";
export { importIssuesToPostgres, importFindingsForCrawl } from "./crawl/importIssues.js";
export type { FindingsImportResult } from "./crawl/importIssues.js";
export {
  dbCrawlExists,
  dbListCrawlRuns,
  dbGetCrawlRun,
  dbReadCrawlSkipped,
  dbGetCrawlPages,
  dbGetCrawlPage,
  dbReadCrawlAnalysis,
} from "./crawl/readStore.js";
export { dbReadCrawlMeta, dbWriteCrawlMeta } from "./crawl/crawlMeta.js";
export type { CrawlMeta } from "./crawl/crawlMeta.js";
export type {
  CrawlRunListItem,
  CrawlReportRow,
  RobotsEvidenceRow,
  SitemapResultRow,
  FailureRow,
  SkippedUrlRow,
  CrawlRunDetailRow,
  CrawledPageRow,
  AnalysisIssueRow,
  AnalysisFindingRow,
  AnalysisReportRow,
} from "./crawl/readStore.js";
export { pruneOldCrawls } from "./retention/prune.js";
export { detectScoringModelCutoff } from "./importer/modelCutoff.js";
export {
  getServiceClient,
  ensureBuckets,
  uploadArtifact,
  mintSignedUrl,
  verifyUserJwt,
  BUCKETS,
} from "./storage/supabaseStorage.js";
export type { BucketEnsureResult, UploadResult, SignedUrlResult, JwtVerifyResult } from "./storage/supabaseStorage.js";
export {
  gscReadConnection,
  gscWriteConnection,
  gscDeleteConnection,
  gscReadLinkedProperty,
  gscWriteLinkedProperty,
  gscDeleteLinkedProperty,
  gscListLinkedDomains,
  gscReadMetrics,
  gscWriteMetrics,
  gscReadInspections,
  gscWriteInspections,
} from "./gsc/store.js";
export type {
  GscConnectionRow,
  GscLinkedPropertyRow,
  GscPageMetricRow,
  GscBreakdownRow,
  GscMetricsBundle,
  GscInspectionRow,
  GscInspectionAttemptRow,
  GscInspectionsBundle,
} from "./gsc/store.js";
