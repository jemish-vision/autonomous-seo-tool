/** <head> rule pack — viewport, charset, <base>, the effective head boundary and favicons.
 * Consumes the v3 extraction fields (headMeta/charset/baseHref/headBoundary/favicons), all of
 * which are undefined on pre-v3 runs and therefore skip rather than false-fire. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { captured, capturedList, issueFor } from "./shared";

function viewportMissing(): PageRule {
  const meta: RuleMeta = {
    id: "viewport-missing",
    category: "mobile",
    defaultSeverity: "warning",
    description: "Page has no <meta name=\"viewport\">, so mobile browsers render it at desktop width and zoom out.",
    howToFix: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to <head>.",
    dataRequirements: ["headMeta"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!captured(page.headMeta, "viewport")) return null;
      if (page.headMeta.viewport !== null) return [];
      return [
        issueFor(meta, config, page, {
          message: "No meta viewport tag.",
          evidence: [{ field: "headMeta.viewport", value: null }],
        }),
      ];
    },
  };
}

function viewportBlocksZoom(): PageRule {
  const meta: RuleMeta = {
    id: "viewport-blocks-zoom",
    category: "mobile",
    defaultSeverity: "warning",
    description: "Viewport disables pinch-zoom via user-scalable=no or maximum-scale below 2 — a WCAG 1.4.4 (Resize Text) failure.",
    howToFix: "Drop user-scalable=no and let maximum-scale reach at least 2 (or omit it).",
    dataRequirements: ["headMeta"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!captured(page.headMeta, "viewport", "viewportBlocksZoom")) return null;
      if (!page.headMeta.viewportBlocksZoom) return [];
      return [
        issueFor(meta, config, page, {
          message: `Viewport blocks zoom: "${page.headMeta.viewport ?? ""}".`,
          evidence: [
            { field: "headMeta.viewport", value: page.headMeta.viewport },
            { field: "headMeta.viewportBlocksZoom", value: true },
          ],
        }),
      ];
    },
  };
}

function charsetMissing(): PageRule {
  const meta: RuleMeta = {
    id: "charset-missing",
    category: "head",
    defaultSeverity: "warning",
    description: "No character encoding is declared by BOM, Content-Type header or <meta charset> — the browser has to guess, and guesses differ.",
    howToFix: "Send charset=utf-8 on the Content-Type header, or add <meta charset=\"utf-8\"> as the first element in <head>.",
    dataRequirements: ["charset"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!captured(page.charset, "value", "source")) return null;
      if (page.charset.value !== null) return [];
      return [
        issueFor(meta, config, page, {
          message: "No character encoding declared.",
          evidence: [
            { field: "charset.value", value: null },
            { field: "charset.source", value: null },
          ],
        }),
      ];
    },
  };
}

function charsetNotEffective(): PageRule {
  const meta: RuleMeta = {
    id: "charset-not-effective",
    category: "head",
    defaultSeverity: "warning",
    description: "A <meta charset> is declared but serializes past the 1024-byte prescan window, so it never takes effect — valid HTML that silently does nothing.",
    howToFix: "Move <meta charset> to the top of <head> (within the first 1024 bytes), or set the encoding on the Content-Type header.",
    dataRequirements: ["charset"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!captured(page.charset, "value", "effective", "metaOffset")) return null;
      const charset = page.charset;
      if (charset.value === null || charset.effective) return []; // absent entirely -> charset-missing
      return [
        issueFor(meta, config, page, {
          message: `Declared charset "${charset.value}" does not take effect (meta at byte ${charset.metaOffset ?? "unknown"}).`,
          evidence: [
            { field: "charset.metaOffset", value: charset.metaOffset },
            { field: "charset.effective", value: false },
          ],
          threshold: `meta charset must serialize within the first 1024 bytes (was ${charset.metaOffset ?? "not located"})`,
        }),
      ];
    },
  };
}

function baseHrefMultiple(): PageRule {
  const meta: RuleMeta = {
    id: "base-href-multiple",
    category: "head",
    defaultSeverity: "warning",
    description: "Page declares more than one <base href>. Per spec every one after the first is ignored, so the authored intent and the browser's behaviour diverge.",
    howToFix: "Keep exactly one <base href> (or none) in <head>.",
    dataRequirements: ["baseHref"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!captured(page.baseHref, "count", "href")) return null;
      if (page.baseHref.count <= 1) return [];
      return [
        issueFor(meta, config, page, {
          message: `${page.baseHref.count} <base href> tags found; only the first ("${page.baseHref.href ?? ""}") applies.`,
          evidence: [
            { field: "baseHref.count", value: page.baseHref.count },
            { field: "baseHref.href", value: page.baseHref.href },
          ],
        }),
      ];
    },
  };
}

function baseHrefCrossOrigin(): PageRule {
  const meta: RuleMeta = {
    id: "base-href-cross-origin",
    category: "head",
    defaultSeverity: "warning",
    description: "<base href> points at a different origin than the page, so every relative canonical, hreflang, icon and preload on the page silently resolves to that other host.",
    howToFix: "Point <base href> at this page's own origin, or remove it and use absolute URLs.",
    dataRequirements: ["baseHref"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!captured(page.baseHref, "href")) return null;
      const href = page.baseHref.href;
      if (href === null) return [];
      const self = page.finalUrl ?? page.url;
      let baseOrigin: string;
      let selfOrigin: string;
      try {
        baseOrigin = new URL(href, self).origin;
        selfOrigin = new URL(self).origin;
      } catch {
        return []; // unresolvable — don't claim a mismatch we can't prove
      }
      if (baseOrigin === selfOrigin) return [];
      return [
        issueFor(meta, config, page, {
          message: `<base href> resolves to ${baseOrigin}, not the page's own origin ${selfOrigin}.`,
          evidence: [
            { field: "baseHref.href", value: href },
            { field: page.finalUrl ? "finalUrl" : "url", value: self },
          ],
        }),
      ];
    },
  };
}

function headSignalStranded(): PageRule {
  const meta: RuleMeta = {
    id: "head-signal-stranded",
    category: "head",
    defaultSeverity: "warning",
    description:
      "SEO signals sit after the point where <head> was implicitly closed by an invalid element, and Google does not honour them there. " +
      "Only signals whose stranded verdict is honoured=false are reported — a body meta robots is explicitly respected and is not a finding.",
    howToFix: "Move the stranded tags above the element that closes <head> (typically a stray <div>, <img> or <noscript> wrapper).",
    dataRequirements: ["headBoundary"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!capturedList(page.headBoundary?.stranded)) return null;
      const boundary = page.headBoundary;
      const ignored = boundary.stranded.map((s, i) => ({ s, i })).filter(({ s }) => !s.honoured);
      if (ignored.length === 0) return [];
      const names = [...new Set(ignored.map(({ s }) => s.signal))];
      return [
        issueFor(meta, config, page, {
          message: `${ignored.length} SEO signal(s) are outside the effective <head> and ignored by Google: ${names.join(", ")}${boundary.closedBy ? ` (head closed by <${boundary.closedBy}>)` : ""}.`,
          evidence: [
            ...ignored.map(({ i }) => ({ field: `headBoundary.stranded[${i}]`, value: boundary.stranded[i] })),
            { field: "headBoundary.closedBy", value: boundary.closedBy },
            { field: "headBoundary.closedAtOffset", value: boundary.closedAtOffset },
          ],
        }),
      ];
    },
  };
}

function faviconNotDeclared(): PageRule {
  const meta: RuleMeta = {
    id: "favicon-not-declared",
    category: "head",
    defaultSeverity: "notice",
    description: "No favicon is declared by <link rel=icon>, an msapplication meta or a web manifest — clients fall back to guessing /favicon.ico.",
    howToFix: "Declare an explicit <link rel=\"icon\"> so the browser tab and Google's SERP favicon are not left to convention.",
    dataRequirements: ["favicons"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!capturedList(page.favicons?.candidates)) return null;
      // "implicit" candidates are the guessed /favicon.ico + /apple-touch-icon.png, never a declaration.
      const declared = page.favicons.candidates.filter((c) => c.source !== "implicit");
      if (declared.length > 0) return [];
      return [
        issueFor(meta, config, page, {
          message: "No favicon declared in the markup.",
          evidence: [{ field: "favicons.candidates", value: page.favicons.candidates.map((c) => c.source) }],
        }),
      ];
    },
  };
}

export function headRules(): PageRule[] {
  return [
    viewportMissing(),
    viewportBlocksZoom(),
    charsetMissing(),
    charsetNotEffective(),
    baseHrefMultiple(),
    baseHrefCrossOrigin(),
    headSignalStranded(),
    faviconNotDeclared(),
  ];
}
