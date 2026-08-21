/**
 * Client type shim for the old server-only `lib/data-redirects.ts`. Redirect rows are built
 * server-side from stored redirectChain[] and returned by the API. Keeps ONLY the shared TYPES.
 *
 * TODO(api): use @/api/redirects (GET /api/crawls/:id/redirects) for the RedirectRow[] payload.
 */
export type RedirectType = "permanent" | "temporary" | "loop" | "to-error";

export interface RedirectRow {
  pageId: string;
  requestedUrl: string;
  chain: { from: string; to: string; statusCode: number }[];
  hops: number;
  finalUrl: string | null;
  finalStatus: number | null;
  type: RedirectType;
  crossHost: boolean;
  toHttps: boolean;
}
