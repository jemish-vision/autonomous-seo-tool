import { HeartPulse, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatValue } from "@/components/ui/stat-value";
import { CategoryBreakdown } from "@/components/issues/category-breakdown";
import type { AnalysisReport } from "@/lib/types";

export function IssuesSummaryBand({ report }: { report: AnalysisReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-data-green/10 text-data-green">
            <HeartPulse size={18} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <StatValue value={report.healthScore} caption={`Health score · ${report.pagesAnalyzed} pages analyzed`} />
        </Card>
        <Card className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-danger-bg text-danger">
            <AlertCircle size={18} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <StatValue value={report.counts.error} caption="Errors" />
        </Card>
        <Card className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-warn-bg text-warn">
            <AlertTriangle size={18} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <StatValue value={report.counts.warning} caption="Warnings" />
        </Card>
        <Card className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-subtle text-faint">
            <Info size={18} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <StatValue value={report.counts.notice} caption="Notices" />
        </Card>
      </div>

      <CategoryBreakdown categories={report.categories} />
    </div>
  );
}
