/** Favicon declaration + resolution. Neither Screaming Frog nor Sitebulb surfaces this.
 * Two counterintuitive rules drive resolution: the HTML spec says the LAST equally-appropriate
 * icon in tree order wins (not the first), and a 404'd candidate falls through to the next —
 * so `effective` can only be known after probing, never from markup alone. Google's SERP
 * favicon eligibility is a wholly separate question from what the browser tab shows. */
import type { CheerioAPI } from "cheerio";
import type { FaviconReport, IconRecord } from "../models/types";
import { resolveAbsolute } from "./shared";

const ICON_REL_TOKENS = new Set(["icon", "apple-touch-icon", "apple-touch-icon-precomposed", "mask-icon"]);
const MSAPPLICATION_META_NAMES = new Set(["msapplication-tileimage", "msapplication-config"]);

export interface ManifestIconInput {
  src: string;
  sizes?: string;
  type?: string;
}

/**
 * Pure DOM/manifest parse — no network. `manifestIcons` is the already-fetched
 * manifest.json's `icons[]` (fetching the manifest is the caller's job; this module never
 * fetches anything in this path). Implicit /favicon.ico + /apple-touch-icon.png are always
 * appended at NEGATIVE index so a real declaration always outranks the guessed convention.
 */
export function extractFaviconCandidates(
  $: CheerioAPI,
  baseUrl: string,
  manifestIcons?: ManifestIconInput[] | null
): IconRecord[] {
  const out: IconRecord[] = [];
  let index = 0;

  $("link[rel]").each((_, el) => {
    const relRaw = $(el).attr("rel");
    if (!relRaw) return;
    const tokens = relRaw.toLowerCase().trim().split(/\s+/);
    if (!tokens.some((t) => ICON_REL_TOKENS.has(t))) return;
    const hrefRaw = $(el).attr("href");
    if (!hrefRaw || !hrefRaw.trim()) return;
    const href = resolveAbsolute(hrefRaw.trim(), baseUrl);
    if (href === null) return;
    out.push({
      rel: relRaw.trim(),
      href,
      declaredSizes: $(el).attr("sizes")?.trim() || null,
      type: $(el).attr("type")?.trim() || null,
      index: index++,
      source: "link",
    });
  });

  $("meta[name]").each((_, el) => {
    const rawName = $(el).attr("name") ?? "";
    if (!MSAPPLICATION_META_NAMES.has(rawName.toLowerCase())) return;
    const contentRaw = $(el).attr("content");
    if (!contentRaw || !contentRaw.trim()) return;
    // msapplication-config points at browserconfig.xml, not an image — actualSize just decodes
    // to null for it later, which is correct (kept for declaration-evidence completeness).
    const href = resolveAbsolute(contentRaw.trim(), baseUrl);
    if (href === null) return;
    out.push({ rel: rawName.trim(), href, declaredSizes: null, type: null, index: index++, source: "meta" });
  });

  if (manifestIcons && manifestIcons.length > 0) {
    // icons[].src resolves against the manifest file's own URL, not the page's — use the
    // declared <link rel=manifest> href as that base when present.
    const manifestHref = $('link[rel="manifest"]').first().attr("href")?.trim();
    const manifestBase = (manifestHref && resolveAbsolute(manifestHref, baseUrl)) || baseUrl;
    for (const icon of manifestIcons) {
      if (!icon || typeof icon.src !== "string" || !icon.src.trim()) continue; // tolerate malformed manifest entries
      const href = resolveAbsolute(icon.src.trim(), manifestBase);
      if (href === null) continue;
      out.push({
        rel: "icon",
        href,
        declaredSizes: icon.sizes?.trim() || null,
        type: icon.type?.trim() || null,
        index: index++,
        source: "manifest",
      });
    }
  }

  const implicitFavicon = resolveAbsolute("/favicon.ico", baseUrl);
  if (implicitFavicon) {
    out.push({ rel: "icon", href: implicitFavicon, declaredSizes: null, type: null, index: -1, source: "implicit" });
  }
  const implicitAppleTouch = resolveAbsolute("/apple-touch-icon.png", baseUrl);
  if (implicitAppleTouch) {
    out.push({
      rel: "apple-touch-icon",
      href: implicitAppleTouch,
      declaredSizes: null,
      type: null,
      index: -2,
      source: "implicit",
    });
  }

  return out;
}

/** Highest-index (last-declared) candidate; when `requireSuccess` it skips non-2xx ones,
 * implementing the fall-through rule. With no probe data yet it's a best-effort "most likely". */
function pickHighestPriority(candidates: IconRecord[], requireSuccess: boolean): IconRecord | null {
  const sorted = [...candidates].sort((a, b) => b.index - a.index);
  if (!requireSuccess) return sorted[0] ?? null;
  for (const c of sorted) {
    if (typeof c.status === "number" && c.status >= 200 && c.status < 300) return c;
  }
  return null;
}

function byteAt(bytes: Uint8Array, i: number): number {
  return bytes[i] ?? -1; // sentinel that can never equal a real byte value, keeps callers strict-mode clean
}

function decodePng(bytes: Uint8Array): { width: number; height: number } | null {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || SIG.some((b, i) => byteAt(bytes, i) !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function decodeGif(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10 || byteAt(bytes, 0) !== 0x47 || byteAt(bytes, 1) !== 0x49 || byteAt(bytes, 2) !== 0x46) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** .ico can hold multiple resolutions; we report the FIRST directory entry's size, not the largest. */
function decodeIco(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 22) return null;
  if (byteAt(bytes, 0) !== 0 || byteAt(bytes, 1) !== 0 || byteAt(bytes, 2) !== 1 || byteAt(bytes, 3) !== 0) return null;
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(4, true);
  if (count < 1) return null;
  const w = byteAt(bytes, 6);
  const h = byteAt(bytes, 7);
  return { width: w === 0 ? 256 : w, height: h === 0 ? 256 : h }; // 0 is the spec's encoding for 256
}

/** Scans JPEG markers for the first SOFn (frame header) rather than trusting any single fixed offset. */
function decodeJpeg(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || byteAt(bytes, 0) !== 0xff || byteAt(bytes, 1) !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (byteAt(bytes, offset) !== 0xff) return null;
    const marker = byteAt(bytes, offset + 1);
    offset += 2;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // markers with no length/payload
    if (marker === 0xd9) return null; // EOI, nothing found
    const segLen = view.getUint16(offset);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 7 > bytes.length) return null;
      const height = view.getUint16(offset + 3);
      const width = view.getUint16(offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (marker === 0xda) return null; // start of scan — no more headers follow
    offset += segLen;
  }
  return null;
}

/** RIFF/WEBP: three container variants (lossy VP8, lossless VP8L, extended VP8X) each store the
 * canvas size differently — and VP8L packs 14-bit dimensions across a 32-bit little-endian word. */
function decodeWebp(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const ascii = (i: number, n: number): string =>
    Array.from(bytes.slice(i, i + n), (b) => String.fromCharCode(b)).join("");
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = ascii(12, 4);

  if (chunk === "VP8X") {
    const w = 1 + (byteAt(bytes, 24) | (byteAt(bytes, 25) << 8) | (byteAt(bytes, 26) << 16));
    const h = 1 + (byteAt(bytes, 27) | (byteAt(bytes, 28) << 8) | (byteAt(bytes, 29) << 16));
    return w > 0 && h > 0 ? { width: w, height: h } : null;
  }
  if (chunk === "VP8L") {
    if (bytes.length < 25 || byteAt(bytes, 20) !== 0x2f) return null; // 0x2f = VP8L signature byte
    const bits = view.getUint32(21, true);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >> 14) & 0x3fff) + 1;
    return w > 0 && h > 0 ? { width: w, height: h } : null;
  }
  if (chunk === "VP8 ") {
    if (bytes.length < 30) return null;
    if (byteAt(bytes, 23) !== 0x9d || byteAt(bytes, 24) !== 0x01 || byteAt(bytes, 25) !== 0x2a) return null;
    const w = view.getUint16(26, true) & 0x3fff;
    const h = view.getUint16(28, true) & 0x3fff;
    return w > 0 && h > 0 ? { width: w, height: h } : null;
  }
  return null;
}

/** BMP height is signed — a negative value means a top-down bitmap, not a negative size. */
function decodeBmp(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 26 || byteAt(bytes, 0) !== 0x42 || byteAt(bytes, 1) !== 0x4d) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint32(14, true);
  if (headerSize < 40) {
    if (bytes.length < 22) return null;
    const w = view.getUint16(18, true);
    const h = view.getUint16(20, true);
    return w > 0 && h > 0 ? { width: w, height: h } : null;
  }
  const w = view.getInt32(18, true);
  const h = Math.abs(view.getInt32(22, true));
  return w > 0 && h > 0 ? { width: w, height: h } : null;
}

function decodeSvg(bytes: Uint8Array): { width: number; height: number } | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
  const tagMatch = /<svg\b[^>]*>/i.exec(text);
  if (!tagMatch) return null;
  const tag = tagMatch[0];

  const w = /(?:^|\s)width\s*=\s*["']?([\d.]+)(?:px)?["']?/i.exec(tag);
  const h = /(?:^|\s)height\s*=\s*["']?([\d.]+)(?:px)?["']?/i.exec(tag);
  if (w && h) {
    const width = Math.round(Number(w[1]));
    const height = Math.round(Number(h[1]));
    if (width > 0 && height > 0) return { width, height };
  }

  const vb = /viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(tag);
  if (vb) {
    const width = Math.round(Number(vb[1]));
    const height = Math.round(Number(vb[2]));
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

/** Declared `sizes=`/`width=` frequently lie — the decoded header is the valuable signal. Small
 * parser by design (no image library): PNG/GIF/ICO/JPEG/WebP/BMP via magic bytes, SVG via
 * viewBox/width/height. Also drives content-image sizing, not just favicons. */
export function decodeImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    return (
      decodePng(bytes) ??
      decodeGif(bytes) ??
      decodeIco(bytes) ??
      decodeJpeg(bytes) ??
      decodeWebp(bytes) ??
      decodeBmp(bytes) ??
      decodeSvg(bytes)
    );
  } catch {
    return null;
  }
}

export interface FaviconFetchResult {
  status: number;
  bytes: Uint8Array;
}

/** Reject only on genuine network failure (timeout/DNS/refused) — any received HTTP status,
 * including 404/500, must resolve so the fall-through logic can see it. */
export type FaviconFetcher = (url: string) => Promise<FaviconFetchResult>;

export interface ProbeOptions {
  /** Required (no silent default to global fetch) so tests can never accidentally hit the network. */
  fetchImpl: FaviconFetcher;
  timeoutMs?: number;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("favicon probe timeout")), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function probeOne(candidate: IconRecord, fetchImpl: FaviconFetcher, timeoutMs: number): Promise<IconRecord> {
  try {
    const res = await withTimeout(fetchImpl(candidate.href), timeoutMs);
    const ok = res.status >= 200 && res.status < 300;
    return { ...candidate, status: res.status, actualSize: ok ? decodeImageDimensions(res.bytes) : null };
  } catch {
    return { ...candidate, status: null, actualSize: null }; // network failure/timeout — distinct from "never probed"
  }
}

/**
 * Fetches exactly the given candidates (never more than were declared) to fill `status` +
 * decoded `actualSize`, then resolves `effective` via last-declared-wins with 404 fall-through.
 */
export async function probeFaviconCandidates(
  candidates: IconRecord[],
  options: ProbeOptions
): Promise<{ candidates: IconRecord[]; effective: string | null }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const probed = await Promise.all(candidates.map((c) => probeOne(c, options.fetchImpl, timeoutMs)));
  const winner = pickHighestPriority(probed, true);
  return { candidates: probed, effective: winner ? winner.href : null };
}

function parseDeclaredSize(sizes: string | null): { width: number; height: number } | null {
  if (!sizes) return null;
  const token = sizes.trim().split(/\s+/)[0];
  const m = token ? /^(\d+)x(\d+)$/i.exec(token) : null;
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** Content-hashed filenames are Google's documented anti-pattern for a stable favicon URL. */
function looksUnstable(url: string): boolean {
  try {
    const u = new URL(url);
    if (/[a-f0-9]{8,}\.[a-z0-9]+$/i.test(u.pathname)) return true;
    return /[?&](v|ver|version|hash|cache)=/i.test(u.search);
  } catch {
    return false;
  }
}

function isHomePagePath(pageUrl: string): boolean | null {
  try {
    const path = new URL(pageUrl).pathname;
    return path === "/" || path === "";
  } catch {
    return null;
  }
}

export interface SerpEligibilityContext {
  /** The actual crawled page URL — NOT the <base>-rewritten resolution base — since eligibility is home-page-only. */
  pageUrl: string;
  /** Two DISTINCT checks per Google's docs. Omit when robots.txt wasn't fetched — result stays null, never guessed. */
  checkGooglebotAccess?: (iconUrl: string) => boolean | null;
  checkGooglebotImageAccess?: (iconUrl: string) => boolean | null;
}

/**
 * Google SERP favicon eligibility — separate from what the browser tab shows. Deliberately does
 * NOT evaluate "one icon per hostname": that's a cross-page uniqueness check belonging to a
 * site-scope analysis rule (this module only ever sees one page at a time).
 */
export function assessGoogleSerpEligibility(
  candidates: IconRecord[],
  ctx: SerpEligibilityContext
): { googleSerpEligible: boolean | null; googleSerpBlockers: string[] } {
  const blockers: string[] = [];
  let hardFail = false;
  let unknown = false;

  const homePage = isHomePagePath(ctx.pageUrl);
  if (homePage === null) {
    unknown = true;
    blockers.push("page-url-unparseable");
  } else if (!homePage) {
    hardFail = true;
    blockers.push("not-home-page");
  }

  const hasLinkOrMeta = candidates.some((c) => c.source === "link" || c.source === "meta");
  const hasManifest = candidates.some((c) => c.source === "manifest");
  if (hasManifest && !hasLinkOrMeta) {
    hardFail = true;
    blockers.push("manifest-icons-ignored-by-google");
  }

  const best = pickHighestPriority(candidates, candidates.some((c) => c.status !== undefined));
  if (!best) {
    unknown = true;
    blockers.push("no-usable-icon-candidate");
  } else {
    const size = best.actualSize ?? parseDeclaredSize(best.declaredSizes);
    if (!size) {
      unknown = true;
      blockers.push("icon-dimensions-unknown");
    } else {
      if (size.width !== size.height) {
        hardFail = true;
        blockers.push("icon-not-square");
      }
      if (size.width < 8 || size.height < 8) {
        hardFail = true;
        blockers.push("icon-smaller-than-8x8");
      }
    }

    if (looksUnstable(best.href)) {
      hardFail = true;
      blockers.push("icon-url-looks-unstable");
    }

    const gbot = ctx.checkGooglebotAccess ? ctx.checkGooglebotAccess(best.href) : null;
    if (gbot === false) {
      hardFail = true;
      blockers.push("blocked-for-googlebot");
    } else if (gbot === null) {
      unknown = true;
      blockers.push("googlebot-access-unknown");
    }

    const gbotImg = ctx.checkGooglebotImageAccess ? ctx.checkGooglebotImageAccess(best.href) : null;
    if (gbotImg === false) {
      hardFail = true;
      blockers.push("blocked-for-googlebot-image");
    } else if (gbotImg === null) {
      unknown = true;
      blockers.push("googlebot-image-access-unknown");
    }
  }

  return { googleSerpEligible: hardFail ? false : unknown ? null : true, googleSerpBlockers: blockers };
}

/** Assembles the exact `FaviconReport` shape — usable on the pure path alone (effective: null,
 * pre-probe candidates) or after `probeFaviconCandidates`, with zero logic of its own. */
export function buildFaviconReport(
  candidates: IconRecord[],
  effective: string | null,
  eligibility: { googleSerpEligible: boolean | null; googleSerpBlockers: string[] }
): FaviconReport {
  return {
    candidates,
    effective,
    googleSerpEligible: eligibility.googleSerpEligible,
    googleSerpBlockers: eligibility.googleSerpBlockers,
  };
}
