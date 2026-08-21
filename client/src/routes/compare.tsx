import { useSearchParams } from "react-router-dom";
import { History, GitCompare, CheckCircle2, Save, Bookmark } from "lucide-react";
import { useRuns } from "@/api/crawls";
import { usePages } from "@/api/pages";
import { useCompareDiff } from "@/api/compare";
import { useCreateComparison, useComparisons } from "@/api/comparisons";
import type { RunListItem } from "@/lib/data";
import { EmptyState } from "@/components/ui/empty-state";
import { RunPairSelector } from "@/components/compare/run-pair-selector";
import { CompareSummaryTiles } from "@/components/compare/compare-summary-tiles";
import { IssueLifecycleBand } from "@/components/compare/issue-lifecycle-band";
import { AddedRemovedLists } from "@/components/compare/added-removed-lists";
import { ChangedPagesTable } from "@/components/compare/changed-pages-table";

/** Base->head run comparison. Old: app/compare/page.tsx. */
export function CompareRoute() {
  const [params] = useSearchParams();
  const base = params.get("base");
  const head = params.get("head");
  const runsQuery = useRuns();

  if (runsQuery.isLoading) return <p className="text-sm text-secondary">Loading…</p>;
  const runs = runsQuery.data ?? [];

  if (runs.length === 0) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Compare needs at least two runs — crawl a site, then crawl it again to see what changed." />;
  }

  const validIds = new Set(runs.map((r) => r.runId));
  let baseRunId = base && validIds.has(base) ? base : null;
  let headRunId = head && validIds.has(head) ? head : null;

  // Default to the two most recent runs when nothing is selected (useRuns is startedAt desc).
  if (!baseRunId && !headRunId && runs.length >= 2) {
    headRunId = runs[0]!.runId;
    baseRunId = runs[1]!.runId;
  }

  if (runs.length < 2) {
    return (
      <div className="space-y-6">
        <RunPairSelector runs={runs} baseRunId={baseRunId} headRunId={headRunId} />
        <EmptyState icon={GitCompare} title="Only one run recorded" description="Crawl this site again to get a second run — Compare needs two to show what changed." />
      </div>
    );
  }

  if (!baseRunId || !headRunId) {
    return (
      <div className="space-y-6">
        <RunPairSelector runs={runs} baseRunId={baseRunId} headRunId={headRunId} />
        <EmptyState icon={GitCompare} title="Pick two runs to compare" description="Choose a base (before) and a head (after) run above." />
      </div>
    );
  }

  if (baseRunId === headRunId) {
    return (
      <div className="space-y-6">
        <RunPairSelector runs={runs} baseRunId={baseRunId} headRunId={headRunId} />
        <EmptyState icon={GitCompare} title="Pick two different runs" description="Base and head are the same run — choose two distinct runs to see what changed." />
      </div>
    );
  }

  return <CompareResult runs={runs} baseRunId={baseRunId} headRunId={headRunId} />;
}

function CompareResult({ runs, baseRunId, headRunId }: { runs: RunListItem[]; baseRunId: string; headRunId: string }) {
  const diffQuery = useCompareDiff(baseRunId, headRunId);
  const basePagesQuery = usePages(baseRunId);
  const headPagesQuery = usePages(headRunId);

  if (diffQuery.isLoading || basePagesQuery.isLoading || headPagesQuery.isLoading) {
    return (
      <div className="space-y-6">
        <RunPairSelector runs={runs} baseRunId={baseRunId} headRunId={headRunId} />
        <p className="text-sm text-secondary">Loading…</p>
      </div>
    );
  }
  if (diffQuery.error || !diffQuery.data) {
    return (
      <div className="space-y-6">
        <RunPairSelector runs={runs} baseRunId={baseRunId} headRunId={headRunId} />
        <EmptyState icon={GitCompare} title="Couldn’t compute the diff" description={diffQuery.error ? (diffQuery.error as Error).message : "No diff data returned."} />
      </div>
    );
  }

  const diff = diffQuery.data;
  const basePages = basePagesQuery.data ?? [];
  const headPages = headPagesQuery.data ?? [];
  const identical = diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;

  return (
    <div className="space-y-6">
      <RunPairSelector runs={runs} baseRunId={baseRunId} headRunId={headRunId} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-secondary">
          Comparing <span className="font-medium text-foreground">{diff.baseRunId}</span> (base) against{" "}
          <span className="font-medium text-foreground">{diff.headRunId}</span> (head) ·{" "}
          {basePages.length + headPages.length > 0 ? `${basePages.length} + ${headPages.length} pages loaded` : ""}
        </p>
        <SaveComparisonButton baseRunId={baseRunId} headRunId={headRunId} />
      </div>

      <SavedComparisonsPanel />

      <CompareSummaryTiles diff={diff} />

      <IssueLifecycleBand diff={diff} />

      {identical ? (
        <EmptyState
          icon={CheckCircle2}
          title="These runs are identical"
          description={`${diff.unchangedCount} page${diff.unchangedCount === 1 ? "" : "s"} matched with zero field changes — nothing was added, removed, or changed.`}
        />
      ) : (
        <>
          <AddedRemovedLists added={diff.added} removed={diff.removed} baseRunId={baseRunId} headRunId={headRunId} basePages={basePages} headPages={headPages} />
          {diff.changed.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">Changed pages ({diff.changed.length})</h2>
              <ChangedPagesTable changed={diff.changed} headRunId={headRunId} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Persist the current base->head pair as a saved comparison (run-over-run). Add-only: this does
 *  not alter the live diff above — it just snapshots it into public.comparisons. */
function SaveComparisonButton({ baseRunId, headRunId }: { baseRunId: string; headRunId: string }) {
  const create = useCreateComparison();
  return (
    <div className="flex items-center gap-2">
      {create.isError && (
        <span className="text-xs text-red-600">{(create.error as Error)?.message ?? "Save failed"}</span>
      )}
      {create.isSuccess && !create.isPending && (
        <span className="inline-flex items-center gap-1 text-xs text-green-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> Saved
        </span>
      )}
      <button
        type="button"
        onClick={() => create.mutate({ baseCrawlId: baseRunId, againstCrawlId: headRunId, mode: "run-over-run" })}
        disabled={create.isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
      >
        <Save className="h-4 w-4" />
        {create.isPending ? "Saving…" : "Save comparison"}
      </button>
    </div>
  );
}

/** The user's saved comparisons. Read-only affordance — click a row to load it as base/head. */
function SavedComparisonsPanel() {
  const [, setParams] = useSearchParams();
  const saved = useComparisons();
  const rows = saved.data ?? [];
  if (saved.isLoading || rows.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-4">
      <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Bookmark className="h-4 w-4" /> Saved comparisons ({rows.length})
      </h2>
      <ul className="divide-y divide-border">
        {rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-secondary">{c.mode}</span>
              <span className="font-mono text-xs text-foreground">{c.baseCrawlId}</span>
              <span className="text-secondary">→</span>
              <span className="font-mono text-xs text-foreground">{c.againstCrawlId}</span>
              <span className="text-xs text-secondary">{new Date(c.createdAt).toLocaleString()}</span>
            </div>
            <button
              type="button"
              onClick={() => setParams({ base: c.baseCrawlId, head: c.againstCrawlId })}
              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
            >
              Load
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
