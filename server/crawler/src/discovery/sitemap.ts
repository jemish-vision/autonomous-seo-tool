/** Slice S3 implements. */
import { gunzipSync } from "node:zlib";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type {
  RobotsInfo,
  SitemapFileRecord,
  SitemapImageEntry,
  SitemapLastmodTrust,
  SitemapNewsEntry,
  SitemapResult,
  SitemapUrlEntry,
  SitemapVideoEntry,
} from "../models/types";
import { DEFAULT_USER_AGENT, fetchWithTimeout, resolveAbsolute } from "./http";

const MAX_DEPTH = 5;
const MAX_ENTRIES = 50_000;
/** Decompression ceiling — a 20KB .gz can otherwise expand into gigabytes. */
const MAX_GUNZIP_BYTES = 64 * 1024 * 1024;

// url/sitemap/image/video forced to arrays so a single-entry file doesn't collapse to a bare object.
// parseTagValue off keeps <lastmod>/<priority>/<loc> as authored — a numeric-looking <loc> would
// otherwise arrive as a number and be dropped.
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === "url" || name === "sitemap" || name === "image:image" || name === "video:video",
});

// Atom carries the entry URL in <link href> — attributes have to survive for feeds.
const feedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  isArray: (name) => name === "item" || name === "entry" || name === "link",
});

/** W3C Datetime, the only <lastmod> format sitemaps.org permits. */
const W3C_DATETIME = /^\d{4}(-\d{2}(-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;

// Conventional locations tried when robots.txt declares nothing (or its declarations yield no URLs)
// — ordered by how common they are: plain, Yoast/WP-SEO, WordPress core, generic index.
const FALLBACK_SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml", "/sitemap-index.xml"];

// Last-resort discovery: a blog with no sitemap almost always still publishes a feed.
const FALLBACK_FEED_PATHS = ["/feed", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml", "/feed.json"];

export interface DiscoverSitemapOptions {
  /** Sent on every sitemap/feed fetch so side requests identify us the same way page fetches do. */
  userAgent?: string;
  /** Hosts that count as this site for cross-host accounting; defaults to the origin's host. */
  originHosts?: string[];
  /** Probe RSS/Atom/JSON feeds when no sitemap yields URLs. */
  feedFallback?: boolean;
  /** Reference time for the lastmod trust assessment; injected by tests. */
  now?: Date;
}

interface FetchedFile {
  statusCode: number | null;
  body: string | null;
  bytes: Uint8Array | null;
  contentType: string | null;
  gzipped: boolean;
  error: string | null;
}

/**
 * Discover sitemap URLs: robots.txt declarations first, then conventional paths, then feeds.
 * Recurses sitemap indexes. Never throws — fetch/parse problems land in result.errors/files.
 */
export async function discoverSitemaps(
  robots: RobotsInfo,
  origin: string,
  opts: DiscoverSitemapOptions = {},
): Promise<SitemapResult> {
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const feedFallback = opts.feedFallback !== false;
  const originHosts = new Set((opts.originHosts ?? [hostOf(origin)]).filter((h): h is string => h !== null));

  const entries: SitemapUrlEntry[] = [];
  const seenEntryUrls = new Set<string>();
  const files: SitemapFileRecord[] = [];
  const errors: string[] = [];
  const visited = new Set<string>();

  function isCrossHost(url: string): boolean {
    const host = hostOf(url);
    return host !== null && originHosts.size > 0 && !originHosts.has(host);
  }

  async function visit(rawUrl: string, depth: number): Promise<void> {
    const resolved = resolveAbsolute(rawUrl, origin);
    if (!resolved) {
      errors.push(`invalid sitemap URL: ${rawUrl}`);
      return;
    }
    if (visited.has(resolved)) return; // loop protection (also covers self-referencing indexes)
    visited.add(resolved);

    if (depth > MAX_DEPTH) {
      errors.push(`sitemap recursion depth exceeded at ${resolved}`);
      return;
    }
    if (entries.length >= MAX_ENTRIES) return;

    const crossHost = isCrossHost(resolved);
    const file = await fetchSitemapFile(resolved, userAgent);

    const base = (over: Partial<SitemapFileRecord>): SitemapFileRecord => ({
      url: resolved,
      statusCode: file.statusCode,
      kind: "unknown",
      urlCount: 0,
      error: null,
      gzipped: file.gzipped,
      crossHost,
      ...over,
    });

    if (file.error !== null || file.body === null) {
      files.push(base({ error: file.error }));
      if (file.error) errors.push(file.error);
      return;
    }

    const validation = XMLValidator.validate(file.body);
    if (validation !== true) {
      const msg = `malformed XML: ${validation.err.msg}`;
      files.push(base({ error: msg }));
      errors.push(msg);
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = xmlParser.parse(file.body);
    } catch (err) {
      const msg = `XML parse threw: ${err instanceof Error ? err.message : String(err)}`;
      files.push(base({ error: msg }));
      errors.push(msg);
      return;
    }

    // Presence, not truthiness: an empty <urlset></urlset> parses to "" and would otherwise be
    // misreported as "no root element" rather than the valid-but-empty sitemap it is.
    if ("urlset" in parsed) {
      const urlset = parsed.urlset as { url?: RawUrlNode[] } | string | null;
      const urls = (typeof urlset === "object" && urlset !== null ? urlset.url : undefined) ?? [];
      let count = 0;
      let crossHostUrlCount = 0;
      let imageCount = 0;
      let videoCount = 0;
      let newsCount = 0;
      for (const u of urls) {
        const loc = str(u?.loc);
        if (!loc) continue;
        count++;
        if (isCrossHost(loc)) crossHostUrlCount++;
        if (entries.length >= MAX_ENTRIES) continue;
        if (seenEntryUrls.has(loc)) continue;
        seenEntryUrls.add(loc);

        const images = parseImages(u);
        const videos = parseVideos(u);
        const news = parseNews(u);
        if (images) imageCount += images.length;
        if (videos) videoCount += videos.length;
        if (news) newsCount++;

        entries.push(
          compact<SitemapUrlEntry>({
            url: loc,
            sourceSitemap: resolved,
            lastmod: str(u.lastmod),
            changefreq: str(u.changefreq),
            priority: num(u.priority),
            images,
            videos,
            news,
          }),
        );
      }
      files.push(
        base({ kind: "urlset", urlCount: count, crossHostUrlCount, imageCount, videoCount, newsCount }),
      );
      return;
    }

    if ("sitemapindex" in parsed) {
      const sitemapindex = parsed.sitemapindex as { sitemap?: Array<{ loc?: unknown }> } | string | null;
      const children = (typeof sitemapindex === "object" && sitemapindex !== null ? sitemapindex.sitemap : undefined) ?? [];
      files.push(base({ kind: "index", urlCount: children.length }));
      for (const child of children) {
        const loc = str(child?.loc);
        if (!loc) continue;
        await visit(loc, depth + 1);
      }
      return;
    }

    files.push(base({ error: "no <urlset> or <sitemapindex> root element" }));
  }

  async function visitFeed(rawUrl: string): Promise<void> {
    const resolved = resolveAbsolute(rawUrl, origin);
    if (!resolved || visited.has(resolved)) return;
    visited.add(resolved);

    const crossHost = isCrossHost(resolved);
    const file = await fetchSitemapFile(resolved, userAgent);
    const base = (over: Partial<SitemapFileRecord>): SitemapFileRecord => ({
      url: resolved,
      statusCode: file.statusCode,
      kind: "unknown",
      urlCount: 0,
      error: null,
      gzipped: file.gzipped,
      crossHost,
      ...over,
    });

    if (file.error !== null || file.body === null) {
      files.push(base({ error: file.error }));
      if (file.error) errors.push(file.error);
      return;
    }

    const feed = parseFeed(file.body);
    if (!feed) {
      files.push(base({ error: "not a recognised RSS/Atom/JSON feed" }));
      return;
    }

    let count = 0;
    let crossHostUrlCount = 0;
    for (const raw of feed.links) {
      const abs = resolveAbsolute(raw, origin);
      if (!abs) continue;
      count++;
      if (isCrossHost(abs)) crossHostUrlCount++;
      if (entries.length >= MAX_ENTRIES) continue;
      if (seenEntryUrls.has(abs)) continue;
      seenEntryUrls.add(abs);
      entries.push({ url: abs, sourceSitemap: resolved, sourceKind: "feed" });
    }
    files.push(base({ kind: feed.kind, urlCount: count, crossHostUrlCount }));
  }

  for (const candidate of robots.sitemaps) {
    await visit(candidate, 0);
  }

  // Declared sitemaps that yield nothing (404, wrong host, empty) are indistinguishable from no
  // declaration at all — probe the conventional ladder rather than reporting "no sitemap".
  if (entries.length === 0) {
    for (const path of FALLBACK_SITEMAP_PATHS) {
      await visit(new URL(path, origin).toString(), 0);
      if (entries.length > 0) break; // later paths are alternatives, not additions
    }
  }

  if (entries.length === 0 && feedFallback) {
    for (const path of FALLBACK_FEED_PATHS) {
      await visitFeed(new URL(path, origin).toString());
      if (entries.length > 0) break;
    }
  }

  const crossHostEntryCount = entries.reduce((n, e) => n + (isCrossHost(e.url) ? 1 : 0), 0);
  return {
    entries,
    files,
    errors,
    crossHostEntryCount,
    lastmodTrust: assessLastmod(entries, opts.now ?? new Date()),
  };
}

interface RawUrlNode {
  loc?: unknown;
  lastmod?: unknown;
  changefreq?: unknown;
  priority?: unknown;
  "image:image"?: unknown;
  "video:video"?: unknown;
  "news:news"?: unknown;
}

// Only the conventional image:/video:/news: prefixes are read; a sitemap binding those namespaces
// to a different prefix is legal XML but vanishingly rare in the wild.
function parseImages(node: RawUrlNode): SitemapImageEntry[] | undefined {
  const raw = node["image:image"];
  if (!Array.isArray(raw)) return undefined;
  const out: SitemapImageEntry[] = [];
  for (const img of raw as Array<Record<string, unknown>>) {
    const loc = str(img?.["image:loc"]);
    if (!loc) continue;
    out.push(
      compact<SitemapImageEntry>({
        loc,
        title: str(img["image:title"]),
        caption: str(img["image:caption"]),
        geoLocation: str(img["image:geo_location"]),
        license: str(img["image:license"]),
      }),
    );
  }
  return out.length > 0 ? out : undefined;
}

function parseVideos(node: RawUrlNode): SitemapVideoEntry[] | undefined {
  const raw = node["video:video"];
  if (!Array.isArray(raw)) return undefined;
  const out: SitemapVideoEntry[] = [];
  for (const v of raw as Array<Record<string, unknown>>) {
    const entry = compact<SitemapVideoEntry>({
      thumbnailLoc: str(v?.["video:thumbnail_loc"]),
      title: str(v?.["video:title"]),
      description: str(v?.["video:description"]),
      contentLoc: str(v?.["video:content_loc"]),
      playerLoc: str(v?.["video:player_loc"]),
      duration: num(v?.["video:duration"]),
      publicationDate: str(v?.["video:publication_date"]),
      familyFriendly: str(v?.["video:family_friendly"]),
    });
    if (Object.keys(entry).length > 0) out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

function parseNews(node: RawUrlNode): SitemapNewsEntry | undefined {
  const raw = node["news:news"];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const news = raw as Record<string, unknown>;
  const pub = (news["news:publication"] ?? {}) as Record<string, unknown>;
  const entry = compact<SitemapNewsEntry>({
    publicationName: str(pub["news:name"]),
    publicationLanguage: str(pub["news:language"]),
    publicationDate: str(news["news:publication_date"]),
    title: str(news["news:title"]),
  });
  return Object.keys(entry).length > 0 ? entry : undefined;
}

interface ParsedFeed {
  kind: "rss" | "atom" | "jsonfeed";
  links: string[];
}

function parseFeed(body: string): ParsedFeed | null {
  const text = body.trim();
  if (text.startsWith("{")) return parseJsonFeed(text);
  if (XMLValidator.validate(text) !== true) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = feedParser.parse(text);
  } catch {
    return null;
  }

  const atom = parsed.feed as { entry?: Array<Record<string, unknown>> } | undefined;
  if (atom) {
    const links: string[] = [];
    for (const entry of atom.entry ?? []) {
      const href = atomEntryHref(entry);
      if (href) links.push(href);
    }
    return { kind: "atom", links };
  }

  const rssChannel = (parsed.rss as { channel?: { item?: Array<Record<string, unknown>> } } | undefined)?.channel;
  const rdfItems = (parsed["rdf:RDF"] as { item?: Array<Record<string, unknown>> } | undefined)?.item;
  const items = rssChannel?.item ?? rdfItems;
  if (items) {
    const links: string[] = [];
    for (const item of items) {
      const link = firstStr(item?.link) ?? permalinkGuid(item?.guid);
      if (link) links.push(link);
    }
    return { kind: "rss", links };
  }

  return null;
}

/** A feed value arrives as a string, an array (repeated element), or an object carrying attributes. */
function firstStr(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStr(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value !== null && typeof value === "object") return str((value as Record<string, unknown>)["#text"]);
  return str(value);
}

/** An RSS <guid> is only a URL when it is one — never turn an opaque id into a path to crawl. */
function permalinkGuid(value: unknown): string | undefined {
  const guid = firstStr(value);
  return guid !== undefined && /^https?:\/\//i.test(guid) ? guid : undefined;
}

/** Atom permits several <link>s per entry; the page URL is rel="alternate" (the spec default). */
function atomEntryHref(entry: Record<string, unknown>): string | null {
  const raw = entry?.link;
  const links = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  for (const link of links) {
    const rel = str(link?.["@_rel"]);
    if (rel !== undefined && rel !== "alternate") continue;
    const href = str(link?.["@_href"]);
    if (href) return href;
  }
  return str(entry?.id) ?? null;
}

function parseJsonFeed(text: string): ParsedFeed | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  const items = (doc as { items?: unknown })?.items;
  if (!Array.isArray(items)) return null;
  const links: string[] = [];
  for (const item of items as Array<Record<string, unknown>>) {
    const url = str(item?.url) ?? str(item?.id);
    if (url) links.push(url);
  }
  return { kind: "jsonfeed", links };
}

/** Counters only — what counts as "untrustworthy" is a rulebook decision, not a crawler one. */
function assessLastmod(entries: SitemapUrlEntry[], now: Date): SitemapLastmodTrust {
  const nowMs = now.getTime();
  const SKEW_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;

  const values: string[] = [];
  let invalid = 0;
  let future = 0;
  let withinLastHour = 0;
  let newestMs = Number.NEGATIVE_INFINITY;
  let oldestMs = Number.POSITIVE_INFINITY;
  let newest: string | null = null;
  let oldest: string | null = null;

  for (const entry of entries) {
    const lastmod = entry.lastmod;
    if (lastmod === undefined) continue;
    values.push(lastmod);

    const ms = W3C_DATETIME.test(lastmod) ? Date.parse(lastmod) : Number.NaN;
    if (Number.isNaN(ms)) {
      invalid++;
      continue;
    }
    if (ms > nowMs + SKEW_MS) future++;
    if (Math.abs(nowMs - ms) <= HOUR_MS) withinLastHour++;
    if (ms > newestMs) {
      newestMs = ms;
      newest = lastmod;
    }
    if (ms < oldestMs) {
      oldestMs = ms;
      oldest = lastmod;
    }
  }

  const withLastmod = values.length;
  const distinctValues = new Set(values).size;
  const allIdentical = withLastmod > 0 && distinctValues === 1;
  const dated = withLastmod - invalid;

  let verdict: SitemapLastmodTrust["verdict"] = "trustworthy";
  if (withLastmod === 0) verdict = "absent";
  else if (future > 0) verdict = "suspect-future";
  else if (invalid > 0) verdict = "suspect-invalid";
  else if (dated > 1 && withinLastHour === dated) verdict = "suspect-stamped-now";
  else if (withLastmod > 1 && allIdentical) verdict = "suspect-uniform";
  else if (withLastmod < entries.length) verdict = "partial";

  return {
    totalUrls: entries.length,
    withLastmod,
    invalid,
    distinctValues,
    future,
    withinLastHour,
    allIdentical,
    newest,
    oldest,
    verdict,
  };
}

async function fetchSitemapFile(url: string, userAgent: string): Promise<FetchedFile> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "user-agent": userAgent } });
    const raw = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type");
    if (res.status !== 200) {
      return {
        statusCode: res.status,
        body: null,
        bytes: raw,
        contentType,
        gzipped: false,
        error: `fetch failed: HTTP ${res.status}`,
      };
    }

    // Magic bytes, not the .gz suffix: undici transparently decodes Content-Encoding: gzip, so a
    // .gz URL can arrive already-plain, and a plain URL can serve a gzip body.
    const gzipped = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    let bytes = raw;
    if (gzipped) {
      try {
        bytes = new Uint8Array(gunzipSync(raw, { maxOutputLength: MAX_GUNZIP_BYTES }));
      } catch (err) {
        return {
          statusCode: res.status,
          body: null,
          bytes: raw,
          contentType,
          gzipped: true,
          error: `gzip decompression failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const body = Buffer.from(bytes).toString("utf-8").replace(/^﻿/, "");
    return { statusCode: res.status, body, bytes, contentType, gzipped, error: null };
  } catch (err) {
    return { statusCode: null, body: null, bytes: null, contentType: null, gzipped: false, error: describeError(err) };
  }
}

/** undici reports every transport failure as "fetch failed" — the cause is the only useful part. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : null;
  return detail ? `${err.message}: ${detail}` : err.message;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function str(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function num(value: unknown): number | undefined {
  const raw = str(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Drops undefined keys so absent optional fields never reach the stored JSON. */
function compact<T extends object>(obj: T): T {
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
  }
  return obj;
}
