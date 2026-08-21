import { Link } from "react-router-dom";
import { Gauge, AlertOctagon, ShieldOff, ArrowUpRight, type LucideIcon } from "lucide-react";
import type { CrawlSummary } from "@/lib/types";
import { topFailureClasses } from "@/lib/data-overview";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

interface ActionCardProps {
  icon: LucideIcon;
  tint: "blue" | "amber" | "violet" | "green";
  label: string;
  value: string;
  unit?: string;
  footnote: string;
  ctaHref: string;
  bar?: number;
  className?: string;
}

const TINT_STYLES: Record<ActionCardProps["tint"], { bg: string; text: string; bar: string }> = {
  blue: { bg: "bg-primary/10", text: "text-primary", bar: "bg-primary" },
  amber: { bg: "bg-warn/10", text: "text-warn", bar: "bg-warn" },
  violet: { bg: "bg-accent/10", text: "text-accent", bar: "bg-accent" },
  green: { bg: "bg-ok/10", text: "text-ok", bar: "bg-ok" },
};

function CompactActionCard({
  icon: Icon,
  tint,
  label,
  value,
  unit,
  footnote,
  ctaHref,
  bar,
  className,
}: ActionCardProps) {
  const style = TINT_STYLES[tint];

  return (
    <Link to={ctaHref} className="block group">
      <Card
        className={cn(
          "relative overflow-hidden p-3.5 transition-all duration-200 hover:border-primary/40 hover:shadow-sm bg-card hover:bg-card/90",
          className
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-control", style.bg, style.text)}>
              <Icon size={16} strokeWidth={2} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-medium text-secondary truncate block">{label}</span>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">{value}</span>
                {unit && <span className="text-xs font-medium text-faint">{unit}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 text-faint group-hover:text-primary transition-colors duration-150">
            <span className="text-[11px] font-medium hidden sm:inline-block">View</span>
            <ArrowUpRight size={14} className="transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
        </div>

        <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-faint">
          <span className="truncate">{footnote}</span>
          {bar !== undefined && (
            <span className="font-mono font-medium text-secondary shrink-0 ml-2">{bar}%</span>
          )}
        </div>

        {bar !== undefined && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-subtle">
            <div className={cn("h-full rounded-full transition-all duration-500", style.bar)} style={{ width: `${bar}%` }} />
          </div>
        )}
      </Card>
    </Link>
  );
}

export function ActionCards({ report, runId }: { report: CrawlSummary; runId: string }) {
  const q = `?run=${encodeURIComponent(runId)}`;
  const blockedFootnote =
    report.blockedByRobots > 0
      ? `${report.blockedByRobots} URL${report.blockedByRobots === 1 ? "" : "s"} disallowed`
      : "0 URLs blocked by robots.txt";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <CompactActionCard
        icon={Gauge}
        tint="blue"
        label="Crawl coverage"
        value={String(report.coveragePercent)}
        unit="%"
        footnote={`${report.successful} of ${report.attempted} attempted`}
        ctaHref={`/sitemap${q}#failures`}
        bar={report.coveragePercent}
      />
      <CompactActionCard
        icon={AlertOctagon}
        tint="amber"
        label="Failed URLs"
        value={String(report.failed)}
        footnote={`Top: ${topFailureClasses(report.failuresByClass)}`}
        ctaHref={`/sitemap${q}#failures`}
      />
      <CompactActionCard
        icon={ShieldOff}
        tint="violet"
        label="Blocked by robots"
        value={String(report.blockedByRobots)}
        footnote={blockedFootnote}
        ctaHref={`/sitemap${q}`}
      />
    </div>
  );
}
