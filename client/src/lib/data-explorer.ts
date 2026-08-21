/**
 * Client-safe subset of the old server-only `lib/data-explorer.ts`. The row builder
 * (buildExplorerRows) read pages/failures/blocked from disk — that's server-side now and the row
 * list is returned by the API. This file re-exports the pure explorer helpers and keeps the two
 * pure cross-ref helpers the UI imports.
 *
 * TODO(api): use @/api/pages (GET /api/crawls/:id/pages) for the ExplorerRow[] payload.
 */
import type { CrawledPageWithId, FailureRecord } from "./types";

export type { ExplorerRow, StatusBucket, SortKey, ExplorerFilterParams, SectionGroup } from "./explorer-shared";
export { STATUS_BUCKETS, SORT_KEYS, statusTone, sectionOf, filterAndSortRows, groupBySection } from "./explorer-shared";

export function groupFailuresByClass(failures: FailureRecord[]): { reason: string; items: FailureRecord[] }[] {
  const map = new Map<string, FailureRecord[]>();
  for (const f of failures) {
    const list = map.get(f.reason) ?? [];
    list.push(f);
    map.set(f.reason, list);
  }
  return [...map.entries()]
    .map(([reason, items]) => ({ reason, items }))
    .sort((a, b) => b.items.length - a.items.length);
}

/**
 * Cross-ref matches by pathname+search, host-agnostic: sitemap entries are authored (possibly
 * aliased-host) URLs while page records store remapped normalized URLs.
 */
export function findPageIdByUrl(pages: CrawledPageWithId[], url: string): string | null {
  const key = pathKey(url);
  if (key === null) return null;
  for (const p of pages) {
    if (pathKey(p.url) === key || pathKey(p.normalizedUrl) === key) return p.pageId;
  }
  return null;
}

function pathKey(raw: string): string | null {
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}
