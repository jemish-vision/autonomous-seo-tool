/**
 * Client-side data-type contract.
 *
 * The old Next.js app had a server-only `lib/data.ts` full of node:fs readers. In this app the
 * data comes from the Express API, so this file keeps ONLY the shared TYPES that UI components
 * import from `@/lib/data` (e.g. `RunListItem`). No filesystem, no runtime — types only.
 *
 * Runtime data fetching lives in `src/api/*` (React Query hooks over the API client).
 */
export type {
  CrawledPage,
  CrawledPageWithId,
  CrawlSummary,
  AnalysisReport,
  Issue,
  FindingReport,
  RobotsEvidence,
  SitemapResult,
  FailureRecord,
  SkippedUrlRecord,
} from "./types";

/** Mirrors the API's CrawlRunListItem (server: db/src/crawl/readStore + crawl-source). */
export interface RunListItem {
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
  state?: "completed" | "cancelled" | "failed";
  analyzed?: boolean;
  healthScore?: number | null;
  /** Editable run metadata (crawl_meta). Present when the API includes it; the label editor
   *  pre-fills from here. */
  label?: string | null;
  notes?: string | null;
  tags?: string[];
}

/** Run detail as returned by GET /api/crawls/:runId. */
export interface RunDetail {
  report: CrawlSummary | null;
  robots: RobotsEvidence | null;
  sitemaps: SitemapResult | null;
  blocked: string[];
  failures: FailureRecord[];
  skipped?: SkippedUrlRecord[] | null;
}

import type {
  CrawlSummary,
  RobotsEvidence,
  SitemapResult,
  FailureRecord,
  SkippedUrlRecord,
} from "./types";
