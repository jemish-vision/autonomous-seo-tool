/** Transport-security rule pack: the page's own scheme, and http subresources on an https page. */
import type { CrawledPage, IssueEvidence, RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { capturedList, issueFor } from "./shared";

/** W3C Secure Contexts counts loopback as "potentially trustworthy" — a dev server on
 * http://localhost is not an HTTPS defect and reporting it would be a false positive. */
function isPotentiallyTrustworthy(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function pageNotHttps(): PageRule {
  const meta: RuleMeta = {
    id: "page-not-https",
    category: "security",
    defaultSeverity: "error",
    description: "Page is served over plain HTTP. HTTPS is a confirmed Google ranking signal and browsers label http pages \"Not Secure\".",
    howToFix: "Serve the page over HTTPS and 301-redirect the http URL to it.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const target = page.finalUrl ?? page.url;
      let parsed: URL;
      try {
        parsed = new URL(target);
      } catch {
        return [];
      }
      if (parsed.protocol !== "http:" || isPotentiallyTrustworthy(parsed.hostname)) return [];
      return [
        issueFor(meta, config, page, {
          message: "Page is served over http, not https.",
          evidence: [{ field: page.finalUrl ? "finalUrl" : "url", value: target }],
        }),
      ];
    },
  };
}

/** Subresources the record actually holds. Scripts/stylesheets are not extracted, so this rule
 * under-reports rather than guesses — a missing finding beats a fabricated one. */
function httpSubresources(page: CrawledPage): IssueEvidence[] {
  const found: IssueEvidence[] = [];
  const add = (field: string, value: string | null) => {
    if (value && value.toLowerCase().startsWith("http://")) found.push({ field, value });
  };
  page.images.forEach((img, i) => add(`images[${i}].url`, img.url));
  // Each source is optional on older runs; a missing one narrows coverage, it never blocks
  // the check, because images[] alone already answers "is anything loaded over http".
  if (capturedList(page.videos)) {
    page.videos.forEach((video, i) => {
      add(`videos[${i}].url`, video.url);
      add(`videos[${i}].poster`, video.poster);
    });
  }
  if (capturedList(page.fonts?.faces)) {
    page.fonts.faces.forEach((face, i) => add(`fonts.faces[${i}].source`, face.source));
  }
  // Implicit favicon candidates are synthesized from the page URL, never observed — excluded.
  if (capturedList(page.favicons?.candidates)) {
    page.favicons.candidates.forEach((icon, i) => {
      if (icon.source !== "implicit") add(`favicons.candidates[${i}].href`, icon.href);
    });
  }
  return found;
}

function mixedContent(): PageRule {
  const meta: RuleMeta = {
    id: "mixed-content",
    category: "security",
    defaultSeverity: "warning",
    description: "An https page references subresources over plain http. Browsers upgrade or block them, so the asset may silently fail to load.",
    howToFix: "Rewrite the subresource URLs to https (or protocol-relative) so nothing is fetched over http.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!capturedList(page.images)) return null; // the one always-present subresource class
      const target = page.finalUrl ?? page.url;
      if (!target.toLowerCase().startsWith("https://")) return [];
      const offenders = httpSubresources(page);
      if (offenders.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `${offenders.length} subresource(s) are referenced over http on an https page.`,
          evidence: offenders,
        }),
      ];
    },
  };
}

// Kishan's exact literal (500 KB) for the equivalent site-rule; Jemish/Nayan use higher
// browser-weight bucket sizes that aren't comparable to a static-HTML byte count.
const DEFAULT_OVERSIZED_HTML_BYTES = 512000;

function oversizedHtml(): PageRule {
  const meta: RuleMeta = {
    id: "oversized-html",
    category: "performance",
    defaultSeverity: "warning",
    description: "The HTML document itself (before subresources) is unusually large, slowing parse and download on every visit.",
    howToFix: "Trim boilerplate markup, paginate long listings, or move large inline data out of the document.",
    dataRequirements: ["pageStats"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.pageStats === undefined) return null;
      const maxBytes = config.thresholds.oversizedHtmlBytes ?? DEFAULT_OVERSIZED_HTML_BYTES;
      if (page.pageStats.htmlBytes <= maxBytes) return [];
      return [
        issueFor(meta, config, page, {
          message: `HTML document is ${(page.pageStats.htmlBytes / 1024).toFixed(0)} KB.`,
          evidence: [{ field: "pageStats.htmlBytes", value: page.pageStats.htmlBytes }],
          threshold: `htmlBytes ${page.pageStats.htmlBytes} > max ${maxBytes}`,
        }),
      ];
    },
  };
}

export function transportRules(): PageRule[] {
  return [pageNotHttps(), mixedContent(), oversizedHtml()];
}
