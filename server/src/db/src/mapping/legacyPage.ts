/**
 * Maps the crawler's on-disk CrawledPage JSON (poc/seo-crawler-poc/src/models/types.ts
 * `CrawledPage`, read as `any` here — this package stays decoupled from the crawler's source so
 * neither side needs a build-time dependency on the other) into Prisma create-input fragments.
 *
 * Schema-tolerant by design (P5, PLAN-02-Data-Model.md §1): different runs on disk were written
 * by different extractor versions, so every field is read defensively and left NULL/omitted
 * when absent rather than defaulted to a fake zero.
 */

export interface MappedPage {
  page: Record<string, unknown>;
  content: Record<string, unknown> | null;
  links: Record<string, unknown>[];
  images: Record<string, unknown>[];
  media: Record<string, unknown>[];
  headings: Record<string, unknown>[];
  structuredData: Record<string, unknown>[];
  redirectHops: Record<string, unknown>[];
  capturedFields: string[];
}

/** Legacy on-disk records aren't schema-validated against our VarChar limits (P5 drift) — every
 * bounded column gets truncated defensively rather than letting a bulk insert abort mid-batch. */
function trunc(s: unknown, n: number): string | null {
  if (typeof s !== "string" || s.length === 0) return (s as string | null) ?? null;
  return s.slice(0, n);
}

function altState(alt: unknown): "MISSING" | "EMPTY" | "DESCRIBED" {
  if (alt === null || alt === undefined) return "MISSING";
  if (alt === "") return "EMPTY";
  return "DESCRIBED";
}

function firstPathSegment(urlStr: string): string | null {
  try {
    const seg = new URL(urlStr).pathname.split("/").filter(Boolean)[0];
    return seg ? seg.slice(0, 200) : null;
  } catch {
    return null;
  }
}

export function mapLegacyPage(args: {
  raw: any;
  pageKey: string;
  crawlId: string;
  projectId: string;
}): MappedPage {
  const { raw, pageKey, crawlId, projectId } = args;
  const capturedFields = Object.keys(raw);

  const headings = raw.headings ?? { h1: [], h2: [], h3: [] };
  const h1List: string[] = headings.h1 ?? [];
  const h2List: string[] = headings.h2 ?? [];
  const h3List: string[] = headings.h3 ?? [];

  const perf = raw.performance ?? {};
  const robots = raw.robots ?? {};
  const contentBlock = raw.content ?? {};

  let urlPath = "/";
  let host = "";
  try {
    const u = new URL(raw.url);
    urlPath = u.pathname;
    host = u.hostname.slice(0, 255);
  } catch {
    /* malformed URL on legacy data — leave defaults */
  }

  const page: Record<string, unknown> = {
    crawlId,
    projectId,
    pageKey,
    url: raw.url,
    normalizedUrl: raw.normalizedUrl,
    finalUrl: raw.finalUrl ?? null,
    urlPath,
    host,
    section: firstPathSegment(raw.url),
    urlLength: (raw.url ?? "").length,

    statusCode: raw.statusCode ?? null,
    contentType: raw.headers?.["content-type"]?.slice(0, 160) ?? null,
    depth: raw.crawl?.depth ?? 0,
    fetchedAt: raw.fetchedAt ? new Date(raw.fetchedAt) : new Date(),
    responseTimeMs: perf.responseTimeMs ?? null,
    parentUrl: raw.crawl?.parentUrl ?? null,
    discoverySources: raw.crawl?.discoverySources ?? [],

    redirectHops: Array.isArray(raw.redirectChain) ? raw.redirectChain.length : 0,

    canonical: raw.canonical ?? null,
    canonicalIsSelf: raw.canonical ? raw.canonical === raw.normalizedUrl : null,
    noindex: robots.noindex ?? false,
    nofollow: robots.nofollow ?? false,
    indexable: !(robots.noindex ?? false),
    robotsDirectives: Array.isArray(robots.meta) ? robots.meta : [],

    title: raw.title ?? null,
    titleLength: raw.title ? raw.title.length : null,
    titleCount: Array.isArray(raw.titles) ? raw.titles.length : raw.title ? 1 : 0,
    metaDescription: raw.metaDescription ?? null,
    metaDescriptionLength: raw.metaDescription ? raw.metaDescription.length : null,
    metaDescriptionCount: Array.isArray(raw.metaDescriptions)
      ? raw.metaDescriptions.length
      : raw.metaDescription
        ? 1
        : 0,
    metaKeywords: raw.metaKeywords ?? null,

    h1: h1List[0] ?? null,
    h1Count: h1List.length,
    h2Count: h2List.length,
    h3Count: h3List.length,
    headingCount: h1List.length + h2List.length + h3List.length,

    wordCount: contentBlock.wordCount ?? null,
    contentHash: contentBlock.contentHash ?? null,

    internalLinkCount: Array.isArray(raw.links)
      ? raw.links.filter((l: any) => l.type === "internal").length
      : 0,
    externalLinkCount: Array.isArray(raw.links)
      ? raw.links.filter((l: any) => l.type === "external").length
      : 0,

    imageCount: Array.isArray(raw.images) ? raw.images.length : 0,
    imagesMissingAlt: Array.isArray(raw.images)
      ? raw.images.filter((i: any) => i.alt === null || i.alt === undefined).length
      : 0,
    imagesEmptyAlt: Array.isArray(raw.images) ? raw.images.filter((i: any) => i.alt === "").length : 0,

    jsonLdBlockCount: Array.isArray(raw.structuredData) ? raw.structuredData.length : 0,
    structuredDataTypes: Array.isArray(raw.structuredData)
      ? [...new Set(raw.structuredData.flatMap((s: any) => s.types ?? []))]
      : [],

    renderedWith: raw.renderedWith === "playwright" ? "BROWSER" : "HTTP",
    renderRequested: raw.renderedWith === "playwright",
    renderSignals: Array.isArray(raw.renderSignals) ? raw.renderSignals : [],
    likelyClientRendered: (raw.renderSignals ?? []).some((s: string) => s.startsWith("likely-client")),

    isHttps: (raw.url ?? "").startsWith("https://"),

    httpDetail: { headers: raw.headers ?? {}, performance: raw.performance ?? {} },
    indexingDetail: { robots },
    renderDetail: raw.renderDivergence !== undefined ? { renderDivergence: raw.renderDivergence } : null,

    // --- rich page-detail JSONB (blocker-A fidelity) -------------------------------------------
    // The reductive projection above drops several deep extraction blocks the detail screen renders
    // (OG/Twitter/SERP meta, favicons, document outline, fonts, charset, head boundary, base href).
    // Persist them verbatim into the reserved JSONB columns so the read side (crawl/readStore.ts)
    // can reconstruct the exact CrawledPage shape. Mapping (documented, stable):
    //   headDetail    = { headMeta, headBoundary, charset, baseHref, favicons }  — all <head>-derived
    //   contentDetail = { structure }                                            — document outline
    //   assetsDetail  = { fonts }                                                — font usage
    // Each column stays NULL when the extractor produced nothing (P5 three-state contract).
    headDetail: pickDefined({
      headMeta: raw.headMeta,
      headBoundary: raw.headBoundary,
      charset: raw.charset,
      baseHref: raw.baseHref,
      favicons: raw.favicons,
    }),
    contentDetail: raw.structure !== undefined ? { structure: raw.structure } : null,
    assetsDetail: raw.fonts !== undefined ? { fonts: raw.fonts } : null,
  };

  const content: Record<string, unknown> | null = contentBlock.text
    ? {
        pageId: "", // filled by caller once Page.id is known (create happens in one batch)
        crawlId,
        projectId,
        text: contentBlock.text,
        firstWords: String(contentBlock.text).split(/\s+/).slice(0, 150).join(" "),
      }
    : null;

  const links = Array.isArray(raw.links)
    ? raw.links.map((l: any, i: number) => ({
        crawlId,
        projectId,
        pageId: "",
        position: i,
        rawHref: l.target ?? null,
        targetUrl: l.target,
        targetNormalized: l.targetNormalized ?? null,
        targetHost: safeHost(l.target),
        anchor: l.anchor ?? null,
        kind: "ANCHOR",
        scope: l.type === "external" ? "EXTERNAL" : "INTERNAL",
        rel: trunc(l.rel, 200),
        nofollow: l.nofollow ?? false,
        sponsored: l.sponsored ?? false,
        ugc: l.ugc ?? false,
        targetAttr: trunc(l.targetAttr, 40),
      }))
    : [];

  const images = Array.isArray(raw.images)
    ? raw.images.map((im: any, i: number) => ({
        crawlId,
        projectId,
        pageId: "",
        position: i,
        rawSrc: im.url ?? null,
        url: im.url ?? null,
        alt: im.alt ?? null,
        altState: altState(im.alt),
        declaredWidth: im.width ?? null,
        declaredHeight: im.height ?? null,
        format: trunc(im.format, 20),
        source: "IMG",
      }))
    : [];

  const media = Array.isArray(raw.videos)
    ? raw.videos.map((v: any) => ({
        crawlId,
        projectId,
        pageId: "",
        position: 0,
        // Crawler VideoRecord uses `kind`; tolerate the older `type` alias too.
        kind: mediaKind(v.kind ?? v.type),
        url: v.url ?? v.src ?? "",
        poster: v.poster ?? null,
        mimeType: trunc(v.mimeType, 120),
        providerId: trunc(v.providerId, 120),
      }))
    : [];

  // `inMain` lives only on the richer document outline (raw.structure.headings), never on the flat
  // h1/h2/h3 text arrays. Both are DOM-ordered, so match per level by sequential position.
  const structHeadings: any[] = Array.isArray(raw.structure?.headings) ? raw.structure.headings : [];
  const inMainByLevel = new Map<number, boolean[]>();
  for (const sh of structHeadings) {
    const q = inMainByLevel.get(sh.level) ?? [];
    q.push(!!sh.inMain);
    inMainByLevel.set(sh.level, q);
  }
  const inMainCursor = new Map<number, number>();

  const headingRows: Record<string, unknown>[] = [];
  let pos = 0;
  for (const [level, list] of [[1, h1List] as const, [2, h2List] as const, [3, h3List] as const]) {
    for (const text of list) {
      const cursor = inMainCursor.get(level) ?? 0;
      const q = inMainByLevel.get(level);
      const inMain = q !== undefined && cursor < q.length ? q[cursor] : false;
      inMainCursor.set(level, cursor + 1);
      headingRows.push({ crawlId, projectId, pageId: "", level, text, position: pos++, inMain, isEmpty: text.trim() === "" });
    }
  }

  const structuredData = Array.isArray(raw.structuredData)
    ? raw.structuredData.map((sd: any, i: number) => ({
        crawlId,
        projectId,
        pageId: "",
        position: i,
        format: "JSON_LD",
        types: sd.types ?? [],
        valid: sd.valid ?? true,
        raw: sd.raw ? String(sd.raw).slice(0, 200_000) : null,
        parsed: sd.parsed ?? sd.data ?? null,
        parseError: sd.parseError ?? null,
      }))
    : [];

  const redirectHops = Array.isArray(raw.redirectChain)
    ? raw.redirectChain.map((r: any, i: number) => ({
        crawlId,
        projectId,
        pageId: "",
        hopIndex: i,
        fromUrl: r.from ?? r.url ?? "",
        toUrl: r.to ?? null,
        statusCode: r.statusCode ?? 0,
      }))
    : [];

  return { page, content, links, images, media, headings: headingRows, structuredData, redirectHops, capturedFields };
}

/** Assembles an object of only the DEFINED keys; returns null when every value is absent, so a
 *  JSONB detail column stays NULL ("not captured") instead of storing an empty husk (P5). */
function pickDefined(obj: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length > 0 ? out : null;
}

function safeHost(u: string | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u).hostname.slice(0, 255);
  } catch {
    return null;
  }
}

function mediaKind(t: string | undefined): string {
  const known = ["VIDEO", "AUDIO", "EMBED", "OBJECT", "IFRAME", "YOUTUBE", "VIMEO", "FILE"];
  const up = (t ?? "").toUpperCase();
  return known.includes(up) ? up : "FILE";
}
