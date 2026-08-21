/**
 * Which recommendations can be written to a live site, and exactly what payload to send.
 *
 * Pure and dependency-free so it can be unit-tested directly — this mapping is where a wrong
 * answer silently corrupts a customer's page (a "mechanical" card's advice prose landing in the
 * page title), so it is not left implicit inside a component.
 */
import type { AiRecommendation } from "./types";

/** The connector's writable fields, keyed exactly as the WordPress plugin expects.
 *  kind "seo"     -> SEO-plugin meta (class-abstract-provider.php): title, description, og_*, ...
 *  kind "content" -> the post itself (class-content-writer.php): h1.
 *  kind "media"   -> an attachment (class-rest-api.php update_media): alt_text. */
export type SeoChanges = Record<string, string>;
export interface ApplyPlan {
  kind: "seo" | "content" | "media";
  changes: SeoChanges;
  /** Overrides the resolution target for the write. Alt text is written to the ATTACHMENT, so the
   *  connector must resolve the IMAGE url, not the page url the card otherwise sends. Absent for
   *  seo/content, where the page url is correct. */
  targetUrl?: string;
}

/** Deterministic src of the image markup generate.ts stores in currentValue/recommendedValue
 *  (`<img src="URL" ...>`), for image records written before the imageUrl field shipped. The attr
 *  is HTML-escaped there (& -> &amp;), so decode the one entity that can appear in a URL. */
function imageUrlFromMarkup(rec: AiRecommendation): string | null {
  const m = /<img\s[^>]*src="([^"]+)"/i.exec(rec.recommendedValue || rec.currentValue || "");
  if (!m) return null;
  return m[1]!.replace(/&amp;/g, "&");
}

/** Heading rules whose recommendedValuePlain is ONE exact heading string, so it can be written
 *  as-is. The rest of the `heading` category is deliberately excluded — h1-multiple (which of the
 *  H1s do you keep?) and heading-hierarchy-skip (where exactly does the intermediate heading go?)
 *  are judgment calls the prompt itself answers with needsHumanInput, heading-empty does not say
 *  WHICH heading is the empty one, and long-content-no-subheadings means inserting several H2s at
 *  chosen positions in the body. None of those is a single unambiguous value. */
const APPLYABLE_HEADING_RULES = new Set(["h1-missing", "title-h1-mismatch"]);

/** Maps a recommendation to the exact connector payload for it, or null when there is no safe
 *  auto-apply path.
 *
 *  Driven by `category` ONLY — never by ruleId string prefixes. A "mechanical" card's
 *  recommendedValuePlain is the rulebook's *advice prose* ("Add a unique <title> under 60
 *  characters."), not a field value, so prefix-matching its ruleId onto `title` used to write that
 *  sentence straight into the live page title. Categories not listed here are advisory prose with
 *  no value to write (content-brief, duplicate-content-rewrite, mechanical — word-count and
 *  "rewrite this section" guidance is exactly this), need markup the connector cannot place
 *  (structured-data, internal-link-anchor), or always abstain (canonical). */
export function changesForRecommendation(rec: AiRecommendation): ApplyPlan | null {
  if (rec.needsHumanInput) return null;
  const value = (rec.recommendedValuePlain || "").trim();
  if (!value) return null;

  switch (rec.category) {
    case "title":
      return { kind: "seo", changes: { title: value } };
    case "meta-description":
      return { kind: "seo", changes: { description: value } };
    case "image-alt": {
      // Alt text is the model's plain answer; it is written to the attachment resolved from the
      // image URL, never to the page. Prefer the first-class field; fall back to the stored markup.
      const imageUrl = rec.imageUrl ?? imageUrlFromMarkup(rec);
      if (!imageUrl) return null;
      return { kind: "media", changes: { alt_text: value }, targetUrl: imageUrl };
    }
    case "heading":
      // The heading prompt returns the heading text ONLY (no markup), which is exactly what the
      // content writer wants. It decides post_content vs post_title itself by inspecting the post.
      if (!APPLYABLE_HEADING_RULES.has(rec.issueRuleId)) return null;
      return { kind: "content", changes: { h1: value } };
    case "duplicate-content":
      // Two rules share this category and each rewrites a different field.
      return rec.issueRuleId === "duplicate-title"
        ? { kind: "seo", changes: { title: value } }
        : { kind: "seo", changes: { description: value } };
    case "social": {
      // generate.ts encodes the social answer as one compound string
      // ("og:title=... | og:description=..."), so it must be split before it can be written —
      // sending it whole put the literal "og:title=... | og:description=..." text into og_title.
      const m = /og:title=([\s\S]*?)\s*\|\s*og:description=([\s\S]*)/i.exec(value);
      if (!m) return null;
      const title = m[1]!.trim();
      const description = m[2]!.trim();
      if (!title || !description) return null;
      return { kind: "seo", changes: { og_title: title, og_description: description, twitter_title: title, twitter_description: description } };
    }
    default:
      return null;
  }
}
