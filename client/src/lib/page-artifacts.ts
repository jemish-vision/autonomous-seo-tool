import type { CrawledPage } from "./types";

/**
 * Client-side proxies for the artifact checks the OLD app did with a filesystem `stat`.
 *
 * The NEW app can't stat the crawler's disk — blobs live in Supabase Storage behind the authed
 * `/api/crawls/:runId/pages/:pageId/{raw,replay,screenshot}` endpoints, which return 404 when a
 * blob is absent. So we derive "was this artifact captured?" from the page record instead, and the
 * consuming UI (PageReplay, PageActions) degrades gracefully to a not-found state if the blob turns
 * out to be missing.
 */

/** Raw markup is stored whenever the crawler received a response body — i.e. a status was returned.
 *  Network-failed pages have `statusCode === null` and never produced HTML to store. */
export function pageHasRawHtml(page: Pick<CrawledPage, "statusCode">): boolean {
  return page.statusCode !== null;
}

/** The crawler's own record that a pre-render (static, pre-JS) snapshot was saved for this page. */
export function pageHasStaticHtml(page: Pick<CrawledPage, "renderDivergence">): boolean {
  return page.renderDivergence?.staticRawSaved === true;
}
