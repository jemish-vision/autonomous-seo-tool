import { Link } from "react-router-dom";
import { LayoutGrid, Gauge } from "lucide-react";
import { useCurrentRun } from "@/api/current-run";
import { useRun } from "@/api/crawls";
import { usePages } from "@/api/pages";
import { useIssues } from "@/api/issues";
import { useMeasurements } from "@/api/measurements";
import { buildWorkQueue, buildKpiStrip } from "@/lib/data-overview";
import { adaptMeasurements } from "@/lib/measurements-view";
import { EmptyState } from "@/components/ui/empty-state";
import { HealthScoreHero } from "@/components/overview/health-score-hero";
import { ActionCards } from "@/components/overview/action-cards";
import { KpiStripView } from "@/components/overview/kpi-strip";
import { WorkQueueTable } from "@/components/overview/work-queue-table";
import { FilterChips } from "@/components/overview/filter-chips";
import { OverviewTopbarActions } from "@/components/overview/overview-topbar-actions";
import { NewCrawlTriggerButton } from "@/components/overview/new-crawl-trigger-button";
import { MeasurementsGrid } from "@/components/measurements/measurements-grid";
import { DRILLDOWN_SUPPORTED_IDS } from "@/components/measurements/matching-pages-panel";

/** Dashboard overview for the current run. Old: app/page.tsx. */
export function OverviewRoute() {
  const { runId, runs, runsLoading } = useCurrentRun();

  const currentIndex = runs.findIndex((r) => r.runId === runId);
  const previousRunItem = currentIndex >= 0 ? runs[currentIndex + 1] : undefined;
  const previousRunId = previousRunItem?.runId ?? null;

  const runQuery = useRun(runId);
  const pagesQuery = usePages(runId);
  const analysisQuery = useIssues(runId);
  const measurementsQuery = useMeasurements(runId);
  const prevRunQuery = useRun(previousRunId);
  const prevPagesQuery = usePages(previousRunId);

  if (runsLoading) return <p className="text-sm text-secondary">Loading…</p>;

  if (runs.length === 0) {
    return (
      <>
        <OverviewTopbarActions report={null} />
        <EmptyState
          icon={LayoutGrid}
          title="No crawl runs yet"
          description={
            <>
              Run a crawl from{" "}
              <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">seo-crawler-poc</code>{" "}
              or trigger one right from here.
            </>
          }
          action={<NewCrawlTriggerButton label="Crawl your first site" />}
        />
      </>
    );
  }

  if (runQuery.isLoading || pagesQuery.isLoading) return <p className="text-sm text-secondary">Loading…</p>;

  const detail = runQuery.data;
  const report = detail?.report ?? null;

  if (!report) {
    return (
      <>
        <OverviewTopbarActions report={null} />
        <EmptyState icon={LayoutGrid} title="Run report missing" description={`The report for ${runId} could not be read.`} />
      </>
    );
  }

  const pages = pagesQuery.data ?? [];
  const blocked = detail?.blocked ?? [];
  const failures = detail?.failures ?? [];
  const analysisReport = analysisQuery.data ?? null;

  // Previous-run data feeds the KPI deltas; absent until it loads (or when there is no previous run).
  const previousReport = previousRunId ? prevRunQuery.data?.report ?? null : null;
  const previousPages = previousRunId ? prevPagesQuery.data ?? null : null;

  const measurementsJson = measurementsQuery.data ?? null;
  const measurementsData = measurementsJson ? adaptMeasurements(measurementsJson, runId!) : null;

  // Enable the metric -> matching-pages drill-down (OLD app/measurements/*): a card is clickable only
  // when it is present + available this run AND the server can resolve it (DRILLDOWN_SUPPORTED_IDS),
  // so the panel's page count always matches the card's own number. Mirrors OLD drilldownSupportedIds().
  const drilldownSupportedIds = measurementsData
    ? measurementsData.cards.filter((c) => c.available && DRILLDOWN_SUPPORTED_IDS.has(c.id)).map((c) => c.id)
    : [];

  const workQueue = buildWorkQueue(pages, failures, report.orphanCandidates);
  const kpiStrip = buildKpiStrip(report, pages, previousReport, previousPages);

  return (
    <div className="space-y-6">
      <OverviewTopbarActions report={report} />

      {/* Quick Status Navigation Filter Chips */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <FilterChips report={report} runId={runId!} pages={pages} failureCount={failures.length} blockedCount={blocked.length} />
      </div>

      {/* Hero Health Score Gauge & Top Fixes */}
      <HealthScoreHero report={analysisReport} runId={runId!} />

      {/* Compact Action Metric Cards */}
      <ActionCards report={report} runId={runId!} />

      {/* Trend strip: the four crawl-level KPIs with deltas vs the previous run. */}
      <div className="space-y-2">
        <KpiStripView strip={kpiStrip} runId={runId!} />
        {previousRunItem && (
          <p className="text-xs text-faint">
            Comparing against{" "}
            <Link
              to={`/compare?base=${encodeURIComponent(previousRunItem.runId)}&head=${encodeURIComponent(runId!)}`}
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              the previous crawl
            </Link>{" "}
            · view the full{" "}
            <Link to={`/compare?base=${encodeURIComponent(previousRunItem.runId)}&head=${encodeURIComponent(runId!)}`} className="text-primary underline underline-offset-2 hover:opacity-80">
              run comparison
            </Link>
          </p>
        )}
      </div>

      {measurementsData && (
        <section className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Gauge size={18} className="text-primary" />
                <h2 className="text-base font-semibold text-foreground">Technical SEO Measurements</h2>
              </div>
              <p className="text-xs text-secondary mt-0.5">
                Comprehensive technical SEO indicators across indexability, content quality, links, head metadata, and performance.
              </p>
            </div>
          </div>
          <MeasurementsGrid runId={runId!} data={measurementsData} drilldownSupportedIds={drilldownSupportedIds} />
        </section>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Pages that need you</h2>
        <WorkQueueTable rows={workQueue} runId={runId!} />
      </div>
    </div>
  );
}
