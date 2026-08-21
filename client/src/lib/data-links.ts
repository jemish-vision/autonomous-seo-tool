/**
 * Client type shim for the old server-only `lib/data-links.ts`. Link rows are aggregated
 * server-side and returned by the API. Keeps ONLY the shared TYPES the /links UI imports.
 *
 * TODO(api): use @/api/links (GET /api/crawls/:id/links) for the LinkRow[] payload.
 */
export interface LinkRow {
  key: string;
  target: string;
  targetNormalized: string | null;
  type: "internal" | "external";
  status: number | null;
  crawled: boolean;
  broken: boolean;
  inboundCount: number;
  nofollowCount: number;
  anchors: string[];
  sources: { pageId: string; url: string; anchor: string; nofollow: boolean }[];
}
