/** Web-font rule pack over the v3 `fonts` report — privacy (third-party hosts) and the two
 * font-loading defects the extractor can prove from markup alone. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { capturedList, issueFor } from "./shared";

/** font-display values that leave text invisible while the font loads. `null` means the
 * @font-face lives in a stylesheet we never fetched — unknown, so never judged. */
const BLOCKING_DISPLAY = new Set(["block", "auto"]);

function fontPreloadMissingCrossorigin(): PageRule {
  const meta: RuleMeta = {
    id: "font-preload-missing-crossorigin",
    category: "performance",
    defaultSeverity: "warning",
    description: "A <link rel=preload as=font> has no crossorigin attribute. Fonts always fetch in anonymous CORS mode, so the preload never matches the real request and the file is downloaded twice.",
    howToFix: "Add crossorigin (or crossorigin=\"anonymous\") to every preload with as=\"font\".",
    dataRequirements: ["fonts"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!capturedList(page.fonts?.faces)) return null;
      const offenders = page.fonts.faces.map((f, i) => ({ f, i })).filter(({ f }) => f.preloadMissingCrossorigin);
      if (offenders.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `${offenders.length} font preload(s) missing crossorigin — each font is fetched twice.`,
          evidence: offenders.map(({ f, i }) => ({ field: `fonts.faces[${i}].source`, value: f.source })),
        }),
      ];
    },
  };
}

function fontDisplayBlocking(): PageRule {
  const meta: RuleMeta = {
    id: "font-display-blocking",
    category: "performance",
    defaultSeverity: "notice",
    description: "A @font-face uses font-display: block or auto, so text stays invisible until the font loads (FOIT). Lighthouse's own font-display audit passes `block`; it should not.",
    howToFix: "Use font-display: swap (or optional) so text renders immediately in a fallback face.",
    dataRequirements: ["fonts"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!capturedList(page.fonts?.faces)) return null;
      const offenders = page.fonts.faces
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => f.display !== null && BLOCKING_DISPLAY.has(f.display.toLowerCase()));
      if (offenders.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `${offenders.length} @font-face rule(s) use a text-blocking font-display: ${[...new Set(offenders.map(({ f }) => f.display))].join(", ")}.`,
          evidence: offenders.map(({ f, i }) => ({ field: `fonts.faces[${i}].display`, value: f.display })),
        }),
      ];
    },
  };
}

function thirdPartyFontHost(): PageRule {
  const meta: RuleMeta = {
    id: "third-party-font-host",
    category: "privacy",
    defaultSeverity: "notice",
    description: "Fonts are loaded from a different registrable domain, which discloses every visitor's IP address to that host. German courts have ruled this a GDPR violation for Google Fonts specifically.",
    howToFix: "Self-host the font files so no visitor IP leaves your own infrastructure.",
    dataRequirements: ["fonts"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!capturedList(page.fonts?.thirdPartyHosts)) return null;
      const hosts = page.fonts.thirdPartyHosts;
      if (hosts.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `Fonts load from ${hosts.length} third-party host(s): ${hosts.join(", ")}.`,
          evidence: [{ field: "fonts.thirdPartyHosts", value: hosts }],
        }),
      ];
    },
  };
}

export function fontRules(): PageRule[] {
  return [fontPreloadMissingCrossorigin(), fontDisplayBlocking(), thirdPartyFontHost()];
}
