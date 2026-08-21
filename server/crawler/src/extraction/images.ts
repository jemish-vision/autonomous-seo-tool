/** Image inventory: <img>/<input type=image> (alt-applicable) plus <picture>, srcset, and CSS
 * background references. Backgrounds and <source> elements are kept OUT of images[] on purpose —
 * they have no alt attribute, so folding them in would inflate every missing-alt denominator. */
import type { CheerioAPI } from "cheerio";
// cheerio's public surface never re-exports its node type by name; domhandler is where cheerio
// itself declares it, and this is type-only so nothing is added to the runtime dependency graph.
import type { AnyNode } from "domhandler";
import type {
  ComputedBackgroundHit,
  ImageAssetSize,
  ImageRecord,
  ImageSummary,
  NetworkObservedAsset,
  PictureSourceRecord,
  SrcSetCandidate,
} from "../models/types";
import { decodeImageDimensions } from "./favicons";
import { extractFormat, parseIntAttr, resolveAbsolute } from "./shared";

/** Lazy-loader attributes, in the order a browser-or-polyfill would prefer them. */
const SRC_ATTRS = [
  "src",
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-lazy",
  "data-image-src",
  "data-echo",
  "data-image",
  "data-bg",
  "data-fallback-src",
];
const SRCSET_ATTRS = ["srcset", "data-srcset", "data-lazy-srcset"];
/** @font-face `src` is deliberately absent — fonts.ts owns that, and it is not an image. */
const CSS_IMAGE_PROPS = new Set([
  "background",
  "background-image",
  "border-image",
  "border-image-source",
  "list-style",
  "list-style-image",
  "mask",
  "mask-image",
  "-webkit-mask-image",
  "shape-outside",
  "cursor",
  "content",
]);

function attrOf($: CheerioAPI, el: AnyNode, name: string): string | null {
  const v = $(el).attr(name);
  return v !== undefined && v.trim() !== "" ? v.trim() : null;
}

function lowerAttr($: CheerioAPI, el: AnyNode, name: string): string | null {
  const v = attrOf($, el, name);
  return v === null ? null : v.toLowerCase();
}

function isDataUri(url: string): boolean {
  return /^data:/i.test(url.trim());
}

/** Byte length of a data: payload — exact for base64, the raw length otherwise. No fetch needed. */
export function dataUriBytes(uri: string): number {
  const comma = uri.indexOf(",");
  if (comma === -1) return 0;
  const payload = uri.slice(comma + 1);
  if (!/;base64/i.test(uri.slice(0, comma))) return payload.length;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/**
 * HTML-spec srcset tokenizer, not a `split(",")`: a URL is collected up to the next whitespace,
 * so `/a,b.png 1x` is one candidate and not two. A candidate with no descriptor is density 1.
 */
export function parseSrcset(raw: string | null | undefined, base: string): SrcSetCandidate[] {
  if (!raw || !raw.trim()) return [];
  const out: SrcSetCandidate[] = [];
  const s = raw;
  let i = 0;

  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i]!)) i++;
    if (i >= s.length) break;

    let urlToken = "";
    while (i < s.length && !/\s/.test(s[i]!)) urlToken += s[i++]!;

    let descriptor = "";
    if (urlToken.endsWith(",")) {
      urlToken = urlToken.replace(/,+$/, "");
    } else {
      while (i < s.length && /\s/.test(s[i]!)) i++;
      while (i < s.length && s[i] !== ",") descriptor += s[i++]!;
      if (i < s.length) i++; // consume the separating comma
    }
    if (!urlToken) continue;

    const url = isDataUri(urlToken) ? urlToken : resolveAbsolute(urlToken, base);
    if (url === null) continue;

    const d = descriptor.trim();
    const w = /(^|\s)(\d+)w(\s|$)/.exec(d);
    const x = /(^|\s)([\d.]+)x(\s|$)/.exec(d);
    out.push({
      url,
      width: w ? Number(w[2]) : null,
      density: x ? Number(x[2]) : w ? null : 1,
      raw: d,
    });
  }
  return out;
}

/** First non-empty of the lazy-loader src attributes; falls back to the first srcset candidate,
 * which is what a browser would load when an <img> carries srcset but no src. */
function pickPrimarySrc(
  $: CheerioAPI,
  el: AnyNode,
  base: string,
  srcset: SrcSetCandidate[]
): { url: string; source: string } | null {
  for (const name of SRC_ATTRS) {
    const raw = attrOf($, el, name);
    if (!raw) continue;
    const url = isDataUri(raw) ? raw : resolveAbsolute(raw, base);
    if (url !== null) return { url, source: name };
  }
  const first = srcset[0];
  return first ? { url: first.url, source: "srcset" } : null;
}

function readSrcset($: CheerioAPI, el: AnyNode, base: string): { candidates: SrcSetCandidate[]; attr: string | null } {
  for (const name of SRCSET_ATTRS) {
    const raw = attrOf($, el, name);
    if (!raw) continue;
    const candidates = parseSrcset(raw, base);
    if (candidates.length > 0) return { candidates, attr: name };
  }
  return { candidates: [], attr: null };
}

/** Declared-decorative: alt="" is the spec's own way to say "skip me", and role/aria-hidden say
 * the same thing. A decorative image with no alt is still a missing alt — only alt="" is a claim. */
function isDecorative($: CheerioAPI, el: AnyNode, alt: string | null): boolean {
  const role = lowerAttr($, el, "role");
  if (role === "presentation" || role === "none") return true;
  if (lowerAttr($, el, "aria-hidden") === "true") return true;
  return alt === "";
}

function pictureSourcesFor($: CheerioAPI, el: AnyNode, base: string): PictureSourceRecord[] {
  const picture = $(el).closest("picture");
  if (picture.length === 0) return [];
  const out: PictureSourceRecord[] = [];
  picture.children("source").each((_, sourceEl) => {
    const { candidates } = readSrcset($, sourceEl, base);
    const srcRaw = attrOf($, sourceEl, "src");
    const src = srcRaw ? (isDataUri(srcRaw) ? srcRaw : resolveAbsolute(srcRaw, base)) : null;
    if (candidates.length === 0 && src === null) return;
    out.push({
      srcset: candidates,
      src,
      media: attrOf($, sourceEl, "media"),
      type: lowerAttr($, sourceEl, "type"),
      sizes: attrOf($, sourceEl, "sizes"),
    });
  });
  return out;
}

function buildElementRecord(
  $: CheerioAPI,
  el: AnyNode,
  base: string,
  kind: "img" | "input-image"
): ImageRecord | null {
  const { candidates } = readSrcset($, el, base);
  const primary = pickPrimarySrc($, el, base, candidates);
  if (!primary) return null;

  const altAttr = $(el).attr("alt");
  const alt = altAttr === undefined ? null : altAttr;
  return {
    url: primary.url,
    alt,
    width: parseIntAttr($(el).attr("width")),
    height: parseIntAttr($(el).attr("height")),
    format: isDataUri(primary.url) ? dataUriFormat(primary.url) : extractFormat(primary.url),
    kind,
    source: primary.source,
    srcset: candidates,
    sizes: attrOf($, el, "sizes"),
    loading: lowerAttr($, el, "loading"),
    decoding: lowerAttr($, el, "decoding"),
    fetchPriority: lowerAttr($, el, "fetchpriority"),
    pictureSources: kind === "img" ? pictureSourcesFor($, el, base) : [],
    decorative: isDecorative($, el, alt),
  };
}

function dataUriFormat(uri: string): string | null {
  const m = /^data:image\/([a-z0-9.+-]+)/i.exec(uri.trim());
  if (!m || !m[1]) return null;
  const sub = m[1].toLowerCase();
  return sub === "svg+xml" ? "svg" : sub === "jpeg" ? "jpg" : sub;
}

/** Walks a stylesheet tracking brace depth so `@media { .a { … } }` yields `.a`, not the at-rule. */
function eachCssBlock(css: string, cb: (selector: string, body: string) => void): void {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const stack: string[] = [];
  let buf = "";
  for (const ch of text) {
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      const selector = stack.pop() ?? "";
      if (buf.trim()) cb(selector, buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
}

/** url() plus the quoted forms inside image-set()/-webkit-image-set(). */
function urlsInDeclaration(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    if (m[2]) out.push(m[2].trim());
  }
  for (const setMatch of value.matchAll(/-?(?:webkit-)?image-set\(([^)]*)\)/gi)) {
    for (const q of (setMatch[1] ?? "").matchAll(/['"]([^'"]+)['"]/g)) {
      if (q[1] && !out.includes(q[1])) out.push(q[1].trim());
    }
  }
  return out;
}

function backgroundsFromDeclarations(
  declarations: string,
  base: string,
  selector: string | null,
  seen: Set<string>,
  out: ImageRecord[]
): void {
  for (const decl of declarations.split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const property = decl.slice(0, colon).trim().toLowerCase();
    if (!CSS_IMAGE_PROPS.has(property)) continue;
    for (const raw of urlsInDeclaration(decl.slice(colon + 1))) {
      if (isDataUri(raw)) continue; // inlined bytes, not a fetchable asset — counted in the summary
      const url = resolveAbsolute(raw, base);
      if (url === null || seen.has(url)) continue;
      seen.add(url);
      out.push({
        url,
        alt: null,
        width: null,
        height: null,
        format: extractFormat(url),
        kind: "background",
        source: selector === null ? "style-attr" : "style-block",
        cssProperty: property,
        cssSelector: selector,
        decorative: false,
      });
    }
  }
}

/** CSS backgrounds (inline + <style> blocks) and <svg><use> sprite refs. Never alt-applicable. */
export function extractBackgroundImages($: CheerioAPI, base: string): ImageRecord[] {
  const out: ImageRecord[] = [];
  const seen = new Set<string>();

  $("[style]").each((_, el) => {
    const style = $(el).attr("style");
    if (style) backgroundsFromDeclarations(style, base, null, seen, out);
  });

  $("style").each((_, el) => {
    const css = $(el).text();
    if (!css) return;
    eachCssBlock(css, (selector, body) => backgroundsFromDeclarations(body, base, selector || null, seen, out));
  });

  $("use").each((_, el) => {
    const href = attrOf($, el, "href") ?? attrOf($, el, "xlink:href");
    // A bare "#icon" points inside this document — only an external sprite file is a real asset.
    if (!href || href.startsWith("#")) return;
    const url = resolveAbsolute(href.split("#")[0] ?? href, base);
    if (url === null || seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      alt: null,
      width: null,
      height: null,
      format: extractFormat(url),
      kind: "svg-use",
      source: "xlink:href",
      decorative: false,
    });
  });

  return out;
}

export interface ImageInventory {
  images: ImageRecord[];
  backgroundImages: ImageRecord[];
  summary: ImageSummary;
}

export function extractImageInventory($: CheerioAPI, base: string): ImageInventory {
  const images: ImageRecord[] = [];
  let dataUriCount = 0;
  let dataUriBytesTotal = 0;

  const collect = (el: AnyNode, kind: "img" | "input-image"): void => {
    const record = buildElementRecord($, el, base, kind);
    if (!record) return;
    if (isDataUri(record.url)) {
      dataUriCount++;
      dataUriBytesTotal += dataUriBytes(record.url);
      return; // kept out of images[] so a base64 blob never becomes a stored URL
    }
    images.push(record);
  };

  $("img").each((_, el) => collect(el, "img"));
  $('input[type="image"]').each((_, el) => collect(el, "input-image"));

  const backgroundImages = extractBackgroundImages($, base);

  for (const el of $("img").toArray()) {
    for (const c of parseSrcset($(el).attr("srcset"), base)) {
      if (isDataUri(c.url)) {
        dataUriCount++;
        dataUriBytesTotal += dataUriBytes(c.url);
      }
    }
  }

  return {
    images,
    backgroundImages,
    summary: summarizeImages(images, backgroundImages, dataUriCount, dataUriBytesTotal),
  };
}

export function summarizeImages(
  images: ImageRecord[],
  backgroundImages: ImageRecord[],
  dataUriCount = 0,
  dataUriBytesTotal = 0
): ImageSummary {
  return {
    total: images.length + backgroundImages.length,
    altApplicable: images.length,
    missingAlt: images.filter((i) => i.alt === null).length,
    emptyAlt: images.filter((i) => i.alt === "").length,
    decorative: images.filter((i) => i.decorative === true).length,
    withSrcset: images.filter((i) => (i.srcset?.length ?? 0) > 0).length,
    lazyLoaded: images.filter((i) => i.loading === "lazy").length,
    eagerLoaded: images.filter((i) => i.loading === "eager").length,
    pictureCount: images.filter((i) => (i.pictureSources?.length ?? 0) > 0).length,
    backgroundCount: backgroundImages.length,
    dataUriCount,
    dataUriBytes: dataUriBytesTotal,
  };
}

/** Back-compat entry point: alt-applicable elements only, same contract as before v4. */
export function extractImages($: CheerioAPI, base: string): ImageRecord[] {
  return extractImageInventory($, base).images;
}

/* ── asset probing (byte size + real header dimensions) ── */

export interface ImageProbeResponse {
  status: number;
  /** Lowercased header names. */
  headers: Record<string, string>;
  /** Body bytes read (usually only the requested prefix); null when none were read. */
  bytes: Uint8Array | null;
}

export type ImageFetcher = (
  url: string,
  init: { method: "GET" | "HEAD"; rangeBytes?: number }
) => Promise<ImageProbeResponse>;

export interface ImageProbeOptions {
  /** Required, with no fallback to global fetch, so a test can never hit the network by accident. */
  fetchImpl: ImageFetcher;
  /** Leading bytes to request — every header format we decode fits well inside the default. */
  headerBytes?: number;
}

const DEFAULT_HEADER_BYTES = 4096;

function parseContentRangeTotal(value: string | undefined): number | null {
  if (!value) return null;
  const m = /\/\s*(\d+)\s*$/.exec(value);
  return m && m[1] ? Number(m[1]) : null;
}

export function emptyAssetSize(sizeError: string): ImageAssetSize {
  return {
    bytes: null,
    byteSource: null,
    naturalWidth: null,
    naturalHeight: null,
    naturalSource: null,
    status: null,
    sizeError,
  };
}

/**
 * One ranged GET does double duty: it verifies the image resolves, returns the file header for
 * real-dimension decoding, and carries the full byte count in Content-Range — so the common case
 * costs a single request. HEAD is only the fallback when the server answered 200 without a length.
 */
export async function probeImageAsset(url: string, options: ImageProbeOptions): Promise<ImageAssetSize> {
  const headerBytes = options.headerBytes ?? DEFAULT_HEADER_BYTES;
  let res: ImageProbeResponse;
  try {
    res = await options.fetchImpl(url, { method: "GET", rangeBytes: headerBytes });
  } catch (err) {
    return emptyAssetSize(`fetch-failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (res.status < 200 || res.status >= 300) {
    return { ...emptyAssetSize(`http-${res.status}`), status: res.status };
  }

  const natural = res.bytes && res.bytes.length > 0 ? decodeImageDimensions(res.bytes) : null;
  let bytes = parseContentRangeTotal(res.headers["content-range"]);
  let byteSource: ImageAssetSize["byteSource"] = bytes === null ? null : "content-range";

  // content-length on a 206 is the length of the SLICE, not the file — only trust it on a 200.
  if (bytes === null && res.status === 200) {
    const cl = Number(res.headers["content-length"]);
    if (Number.isFinite(cl) && cl >= 0) {
      bytes = cl;
      byteSource = "content-length";
    }
  }

  if (bytes === null) {
    try {
      const head = await options.fetchImpl(url, { method: "HEAD" });
      const cl = Number(head.headers["content-length"]);
      if (head.status >= 200 && head.status < 300 && Number.isFinite(cl) && cl >= 0) {
        bytes = cl;
        byteSource = "content-length";
      }
    } catch {
      // HEAD is best-effort; the sizeError below still reports the real reason.
    }
  }

  return {
    bytes,
    byteSource,
    naturalWidth: natural?.width ?? null,
    naturalHeight: natural?.height ?? null,
    naturalSource: natural ? "header-decode" : null,
    status: res.status,
    sizeError: bytes === null ? "no-content-length-or-content-range" : null,
  };
}

/* ── computed-style background sweep (widest CSS-image sweep: external stylesheets + cascade +
   ::before/::after, none of which the regex-based extractBackgroundImages above can see) ── */

/**
 * Playwright-serializable: pass BY REFERENCE to `page.evaluate(collectComputedBackgroundsInPage, cap)`
 * — Playwright ships the function's own source text into the page. Must stay self-contained (no
 * closures over this module) and browser-only (DOM globals only). Critically, it must declare NO
 * named inner function/const-arrow bindings: tsx/esbuild wraps those in `__name(...)`, which does
 * not exist in the page and throws ReferenceError — this has bitten this repo before, silently.
 */
export function collectComputedBackgroundsInPage(cssScanLimit: number): ComputedBackgroundHit[] {
  const out: ComputedBackgroundHit[] = [];
  const props: ["background-image" | "border-image-source" | "mask-image" | "list-style-image", string][] = [
    ["background-image", "backgroundImage"],
    ["border-image-source", "borderImageSource"],
    ["mask-image", "maskImage"],
    ["list-style-image", "listStyleImage"],
  ];
  const all = document.body ? document.body.getElementsByTagName("*") : [];
  const scanned = Math.min(all.length, cssScanLimit);
  for (let i = 0; i < scanned; i++) {
    const el = all[i]!;
    for (const pseudo of [null, "::before", "::after"] as const) {
      let style: CSSStyleDeclaration | null;
      try {
        style = window.getComputedStyle(el, pseudo ?? undefined);
      } catch {
        style = null;
      }
      if (!style) continue;
      for (let p = 0; p < props.length; p++) {
        const propName = props[p]![0];
        const cssKey = props[p]![1];
        const value = (style as unknown as Record<string, string>)[cssKey];
        if (!value || value === "none") continue;
        for (const m of value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
          if (!m[1]) continue;
          const idPart = el.id ? "#" + el.id : "";
          const clsPart = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "";
          out.push({
            url: m[1],
            property: propName,
            pseudo,
            locator: el.tagName ? el.tagName.toLowerCase() + idPart + clsPart : null,
          });
        }
      }
    }
  }
  return out;
}

/** Folds computed-sweep hits into new background ImageRecords, deduped against what the static
 * regex parse (extractBackgroundImages) already found. Returns only the NEW records to append —
 * never mutates `existing`, matching this module's pure-function contract everywhere else. */
export function mergeComputedBackgroundImages(existing: ImageRecord[], hits: ComputedBackgroundHit[]): ImageRecord[] {
  const seen = new Set(existing.map((r) => r.url));
  const added: ImageRecord[] = [];
  for (const hit of hits) {
    if (isDataUri(hit.url) || seen.has(hit.url)) continue;
    try {
      new URL(hit.url); // computed styles resolve to absolute URLs already; this is a sanity guard only
    } catch {
      continue;
    }
    seen.add(hit.url);
    added.push({
      url: hit.url,
      alt: null,
      width: null,
      height: null,
      format: extractFormat(hit.url),
      kind: "background",
      source: "computed-style",
      cssProperty: hit.property,
      cssSelector: hit.locator,
      pseudoElement: hit.pseudo,
      decorative: false,
    });
  }
  return added;
}

/* ── network-observed images (catches canvas/CSS/JS-injected assets with no DOM node at all) ── */

/**
 * New ImageRecords for browser responses that matched neither a DOM `<img>`/`<picture>` reference
 * nor a background URL — the class of asset only a network-level observation can find. Matched on
 * exact URL only (never a partial/contains match), so a legitimate DOM image is never duplicated.
 * A non-2xx response is never recorded as a byte size — the same 404-body trap probeImageAsset guards.
 */
export function mergeNetworkObservedImages(
  images: ImageRecord[],
  backgroundImages: ImageRecord[],
  observed: NetworkObservedAsset[]
): ImageRecord[] {
  const known = new Set<string>();
  for (const r of images) known.add(r.url);
  for (const r of backgroundImages) known.add(r.url);
  const added: ImageRecord[] = [];

  for (const asset of observed) {
    if (!asset.url || known.has(asset.url) || isDataUri(asset.url)) continue;
    known.add(asset.url);
    const ok = asset.status >= 200 && asset.status < 300;
    added.push({
      url: asset.url,
      alt: null,
      width: null,
      height: null,
      format: extractFormat(asset.url),
      kind: "network",
      source: "network-response",
      networkContentType: asset.contentType,
      decorative: false,
      asset: {
        bytes: ok ? asset.bytes : null,
        byteSource: ok && asset.bytes !== null ? "browser-transfer" : null,
        naturalWidth: null,
        naturalHeight: null,
        naturalSource: null,
        status: asset.status,
        sizeError: ok ? (asset.bytes === null ? "browser-did-not-report-content-length" : null) : `http-${asset.status}`,
      },
    });
  }
  return added;
}
