import { PlusCircle, MinusCircle, PencilLine, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatValue } from "@/components/ui/stat-value";
import type { CrawlDiff } from "@/lib/data-compare";

export function CompareSummaryTiles({ diff }: { diff: CrawlDiff }) {
  return (
    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <Card className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-ok-bg text-ok">
          <PlusCircle size={18} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <StatValue value={diff.added.length} caption="Added pages" />
      </Card>
      <Card className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-danger-bg text-danger">
          <MinusCircle size={18} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <StatValue value={diff.removed.length} caption="Removed pages" />
      </Card>
      <Card className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-warn-bg text-warn">
          <PencilLine size={18} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <StatValue value={diff.changed.length} caption="Changed pages" />
      </Card>
      <Card className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-subtle text-faint">
          <CheckCircle2 size={18} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <StatValue value={diff.unchangedCount} caption="Unchanged pages" />
      </Card>
    </div>
  );
}
