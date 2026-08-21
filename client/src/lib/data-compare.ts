/**
 * Client type shim for the old server-only `lib/data-compare.ts` (computed the crawl-over-crawl
 * diff via node:fs reads). The diff is now computed server-side and returned by the API — this
 * file keeps ONLY the TYPES the /compare UI imports.
 *
 * TODO(api): use @/api/compare (GET /api/compare?base=&head=) for the CrawlDiff payload.
 */
export interface PageFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface PageChange {
  url: string;
  pageId: string;
  changes: PageFieldChange[];
}

export interface CrawlDiff {
  baseRunId: string;
  headRunId: string;
  generatedAt: string;
  /** URLs present in head but not base. */
  added: string[];
  /** URLs present in base but not head. */
  removed: string[];
  changed: PageChange[];
  unchangedCount: number;
  /** Issue lifecycle when BOTH runs have been analyzed; null otherwise (honest, not zero). */
  issues: { newIssues: string[]; fixedIssues: string[]; persistingCount: number } | null;
}
