/** Slice: crawl queue + concurrency + activity stream. */

/**
 * The activity kinds the stream can carry. `request` fires once per HTTP fetch (page, with its
 * status code); the other four are the distinct kinds a consumer's timeline UI groups by —
 * matching what the dashboard shows: a page rendered in a browser, the host's TLS certificate
 * check, an outbound-link HEAD check, and an image asset measurement.
 */
export type CrawlEventKind =
  | "crawl-started"
  | "request"
  | "browser-render"
  | "certificate-check"
  | "outbound-link-check"
  | "image-measuring"
  | "crawl-cancelled"
  | "crawl-finished";

export interface CrawlActivityEvent {
  /** Monotonic within the run — replay order is provable even if two events share a timestamp. */
  seq: number;
  runId: string;
  kind: CrawlEventKind;
  at: string;
  url: string | null;
  statusCode: number | null;
  message: string;
  detail?: Record<string, unknown>;
}

export type CrawlActivityEventInput = Omit<CrawlActivityEvent, "seq" | "runId" | "at">;
