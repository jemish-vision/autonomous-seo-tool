import { History, ShieldQuestion } from "lucide-react";
import { useCurrentRun } from "@/api/current-run";
import { useIssues, usePreviousRuleCounts } from "@/api/issues";
import { usePages } from "@/api/pages";
import { useAutomation, useFixPlan, useAiRecommendations, useAppliedFixes } from "@/api/issue-extras";
import { supportedRuleIds } from "@/lib/data-ai-recommendations";
import { EmptyState } from "@/components/ui/empty-state";
import { AnalyzeNowButton } from "@/components/analyze-now-button";
import { RunBreadcrumb } from "@/components/shell/run-breadcrumb";
import { IssuesClient } from "@/components/issues/issues-client";
import { ExportButton } from "@/components/issues/export-button";
import { AppliedFixesProvider } from "@/components/issues/applied-fixes-context";

/** What to Fix — the analyzer report for the current run. Old: app/issues/page.tsx. */
export function IssuesRoute() {
  const { runId, runs, runsLoading } = useCurrentRun();
  const issuesQuery = useIssues(runId);
  const pagesQuery = usePages(runId);
  const automationQuery = useAutomation(runId);
  const fixPlanQuery = useFixPlan(runId);
  const aiQuery = useAiRecommendations(runId);
  const appliedFixesQuery = useAppliedFixes(runId);
  const previousRuleCountsQuery = usePreviousRuleCounts(runId);

  if (runsLoading) return <p className="text-sm text-secondary">Loading…</p>;
  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl first, then analyze it to see issues here." />;
  }
  if (issuesQuery.isLoading || pagesQuery.isLoading) return <p className="text-sm text-secondary">Loading…</p>;

  const report = issuesQuery.data ?? null;

  // No analysis report (null payload or the endpoint 404s on an un-analyzed run) -> offer to analyze.
  if (!report) {
    return (
      <div className="space-y-6">
        <RunBreadcrumb runs={runs} runId={runId} current="What to Fix." />
        <EmptyState
          icon={ShieldQuestion}
          title="This run hasn't been analyzed"
          description="Analyze it right here — no terminal needed. This also generates automation levels and a fix plan for the run."
          action={<AnalyzeNowButton runId={runId} label="Analyze now" />}
        />
      </div>
    );
  }

  const pages = pagesQuery.data ?? [];
  const pageIdToUrlEntries: [string, string][] = pages.map((p) => [p.pageId, p.url]);
  const appliedFixes = appliedFixesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <RunBreadcrumb runs={runs} runId={runId} current="What to Fix." />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">SEO rules</p>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground">What needs fixing.</h2>
        </div>
        {report.issues.length > 0 && <ExportButton runId={runId} />}
      </header>

      {report.issues.length === 0 ? (
        <EmptyState
          icon={ShieldQuestion}
          title="This run is clean"
          description={`Health score ${report.healthScore} · ${report.pagesAnalyzed} pages analyzed, zero rule violations.`}
        />
      ) : (
        <AppliedFixesProvider runId={runId} initial={appliedFixes}>
          <IssuesClient
            runId={runId}
            pagesAnalyzed={report.pagesAnalyzed}
            issues={report.issues}
            counts={report.counts}
            rulesSkippedDataUnavailable={report.rulesSkippedDataUnavailable}
            pageIdToUrlEntries={pageIdToUrlEntries}
            automation={automationQuery.data ?? null}
            fixPlan={fixPlanQuery.data ?? null}
            aiRecommendations={aiQuery.data ?? null}
            aiSupportedRuleIds={supportedRuleIds()}
            previousRuleCounts={previousRuleCountsQuery.data ?? null}
            findings={report.findings ?? []}
            worstPages={report.worstPages ?? []}
            mutedRuleIds={report.mutedRuleIds ?? []}
          />
        </AppliedFixesProvider>
      )}
    </div>
  );
}
