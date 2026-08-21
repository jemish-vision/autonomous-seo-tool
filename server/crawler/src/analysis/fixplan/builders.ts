/** One builder per auto-safe rule id — every rule in automation/classification.ts marked
 * "auto-safe" must have an entry here (generate.ts asserts this and reports a skip otherwise).
 * Each builder is pure: (issue, page-record-if-needed) -> concrete change(s) or a skip reason.
 * Never guesses — an auto-safe classification is only as safe as the concrete value being
 * genuinely known, not inferred. */
import type { CrawledPage, Issue } from "../../models/types";
import type { FixPlanItem, FixPlanSkip } from "./types";

export interface BuildResult {
  items: FixPlanItem[];
  skipped: FixPlanSkip[];
}

function evidenceValue(issue: Issue, field: string): unknown {
  return issue.evidence.find((e) => e.field === field)?.value;
}

export function canonicalAbsentBuilder(issue: Issue, page: CrawledPage | null): BuildResult {
  const self = page ? (page.finalUrl ?? page.url) : issue.url;
  if (!self) {
    return { items: [], skipped: [{ rule: issue.ruleId, url: issue.url, reason: "no URL available to self-reference" }] };
  }
  return {
    items: [
      {
        rule: issue.ruleId,
        issue: issue.message,
        url: issue.url,
        pageId: issue.pageId,
        action: "add-tag",
        where: "<head>",
        change: `<link rel="canonical" href="${self}">`,
        note: "self-referencing canonical — the correct value is the page's own URL",
      },
    ],
    skipped: [],
  };
}

export function mixedContentBuilder(issue: Issue): BuildResult {
  const rewrites = issue.evidence
    .filter((e): e is { field: string; value: string } => typeof e.value === "string" && e.value.toLowerCase().startsWith("http://"))
    .map((e) => `${e.value} → ${e.value.replace(/^http:/i, "https:")}`);
  if (rewrites.length === 0) {
    return { items: [], skipped: [{ rule: issue.ruleId, url: issue.url, reason: "no http:// subresource URLs found in evidence" }] };
  }
  return {
    items: [
      {
        rule: issue.ruleId,
        issue: issue.message,
        url: issue.url,
        pageId: issue.pageId,
        action: "rewrite-urls",
        where: "subresource URLs",
        change: rewrites,
        note: "the same host already serves this page over TLS",
      },
    ],
    skipped: [],
  };
}

const IMAGE_FIELD = /^images\[(\d+)\]$/;

export function imageMissingDimensionsBuilder(issue: Issue, page: CrawledPage | null): BuildResult {
  if (!page) {
    return { items: [], skipped: [{ rule: issue.ruleId, url: issue.url, reason: "page record unavailable — cannot read measured pixel dimensions" }] };
  }
  const changes: string[] = [];
  const skipped: FixPlanSkip[] = [];
  for (const ev of issue.evidence) {
    const m = IMAGE_FIELD.exec(ev.field);
    if (!m) continue;
    const idx = Number(m[1]);
    const img = page.images[idx];
    if (!img) continue;
    const w = img.asset?.naturalWidth;
    const h = img.asset?.naturalHeight;
    if (!w || !h) {
      skipped.push({
        rule: issue.ruleId,
        url: issue.url,
        reason: `images[${idx}] (${img.url}) has no measured pixel dimensions — the crawl's image-size probe didn't capture it, so no fix is generated for it`,
      });
      continue;
    }
    changes.push(`${img.url} → width="${w}" height="${h}"`);
  }
  if (changes.length === 0) return { items: [], skipped };
  return {
    items: [
      {
        rule: issue.ruleId,
        issue: issue.message,
        url: issue.url,
        pageId: issue.pageId,
        action: "add-attributes",
        where: "<img> tags missing width/height",
        change: changes,
        note: "dimensions measured from the image file itself during the crawl's image-size probe, not guessed",
      },
    ],
    skipped,
  };
}

interface RedirectHop {
  from: string;
  to: string;
  statusCode: number;
}

export function redirectChainBuilder(issue: Issue): BuildResult {
  const chain = evidenceValue(issue, "redirectChain") as RedirectHop[] | undefined;
  if (!chain || chain.length === 0) {
    return { items: [], skipped: [{ rule: issue.ruleId, url: issue.url, reason: "no redirectChain evidence on this issue" }] };
  }
  const first = chain[0]!.from;
  const final = chain[chain.length - 1]!.to;
  return {
    items: [
      {
        rule: issue.ruleId,
        issue: issue.message,
        url: issue.url,
        pageId: issue.pageId,
        action: "shorten-redirect",
        where: "server redirect rule",
        change: `${first} → ${final} (currently ${chain.length} hop${chain.length === 1 ? "" : "s"})`,
        note: "point the first URL directly at the final destination",
      },
    ],
    skipped: [],
  };
}

/** Keys MUST match the auto-safe ids in automation/classification.ts exactly — generate.ts
 * treats any auto-safe issue with no entry here as a skip, never a silent drop. */
export const FIX_PLAN_BUILDERS: Record<string, (issue: Issue, page: CrawledPage | null) => BuildResult> = {
  "canonical-absent": (issue, page) => canonicalAbsentBuilder(issue, page),
  "mixed-content": (issue) => mixedContentBuilder(issue),
  "image-missing-dimensions": (issue, page) => imageMissingDimensionsBuilder(issue, page),
  "redirect-chain": (issue) => redirectChainBuilder(issue),
};
