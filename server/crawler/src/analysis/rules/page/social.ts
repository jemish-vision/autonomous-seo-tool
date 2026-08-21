/** OpenGraph / Twitter card rule pack. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { issueFor } from "./shared";

function ogMissing(): PageRule {
  const meta: RuleMeta = {
    id: "og-missing",
    category: "social",
    defaultSeverity: "notice",
    description: "Page has no OpenGraph (og:*) tags.",
    howToFix: "Add og:title, og:description, and og:image for clean social-share previews.",
    dataRequirements: ["social"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.social === undefined) return null;
      if (Object.keys(page.social.og).length > 0) return [];
      return [issueFor(meta, config, page, { message: "No OpenGraph tags found.", evidence: [{ field: "social.og", value: page.social.og }] })];
    },
  };
}

function twitterMissing(): PageRule {
  const meta: RuleMeta = {
    id: "twitter-missing",
    category: "social",
    defaultSeverity: "notice",
    description: "Page has no Twitter card (twitter:*) tags.",
    howToFix: "Add twitter:card, twitter:title, and twitter:image for clean X/Twitter previews.",
    dataRequirements: ["social"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.social === undefined) return null;
      if (Object.keys(page.social.twitter).length > 0) return [];
      return [
        issueFor(meta, config, page, { message: "No Twitter card tags found.", evidence: [{ field: "social.twitter", value: page.social.twitter }] }),
      ];
    },
  };
}

// Keys are stored with the "og:" prefix intact (extraction/social.ts keys on the raw
// property/name attribute) — these are the four Jemish names as missing individually.
const OG_REQUIRED_KEYS = ["og:title", "og:description", "og:image", "og:url"];

function ogIncomplete(): PageRule {
  const meta: RuleMeta = {
    id: "og-incomplete",
    category: "social",
    defaultSeverity: "notice",
    description: "Page has some OpenGraph tags but is missing one of title/description/image/url — og-missing already covers the all-absent case.",
    howToFix: "Add the missing og: tag(s) so social shares render a complete preview.",
    dataRequirements: ["social"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.social === undefined) return null;
      const present = Object.keys(page.social.og);
      if (present.length === 0) return []; // og-missing's finding, not this one
      const missing = OG_REQUIRED_KEYS.filter((k) => !(k in page.social!.og));
      if (missing.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `OpenGraph tags present but missing: ${missing.join(", ")}.`,
          evidence: [{ field: "social.og", value: page.social.og }],
          threshold: `missing ${missing.length} of ${OG_REQUIRED_KEYS.join(", ")}`,
        }),
      ];
    },
  };
}

export function socialRules(): PageRule[] {
  return [ogMissing(), twitterMissing(), ogIncomplete()];
}
