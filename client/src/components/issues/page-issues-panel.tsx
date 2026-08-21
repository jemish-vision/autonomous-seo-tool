import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { SeverityBadge } from "./severity-badge";
import { AiRecommendationCard } from "./ai-recommendation-card";
import { AiRecommendNowButton } from "@/components/ai-recommend-now-button";
import { sectionForField, formatEvidenceValue } from "@/lib/data-issues";
import { supportedRuleIds, type AiRecommendation } from "@/lib/data-ai-recommendations";
import type { Issue } from "@/lib/types";

const AI_SUPPORTED_RULE_IDS = new Set(supportedRuleIds());

interface Props {
  issues: Issue[];
  analyzed: boolean;
  runId: string;
  pageId: string;
  /** Keyed "ruleId::pageId" (lib/data-ai-recommendations.ts's recommendationsByRuleAndPage) —
   *  null when ai-recommendations.json hasn't been generated for this run at all yet. */
  aiRecommendationsByRuleAndPage: Map<string, AiRecommendation[]> | null;
}

/** Page-detail Issues section — findings whose primary pageId is this page, plus site-scope
 *  findings that reference it via evidence (see findingsForPage). Evidence field:value pairs jump
 *  to an existing section when one exists (MF-5b); sectionless fields (social/hreflang/pageStats)
 *  render inline instead of a dead link. Each issue that supports AI recommendations shows its
 *  generated card(s) inline, or a scoped "Generate" action when none exist yet. */
export function PageIssuesPanel({ issues, analyzed, runId, pageId, aiRecommendationsByRuleAndPage }: Props) {
  return (
    <Card id="issues">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-faint">Issues</h2>
        <span className="text-xs tabular-nums text-faint">
          {issues.length} finding{issues.length === 1 ? "" : "s"}
        </span>
      </div>
      {!analyzed ? (
        <p className="text-sm text-faint">
          This run hasn&apos;t been analyzed —{" "}
          <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">npm run analyze -- --run {runId}</code>{" "}
          from <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">seo-crawler-poc</code> to generate
          issues for this page.
        </p>
      ) : issues.length === 0 ? (
        <p className="text-sm text-faint">No issues found for this page.</p>
      ) : (
        <ul className="space-y-3 text-sm">
          {issues.map((issue, i) => (
            <li key={`${issue.ruleId}-${i}`} className="rounded-control border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={issue.severity} />
                <span className="font-mono text-xs text-faint">{issue.ruleId}</span>
                <span className="text-xs text-faint">· {issue.category}</span>
                <Link
                  to={`/issues?run=${encodeURIComponent(runId)}&rule=${encodeURIComponent(issue.ruleId)}`}
                  className="ml-auto text-[11px] font-medium text-primary underline underline-offset-2 hover:opacity-80"
                >
                  All pages with this rule
                </Link>
              </div>
              <p className="mt-1.5 text-foreground">{issue.message}</p>
              <p className="mt-1 text-xs text-secondary">{issue.howToFix}</p>
              {issue.threshold && <p className="mt-1 text-xs text-faint">Threshold: {issue.threshold}</p>}
              {issue.evidence.length > 0 && (
                <dl className="mt-2 space-y-1 border-t border-border pt-2">
                  {issue.evidence.map((e, ei) => {
                    const section = sectionForField(e.field);
                    return (
                      <div key={ei} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                        <dt className="font-mono text-faint">{e.field}</dt>
                        <dd className="text-secondary">
                          {section ? (
                            <a href={`#${section}`} className="text-primary underline underline-offset-2">
                              {formatEvidenceValue(e.value)}
                            </a>
                          ) : (
                            formatEvidenceValue(e.value)
                          )}
                        </dd>
                        {e.pageId && (
                          <Link
                            to={`/pages/${e.pageId}?run=${encodeURIComponent(runId)}`}
                            className="text-primary underline underline-offset-2"
                          >
                            (other page)
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </dl>
              )}
              {AI_SUPPORTED_RULE_IDS.has(issue.ruleId) && (
                <div className="mt-3 border-t border-border pt-3">
                  {(() => {
                    const recs = aiRecommendationsByRuleAndPage?.get(`${issue.ruleId}::${pageId}`) ?? [];
                    if (recs.length > 0) {
                      return (
                        <div className="space-y-2">
                          {recs.map((r, ri) => (
                            <AiRecommendationCard key={`${r.instanceKey ?? ri}`} recommendation={r} />
                          ))}
                        </div>
                      );
                    }
                    return (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-faint">No AI suggestion generated for this issue yet.</p>
                        <AiRecommendNowButton runId={runId} ruleId={issue.ruleId} pageId={pageId} variant="outline" label="Generate AI suggestion" />
                      </div>
                    );
                  })()}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
