/** Slice S7 implements; reworked per the four-crawler escalation-heuristic audit (see WORK_LOG).
 * The previous 7-signal stack escalated on proxies (missing SEO tags, "tiny body", bundler script
 * src) that correlate weakly with real JS-dependency: 21 of 24 pages it escalated on the audited
 * site gained nothing (content.source stayed static-dom). Replaced with exactly two signals, both
 * direct evidence of an empty/JS-dependent DOM — never a missing-SEO-tag proxy alone. */
import type { CrawlScope, ExtractionResult } from "../models/types";

/** Numeric knobs, exported so the POC report can cite exactly what fired. */
export const DETECTION_THRESHOLDS = {
  /** [A] "empty framework root": total static visible-text chars under this, when a known SPA
   * mount marker (#root/#__next/#app, data-reactroot, ng-version/ng-app) is present anywhere. */
  emptyFrameworkRootMaxChars: 200,
  /** [B] "sparse js-heavy dom": visible-text-bytes / total-html-bytes below this fraction. */
  sparseTextRatio: 0.05,
  /** [B] script bytes must exceed text bytes by more than this multiple. */
  sparseScriptToTextMultiple: 3,
  /** [B] static internal link count strictly below this. */
  sparseMaxInternalLinks: 3,
} as const;

const DIV_MOUNT_ID_RE = /<div\b[^>]*\bid=["'](root|__next|app)["'][^>]*>/i;
const ATTR_MOUNT_MARKERS_RE = /data-reactroot|ng-version\s*=|\bng-app\b/i;
const SCRIPT_BLOCK_RE = /<script[\s\S]*?<\/script>/gi;
const STYLE_BLOCK_RE = /<style[\s\S]*?<\/style>/gi;

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

/** Script/style stripped, tags stripped, whitespace collapsed — the same shape as the extraction
 * pipeline's own visible-text notion, kept local so this module stays dependency-free. */
function visibleText(html: string): string {
  const stripped = html.replace(SCRIPT_BLOCK_RE, "").replace(STYLE_BLOCK_RE, "");
  return stripTags(stripped).replace(/\s+/g, " ").trim();
}

/** Sum of every `<script>...</script>` block's own byte length (tags included) — the wire cost
 * of script markup, independent of style bytes so it isn't diluted by an unrelated CSS block. */
function scriptBytesOf(html: string): number {
  let bytes = 0;
  for (const m of html.matchAll(SCRIPT_BLOCK_RE)) bytes += Buffer.byteLength(m[0], "utf8");
  return bytes;
}

function hasFrameworkMountMarker(html: string): boolean {
  return DIV_MOUNT_ID_RE.test(html) || ATTR_MOUNT_MARKERS_RE.test(html);
}

/**
 * Decide whether static HTML is insufficient and the page needs Playwright rendering.
 *
 * Deliberately narrow: escalates only on direct evidence the DOM itself is empty/JS-dependent.
 * A page missing canonical/title/h1 never escalates on that alone — those are common on genuinely
 * static pages too and produced most of the over-escalation the prior heuristic suffered from.
 * `scope` is unused (kept for call-site stability — internal/external is already resolved into
 * `extraction.links[].type`).
 */
export function needsJsRendering(
  html: string,
  extraction: ExtractionResult,
  _scope: CrawlScope,
): { needed: boolean; signals: string[] } {
  const T = DETECTION_THRESHOLDS;
  const signals: string[] = [];

  const totalBytes = Buffer.byteLength(html, "utf8");
  const text = visibleText(html);
  const textBytes = Buffer.byteLength(text, "utf8");

  // [A] A known SPA mount marker is present, but the ENTIRE static body carries almost no visible
  // text anywhere — not just inside the mount root — so the page is a shell waiting on JS.
  if (hasFrameworkMountMarker(html) && text.length < T.emptyFrameworkRootMaxChars) {
    signals.push("empty-framework-root");
  }

  // [B] Thin text ratio + script bytes dwarfing text bytes + too few internal links to already be
  // a real crawlable page as shipped. All three must hold — any one alone is too common on static
  // pages (a script-heavy analytics page, a thin-but-real landing page, a nav-light single-pager).
  if (totalBytes > 0) {
    const textRatio = textBytes / totalBytes;
    const scriptBytes = scriptBytesOf(html);
    const internalLinks = extraction.links.filter((l) => l.type === "internal").length;
    if (
      textRatio < T.sparseTextRatio &&
      scriptBytes > textBytes * T.sparseScriptToTextMultiple &&
      internalLinks < T.sparseMaxInternalLinks
    ) {
      signals.push("sparse-js-heavy-dom");
    }
  }

  return { needed: signals.length > 0, signals };
}
