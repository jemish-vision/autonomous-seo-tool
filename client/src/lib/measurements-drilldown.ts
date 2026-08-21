/**
 * Client type shim for the old server-only `lib/measurements-drilldown.ts` (node:fs, computed the
 * matching-page set for a measurement id). The computation is server-side — keeps ONLY the TYPES.
 *
 * TODO(api): use @/api/measurements (GET /api/crawls/:id/measurements/:measurementId/pages) for the
 * DrilldownResult payload.
 */
export interface MatchingPageRow {
  pageId: string;
  url: string;
  statusCode: number | null;
}

export interface DrilldownResult {
  rows: MatchingPageRow[];
  total: number;
  truncated: boolean;
}
