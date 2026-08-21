/** Integration addition (A3+A4 both flagged the gap): manifest #15b/#15c — internal links
 * authored with mixed http/https schemes or mixed www/non-www hosts. Keyed on AUTHORED targets
 * (link.target) grouped per host family, so relative links (which inherit the page's own
 * scheme/host) can never false-fire the mix on a consistently-authored site. */
import type { Issue, IssueEvidence, RuleMeta } from "../../../models/types";
import { isRuleEnabled, pageIdFor, primaryUrl, resolvedSeverity } from "./helpers";
import type { SiteRule, SiteRuleContext } from "./types";

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

interface AuthoredLinkRef {
  scheme: string;
  host: string;
  evidence: IssueEvidence;
  sourceUrl: string;
}

/** Every internal link's authored target, parsed — grouped later by www-stripped host. */
function collectAuthoredInternal(ctx: SiteRuleContext): Map<string, AuthoredLinkRef[]> {
  const byFamily = new Map<string, AuthoredLinkRef[]>();
  for (const page of ctx.pages) {
    page.links.forEach((link, index) => {
      if (link.type !== "internal") return;
      let parsed: URL;
      try {
        parsed = new URL(link.target);
      } catch {
        return;
      }
      const family = stripWww(parsed.hostname.toLowerCase());
      const ref: AuthoredLinkRef = {
        scheme: parsed.protocol,
        host: parsed.hostname.toLowerCase(),
        evidence: { field: `links[${index}].target`, value: link.target, pageId: pageIdFor(page.normalizedUrl) },
        sourceUrl: primaryUrl(page),
      };
      const list = byFamily.get(family);
      if (list) list.push(ref);
      else byFamily.set(family, [ref]);
    });
  }
  return byFamily;
}

/** Cap evidence per finding — a large site could have thousands of consistent links. */
function sampleEvidence(refs: AuthoredLinkRef[], predicate: (r: AuthoredLinkRef) => boolean, cap = 5): IssueEvidence[] {
  return refs.filter(predicate).slice(0, cap).map((r) => r.evidence);
}

const schemeMixMeta: RuleMeta = {
  id: "internal-link-scheme-mix",
  category: "link-consistency",
  defaultSeverity: "warning",
  description: "The same internal host is linked with both http:// and https:// across the site.",
  howToFix: "Author every internal link with one scheme (https) so link equity and crawls don't split.",
  dataRequirements: ["links"],
};

export const internalLinkSchemeMixRule: SiteRule = {
  meta: schemeMixMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(schemeMixMeta.id, config)) return null;
    const severity = resolvedSeverity(schemeMixMeta.id, schemeMixMeta.defaultSeverity, config);
    const issues: Issue[] = [];
    for (const [family, refs] of collectAuthoredInternal(ctx)) {
      // Compare per exact host so the www-mix rule owns cross-host inconsistencies.
      const byHost = new Map<string, AuthoredLinkRef[]>();
      for (const r of refs) {
        const list = byHost.get(r.host);
        if (list) list.push(r);
        else byHost.set(r.host, [r]);
      }
      for (const [host, hostRefs] of byHost) {
        const schemes = new Set(hostRefs.map((r) => r.scheme));
        if (schemes.size < 2) continue;
        const httpRefs = hostRefs.filter((r) => r.scheme === "http:");
        const anchor = httpRefs[0] ?? hostRefs[0];
        if (!anchor) continue;
        issues.push({
          ruleId: schemeMixMeta.id,
          category: schemeMixMeta.category,
          severity,
          scope: "site",
          url: anchor.sourceUrl,
          pageId: anchor.evidence.pageId ?? null,
          message: `Internal links to ${host} are authored with both http:// and https:// (${hostRefs.length} links affected).`,
          howToFix: schemeMixMeta.howToFix,
          threshold: "one scheme per internal host",
          evidence: [
            ...sampleEvidence(hostRefs, (r) => r.scheme === "http:"),
            ...sampleEvidence(hostRefs, (r) => r.scheme === "https:"),
          ],
        });
      }
      void family;
    }
    return issues;
  },
};

const wwwMixMeta: RuleMeta = {
  id: "internal-link-www-mix",
  category: "link-consistency",
  defaultSeverity: "warning",
  description: "Internal links mix www and non-www hosts for the same domain.",
  howToFix: "Pick one canonical host (www or apex) and author every internal link against it.",
  dataRequirements: ["links"],
};

export const internalLinkWwwMixRule: SiteRule = {
  meta: wwwMixMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(wwwMixMeta.id, config)) return null;
    const severity = resolvedSeverity(wwwMixMeta.id, wwwMixMeta.defaultSeverity, config);
    const issues: Issue[] = [];
    for (const [family, refs] of collectAuthoredInternal(ctx)) {
      const hosts = new Set(refs.map((r) => r.host));
      const hasWww = [...hosts].some((h) => h.startsWith("www."));
      const hasBare = [...hosts].some((h) => !h.startsWith("www."));
      if (!hasWww || !hasBare) continue;
      const wwwRefs = refs.filter((r) => r.host.startsWith("www."));
      const anchor = wwwRefs[0] ?? refs[0];
      if (!anchor) continue;
      issues.push({
        ruleId: wwwMixMeta.id,
        category: wwwMixMeta.category,
        severity,
        scope: "site",
        url: anchor.sourceUrl,
        pageId: anchor.evidence.pageId ?? null,
        message: `Internal links to ${family} mix www and non-www hosts (${refs.length} links affected).`,
        howToFix: wwwMixMeta.howToFix,
        threshold: "one host variant per domain",
        evidence: [
          ...sampleEvidence(refs, (r) => r.host.startsWith("www.")),
          ...sampleEvidence(refs, (r) => !r.host.startsWith("www.")),
        ],
      });
    }
    return issues;
  },
};
