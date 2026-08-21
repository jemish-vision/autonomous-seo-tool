/** Security-header notice rule pack. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { issueFor } from "./shared";

const ALWAYS_EXPECTED = ["content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy"];
const HSTS = "strict-transport-security";

function securityHeadersMissing(): PageRule {
  const meta: RuleMeta = {
    id: "security-headers-missing",
    category: "security",
    defaultSeverity: "notice",
    description: "Common security response headers are absent.",
    howToFix: "Set CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy (and HSTS on https) at the server/CDN.",
    dataRequirements: ["pageStats"],
  };
  return {
    meta,
    evaluate(page, config) {
      // `headers` itself is a v1 field, but pre-v2 crawls only kept a content-type/x-robots-tag
      // subset — there's no way to tell "not sent" from "not captured" on those old runs, so we
      // gate on pageStats (shipped in the same v2 wave that widened KEPT_HEADERS) as a proxy.
      if (page.pageStats === undefined) return null;
      const isHttps = (page.finalUrl ?? page.url).startsWith("https:");
      const expected = isHttps ? [...ALWAYS_EXPECTED, HSTS] : ALWAYS_EXPECTED;
      const missing = expected.filter((h) => !(h in page.headers));
      if (missing.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `Missing security headers: ${missing.join(", ")}.`,
          evidence: missing.map((h) => ({ field: `headers.${h}`, value: null })),
        }),
      ];
    },
  };
}

export function securityRules(): PageRule[] {
  return [securityHeadersMissing()];
}
