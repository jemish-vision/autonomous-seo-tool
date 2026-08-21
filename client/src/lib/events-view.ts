/** Client+server-safe (no node:fs). Display metadata for the Activity stream's event taxonomy —
 *  see ../seo-crawler-poc/src/events/types.ts CrawlEventKind for the durable source of truth, and
 *  lib/events-log.ts for the synthetic fallback's extra kinds (log/progress/done). Kept separate
 *  from lib/events-log.ts (server-only, node:fs) so the client stream component can import this
 *  without pulling fs into the browser bundle. */

export type EventTone = "neutral" | "ok" | "warn" | "danger" | "info";

export interface EventKindMeta {
  label: string;
  tone: EventTone;
  /** True for the 3 lifecycle markers that get their own divider-style row instead of a normal line. */
  lifecycle: boolean;
}

const KIND_META: Record<string, EventKindMeta> = {
  "crawl-started": { label: "Crawl started", tone: "info", lifecycle: true },
  "crawl-finished": { label: "Crawl finished", tone: "ok", lifecycle: true },
  "crawl-cancelled": { label: "Crawl cancelled", tone: "danger", lifecycle: true },
  request: { label: "Request", tone: "neutral", lifecycle: false },
  "browser-render": { label: "Rendered in a browser", tone: "info", lifecycle: false },
  "certificate-check": { label: "Certificate check", tone: "neutral", lifecycle: false },
  "outbound-link-check": { label: "Outbound link check", tone: "neutral", lifecycle: false },
  "image-measuring": { label: "Image measuring", tone: "neutral", lifecycle: false },
  log: { label: "Log", tone: "neutral", lifecycle: false },
  progress: { label: "Progress", tone: "neutral", lifecycle: false },
  done: { label: "Done", tone: "ok", lifecycle: true },
};

const FALLBACK_META: EventKindMeta = { label: "Unknown event", tone: "neutral", lifecycle: false };

/** Never drops an unrecognized kind silently — falls back to a labeled, visible "Unknown event"
 *  row (same principle as "no sort key silently dropped" elsewhere in this build) rather than
 *  filtering it out of the stream. */
export function eventKindMeta(kind: string): EventKindMeta {
  return KIND_META[kind] ?? { ...FALLBACK_META, label: `Unknown event (${kind})` };
}

export const ALL_KNOWN_KINDS = Object.keys(KIND_META);

export function statusTone(statusCode: number | null): EventTone {
  if (statusCode === null) return "neutral";
  if (statusCode < 300) return "ok";
  if (statusCode < 400) return "info";
  if (statusCode < 500) return "warn";
  return "danger";
}

export function statusBucket(statusCode: number | null): "2xx" | "3xx" | "4xx" | "5xx" | "none" {
  if (statusCode === null) return "none";
  if (statusCode < 300) return "2xx";
  if (statusCode < 400) return "3xx";
  if (statusCode < 500) return "4xx";
  return "5xx";
}
