/** Shared helpers for page rule modules — not a rule pack itself. */
import type { CrawledPage, Issue, IssueEvidence, IssueSeverity, RuleMeta } from "../../../models/types";
import type { AnalysisConfig } from "../../config";

export function severityFor(meta: RuleMeta, config: AnalysisConfig): IssueSeverity {
  return config.rules[meta.id]?.severity ?? meta.defaultSeverity;
}

/**
 * True when an optional extraction field was captured AND carries every sub-field the caller
 * dereferences. Guarding only the container is not enough: stored runs predate individual
 * fields, and a half-written record must skip (null = could not check) rather than crash or —
 * worse — read `undefined` and silently report a finding that isn't there.
 */
export function captured<T extends object>(value: T | undefined | null, ...keys: (keyof T)[]): value is T {
  return value !== undefined && value !== null && keys.every((key) => value[key] !== undefined);
}

/** Array-shaped field that must exist before it is iterated. `videos[]` is typed required yet
 * absent on 1190 stored pages, so array-ness is a runtime question, not a type-level one. */
export function capturedList<T>(value: T[] | undefined | null): value is T[] {
  return Array.isArray(value);
}

/** Builds a page-scope Issue. pageId is backfilled by the engine (rules don't know their own storage filename). */
export function issueFor(
  meta: RuleMeta,
  config: AnalysisConfig,
  page: CrawledPage,
  opts: { message: string; evidence: IssueEvidence[]; threshold?: string },
): Issue {
  const issue: Issue = {
    ruleId: meta.id,
    category: meta.category,
    severity: severityFor(meta, config),
    scope: "page",
    url: page.url,
    pageId: null,
    message: opts.message,
    howToFix: meta.howToFix,
    evidence: opts.evidence,
  };
  if (opts.threshold) issue.threshold = opts.threshold;
  return issue;
}
