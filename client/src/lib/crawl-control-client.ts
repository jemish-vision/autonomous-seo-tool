/** Client-side wrapper for POST /api/crawls/:id/cancel — the ONLY caller of that endpoint, so
 *  every Stop control in the app shares identical honest success/409/404/network handling. */

export interface CancelledCrawlStatus {
  runId: string;
  state: string;
  note?: string;
  endedAt?: string | null;
  exitCode?: number | null;
  [key: string]: unknown;
}

export type CancelOutcome =
  | { ok: true; crawl: CancelledCrawlStatus }
  | { ok: false; code: "NOT_RUNNING" | "NOT_FOUND" | "UNAVAILABLE" | "SERVER" | "NETWORK"; message: string };

export async function requestCancelCrawl(runId: string): Promise<CancelOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/crawls/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
  } catch {
    return { ok: false, code: "NETWORK", message: "Network error while stopping the crawl. Check the dashboard server is running." };
  }

  let body: { crawl?: CancelledCrawlStatus; error?: { code?: string; message?: string } } | null = null;
  try {
    body = await res.json();
  } catch {
    // no/invalid JSON body — fall through to the status-based message below
  }

  if (res.status === 202 && body?.crawl) return { ok: true, crawl: body.crawl };
  if (res.status === 409) {
    return { ok: false, code: "NOT_RUNNING", message: body?.error?.message ?? "This crawl is no longer running — it may have already finished." };
  }
  // 501 = server says the crawler worker isn't in this deployment. 404 = the cancel route doesn't
  // exist at all (the client hit the API's catch-all). Either way the capability is missing, not a
  // per-run failure — surface it honestly as "not available" rather than a scary raw error.
  if (res.status === 501 || res.status === 404) {
    return { ok: false, code: "UNAVAILABLE", message: "Crawl control requires the crawler worker, which isn't part of this build." };
  }
  return { ok: false, code: "SERVER", message: body?.error?.message ?? `Failed to stop the crawl (HTTP ${res.status}).` };
}
