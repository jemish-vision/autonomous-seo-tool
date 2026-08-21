import type { CheerioAPI } from "cheerio";
import type { SocialTags } from "../models/types";

const OG_PREFIX = "og:";
const TWITTER_PREFIX = "twitter:";

/**
 * og:* is spec'd via property=, twitter:* via name= — but pages routinely mix them up, so both
 * attrs are checked for both prefixes. Document order; first occurrence of a given key wins
 * (duplicate og:image tags etc. collapse onto one map entry — Record can't hold an ordered list).
 */
export function extractSocialTags($: CheerioAPI): SocialTags {
  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};

  $("meta").each((_, el) => {
    const $el = $(el);
    const content = $el.attr("content");
    if (content == null) return;
    const key = ($el.attr("property") ?? $el.attr("name") ?? "").toLowerCase();
    if (!key) return;

    if (key.startsWith(OG_PREFIX)) {
      if (!(key in og)) og[key] = content;
    } else if (key.startsWith(TWITTER_PREFIX)) {
      if (!(key in twitter)) twitter[key] = content;
    }
  });

  return { og, twitter };
}
