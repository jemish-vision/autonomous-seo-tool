import { ShieldQuestion, ShieldAlert, ShieldCheck, ShieldHalf } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatValue } from "@/components/ui/stat-value";
import { EmptyState } from "@/components/ui/empty-state";
import type { CrawlDiff } from "@/lib/data-compare";

/** Honest empty state when either run hasn't been analyzed — never renders a fake 0/0/0 (spec:
 * issues is null, not zero, until both sides have issues.json). */
export function IssueLifecycleBand({ diff }: { diff: CrawlDiff }) {
  if (!diff.issues) {
    return (
      <EmptyState
        icon={ShieldQuestion}
        title="Issue lifecycle not available"
        description={
          <>
            Run{" "}
            <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">npm run analyze</code> against BOTH{" "}
            <span className="font-medium text-foreground">{diff.baseRunId}</span> and{" "}
            <span className="font-medium text-foreground">{diff.headRunId}</span> in seo-crawler-poc to see which issues are new,
            fixed, or persisting between them.
          </>
        }
      />
    );
  }

  const { newIssues, fixedIssues, persistingCount } = diff.issues;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-danger-bg text-danger">
          <ShieldAlert size={18} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <StatValue value={newIssues.length} caption="New issues since base" />
      </Card>
      <Card className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-ok-bg text-ok">
          <ShieldCheck size={18} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <StatValue value={fixedIssues.length} caption="Fixed since base" />
      </Card>
      <Card className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-subtle text-faint">
          <ShieldHalf size={18} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <StatValue value={persistingCount} caption="Persisting in both runs" />
      </Card>
    </div>
  );
}
