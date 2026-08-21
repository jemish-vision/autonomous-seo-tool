/**
 * Small HTTP helpers shared by the list-style read modules (links / images / redirects /
 * duplicates / sitemaps). Ported verbatim from the old app's lib/api-shared.ts so the response
 * envelope the client hooks parse is byte-for-byte identical: every list returns
 *   { data: T[], page: { page, pageSize, total, hasMore } }
 * and every runId/pageId taken from the URL is charset-checked the same way.
 *
 * No node:fs, no filesystem paths — this is pure request/array shaping.
 */

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** Reads ?page & ?pageSize, clamped to [1, MAX_PAGE_SIZE] — same defaults as the old routes. */
export function parseOffsetPaging(searchParams: URLSearchParams): { page: number; pageSize: number } {
  const pageRaw = Number(searchParams.get("page") ?? "1");
  const sizeRaw = Number(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE));
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(sizeRaw) && sizeRaw >= 1 ? Math.min(MAX_PAGE_SIZE, Math.floor(sizeRaw)) : DEFAULT_PAGE_SIZE;
  return { page, pageSize };
}

/** Slices an already-filtered/sorted in-memory array server-side (the client never receives more
 *  than one page regardless of run size). */
export function paginate<T>(items: T[], page: number, pageSize: number): { data: T[]; page: PageMeta } {
  const total = items.length;
  const start = (page - 1) * pageSize;
  const data = items.slice(start, start + pageSize);
  return { data, page: { page, pageSize, total, hasMore: start + pageSize < total } };
}

const SAFE_ID = /^[a-zA-Z0-9_.-]+$/;

/** Dots are legal in ids, so ".." alone would clear a plain charset check — reject the two dot
 *  segments explicitly. Kept for parity with the old routes even though these handlers build no
 *  filesystem paths (Supabase-only): a malformed id should 422, not reach Storage. */
export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id) && id !== "." && id !== "..";
}
