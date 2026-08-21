/** Cross-page favicon consistency. src/extraction/favicons.ts deliberately leaves the
 * "one icon per hostname" question to site scope — the extractor only ever sees one page. */
import type { CrawledPage, IconRecord, Issue, RuleMeta } from "../../../models/types";
import { isRuleEnabled, pageIdFor, primaryUrl, resolvedSeverity } from "./helpers";
import { capturedList } from "../page/shared";
import type { SiteRule } from "./types";

/** Spec resolution order: the LAST declared icon in tree order wins. Implicit candidates are
 * guesses the extractor synthesizes, not declarations, so they never decide the winner. */
function declaredWinner(page: CrawledPage): IconRecord | null {
  if (!capturedList(page.favicons?.candidates)) return null;
  const declared = page.favicons.candidates.filter((c) => c.source !== "implicit");
  if (declared.length === 0) return null;
  return [...declared].sort((a, b) => b.index - a.index)[0] ?? null;
}

function hostOf(page: CrawledPage): string | null {
  try {
    return new URL(primaryUrl(page)).host;
  } catch {
    return null;
  }
}

const faviconInconsistentMeta: RuleMeta = {
  id: "favicon-inconsistent",
  category: "head",
  defaultSeverity: "notice",
  description:
    "Pages on the same host declare different favicons. Google indexes one favicon per hostname, so a per-page icon " +
    "is resolved unpredictably and the SERP result may show an icon no page intended.",
  howToFix: "Declare the same icon on every page of the host.",
  dataRequirements: ["favicons"],
};

export const faviconInconsistentRule: SiteRule = {
  meta: faviconInconsistentMeta,
  evaluate(ctx, config) {
    if (!isRuleEnabled(faviconInconsistentMeta.id, config)) return null;
    const withFavicons = ctx.pages.filter((p) => capturedList(p.favicons?.candidates));
    if (withFavicons.length === 0) return null;
    const severity = resolvedSeverity(faviconInconsistentMeta.id, faviconInconsistentMeta.defaultSeverity, config);

    const byHost = new Map<string, { page: CrawledPage; href: string }[]>();
    for (const page of withFavicons) {
      const host = hostOf(page);
      const winner = declaredWinner(page);
      if (host === null || winner === null) continue; // undeclared is favicon-not-declared's finding
      const list = byHost.get(host) ?? [];
      list.push({ page, href: winner.href });
      byHost.set(host, list);
    }

    const issues: Issue[] = [];
    for (const [host, entries] of byHost) {
      const distinct = [...new Set(entries.map((e) => e.href))];
      if (distinct.length < 2) continue;
      for (const { page, href } of entries) {
        issues.push({
          ruleId: faviconInconsistentMeta.id,
          category: faviconInconsistentMeta.category,
          severity,
          scope: "site",
          url: primaryUrl(page),
          pageId: pageIdFor(page.normalizedUrl),
          message: `${host} declares ${distinct.length} different favicons across crawled pages; this page declares ${href}`,
          howToFix: faviconInconsistentMeta.howToFix,
          evidence: [
            { field: "favicons.candidates", value: href },
            ...entries
              .filter((e) => e.page !== page && e.href !== href)
              .map((e) => ({ field: "favicons.candidates", value: e.href, pageId: pageIdFor(e.page.normalizedUrl) })),
          ],
        });
      }
    }
    return issues;
  },
};
