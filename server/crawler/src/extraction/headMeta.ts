/**
 * Full head-metadata extraction: OG/Twitter as an ordered stream (not a flat dictionary),
 * viewport zoom-blocking, and site-verification tokens. Supersedes social.ts's simpler map —
 * see that file for the property/name-mixing precedent this module extends to twitter:* too.
 */
import type { CheerioAPI } from "cheerio";
import type { HeadMetaReport, MetaTagRecord, OgImageRecord } from "../models/types";
import { parseIntAttr } from "./shared";

const OG_IMAGE_SUBPROP_PREFIX = "og:image:";

/** name= tags (most providers) but Pinterest's is property=p:domain_verify — key lookup covers both. */
const VERIFICATION_PROVIDERS: Record<string, string> = {
  "google-site-verification": "google",
  "msvalidate.01": "bing",
  "p:domain_verify": "pinterest",
  "facebook-domain-verification": "facebook",
  "yandex-verification": "yandex",
  "norton-safeweb-site-verification": "norton-safeweb",
  "ahrefs-site-verification": "ahrefs",
};

/** Viewport content is comma/semicolon-separated key=value pairs per the CSS Device Adaptation spec. */
function parseViewportPairs(content: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  const re = /([a-zA-Z_-]+)\s*=\s*([^,;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const key = m[1]!.trim().toLowerCase();
    if (key) pairs[key] = m[2]!.trim().toLowerCase();
  }
  return pairs;
}

/** WCAG 1.4.4: user-scalable=no, or maximum-scale below 2 (200% zoom), blocks pinch-zoom. */
function computeViewportBlocksZoom(viewport: string | null): boolean {
  if (!viewport) return false;
  const pairs = parseViewportPairs(viewport);
  if (pairs["user-scalable"] === "no" || pairs["user-scalable"] === "0") return true;
  const maxScale = Number(pairs["maximum-scale"]);
  return Number.isFinite(maxScale) && maxScale < 2;
}

/**
 * Ordered-stream OG/Twitter parse + viewport/verification facts. Never throws on malformed
 * markup or missing <head>. Values are kept as-authored (no URL resolution) — the caller
 * resolves og:image/twitter:image against its own base if it needs absolute URLs.
 */
export function extractHeadMeta($: CheerioAPI): HeadMetaReport {
  const tags: MetaTagRecord[] = [];
  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  const ogImages: OgImageRecord[] = [];
  const verification: Record<string, string> = {};
  let viewport: string | null = null;
  let themeColor: string | null = null;
  let colorScheme: string | null = null;
  let referrer: string | null = null;
  let generator: string | null = null;
  // The image sub-properties (width/height/alt/...) bind to whichever og:image root came last.
  let currentImage: OgImageRecord | null = null;

  $("meta").each((i, el) => {
    const $el = $(el);
    const inHead = $el.parents("head").length > 0;

    const charsetAttr = $el.attr("charset");
    let attr: MetaTagRecord["attr"];
    let key: string;
    let value: string;

    if (charsetAttr != null && charsetAttr.trim()) {
      attr = "charset";
      key = "charset";
      value = charsetAttr.trim();
    } else {
      const content = $el.attr("content");
      if (content == null) return; // no content attribute — nothing to record

      const httpEquivAttr = $el.attr("http-equiv");
      const propertyAttr = $el.attr("property");
      const nameAttr = $el.attr("name");
      const itempropAttr = $el.attr("itemprop");

      if (httpEquivAttr != null && httpEquivAttr.trim()) {
        attr = "http-equiv";
        key = httpEquivAttr.trim().toLowerCase();
      } else if (propertyAttr != null && propertyAttr.trim()) {
        attr = "property";
        key = propertyAttr.trim().toLowerCase();
      } else if (nameAttr != null && nameAttr.trim()) {
        attr = "name";
        key = nameAttr.trim().toLowerCase();
      } else if (itempropAttr != null && itempropAttr.trim()) {
        attr = "itemprop";
        key = itempropAttr.trim().toLowerCase();
      } else {
        return; // no identifying attribute at all
      }
      value = content;
    }

    tags.push({ attr, key, value, index: i, inHead });

    if (key.startsWith("og:")) {
      if (!(key in og)) og[key] = value; // OG: first occurrence wins

      if (key === "og:image") {
        currentImage = { url: value };
        ogImages.push(currentImage);
      } else if (key === "og:image:url") {
        if (currentImage) currentImage.url = value;
        else {
          currentImage = { url: value };
          ogImages.push(currentImage);
        }
      } else if (key.startsWith(OG_IMAGE_SUBPROP_PREFIX) && currentImage) {
        if (key === "og:image:width") {
          const n = parseIntAttr(value);
          if (n != null) currentImage.width = n;
        } else if (key === "og:image:height") {
          const n = parseIntAttr(value);
          if (n != null) currentImage.height = n;
        } else if (key === "og:image:alt") {
          currentImage.alt = value;
        } else if (key === "og:image:type") {
          currentImage.type = value;
        } else if (key === "og:image:secure_url") {
          currentImage.secureUrl = value;
        }
      }
      return;
    }

    if (key.startsWith("twitter:")) {
      twitter[key] = value; // Twitter: last occurrence wins — plain overwrite in document order
      return;
    }

    if (key in VERIFICATION_PROVIDERS) {
      const provider = VERIFICATION_PROVIDERS[key]!;
      if (!(provider in verification)) verification[provider] = value; // first token per provider
      return;
    }

    if (key === "viewport" && viewport === null) viewport = value;
    else if (key === "theme-color" && themeColor === null) themeColor = value;
    else if (key === "color-scheme" && colorScheme === null) colorScheme = value;
    else if (key === "referrer" && referrer === null) referrer = value;
    else if (key === "generator" && generator === null) generator = value;
  });

  return {
    tags,
    og,
    twitter,
    ogImages,
    viewport,
    viewportBlocksZoom: computeViewportBlocksZoom(viewport),
    themeColor,
    colorScheme,
    referrer,
    generator,
    verification,
  };
}
