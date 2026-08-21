/** Client-safe types/helpers shared by S10 server + client components. No node:fs imports here. */

export type StatusBucket = "2xx" | "3xx" | "4xx" | "5xx" | "failed" | "blocked";

export const STATUS_BUCKETS: { key: StatusBucket; label: string }[] = [
  { key: "2xx", label: "2xx" },
  { key: "3xx", label: "3xx" },
  { key: "4xx", label: "4xx" },
  { key: "5xx", label: "5xx" },
  { key: "failed", label: "Failed" },
  { key: "blocked", label: "Blocked" },
];

export interface ExplorerRow {
  key: string;
  url: string;
  pageId: string | null;
  bucket: StatusBucket;
  statusCode: number | null;
  renderedWith: "http" | "playwright" | null;
  depth: number | null;
  wordCount: number | null;
  responseTimeMs: number | null;
  reason: string | null;
  pagerank?: number | null;
}

export function statusTone(code: number | null): "ok" | "warn" | "danger" | "neutral" {
  if (code === null) return "neutral";
  if (code >= 400) return "danger";
  if (code >= 300) return "warn";
  return "ok";
}

export function bucketForStatus(code: number | null): StatusBucket {
  if (code === null) return "failed";
  const b = Math.floor(code / 100);
  if (b === 2) return "2xx";
  if (b === 3) return "3xx";
  if (b === 4) return "4xx";
  if (b === 5) return "5xx";
  return "failed";
}

/** First path segment of a URL, used for "group by section" + breadcrumbs. Root path -> "(root)". */
export function sectionOf(url: string): string {
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean)[0];
    return segment ?? "(root)";
  } catch {
    return "(root)";
  }
}

export type SortKey = "url" | "status" | "depth" | "wordCount" | "responseTime" | "pagerank";

export const SORT_KEYS: SortKey[] = ["url", "status", "depth", "wordCount", "responseTime", "pagerank"];

/** URL-shaped filter/sort state — the single source of truth so list + detail (prev/next) agree. */
export interface ExplorerFilterParams {
  q?: string | null;
  status?: StatusBucket | null;
  rendered?: "http" | "playwright" | null;
  depth?: number | null;
  sort?: SortKey | null;
  dir?: "asc" | "desc";
  section?: string | null;
}

function sortValue(row: ExplorerRow, key: SortKey): string | number | null {
  switch (key) {
    case "url":
      return row.url;
    case "status":
      return row.statusCode;
    case "depth":
      return row.depth;
    case "wordCount":
      return row.wordCount;
    case "responseTime":
      return row.responseTimeMs;
    case "pagerank":
      return row.pagerank ?? null;
  }
}

/** Pure — reused by the client explorer (interactive) and the server detail page (prev/next),
 *  so both agree on exactly which rows are "in view" for a given URL query. */
export function filterAndSortRows(rows: ExplorerRow[], params: ExplorerFilterParams): ExplorerRow[] {
  let items = rows;
  if (params.q) {
    const needle = params.q.toLowerCase();
    items = items.filter((r) => r.url.toLowerCase().includes(needle));
  }
  if (params.status) items = items.filter((r) => r.bucket === params.status);
  if (params.rendered) items = items.filter((r) => r.renderedWith === params.rendered);
  if (params.depth !== undefined && params.depth !== null) items = items.filter((r) => r.depth === params.depth);
  if (params.section) items = items.filter((r) => sectionOf(r.url) === params.section);

  if (params.sort) {
    const sortKey = params.sort;
    const dirMul = params.dir === "desc" ? -1 : 1;
    items = [...items].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -1 * dirMul;
      if (av > bv) return 1 * dirMul;
      return 0;
    });
  }
  return items;
}

export interface SectionGroup {
  section: string;
  items: ExplorerRow[];
  statusMix: Partial<Record<StatusBucket, number>>;
}

/** Groups rows by first path segment (sectionOf) for the /pages "Group by section" view. */
export function groupBySection(rows: ExplorerRow[]): SectionGroup[] {
  const map = new Map<string, ExplorerRow[]>();
  for (const r of rows) {
    const key = sectionOf(r.url);
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([section, items]) => {
      const statusMix: Partial<Record<StatusBucket, number>> = {};
      for (const r of items) statusMix[r.bucket] = (statusMix[r.bucket] ?? 0) + 1;
      return { section, items, statusMix };
    })
    .sort((a, b) => (a.section === "(root)" ? -1 : b.section === "(root)" ? 1 : a.section.localeCompare(b.section)));
}
