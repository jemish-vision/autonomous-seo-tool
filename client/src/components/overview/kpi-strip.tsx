import { Link } from "react-router-dom";
import { FileStack, Timer, Sparkles, Link2, ArrowUp, ArrowDown, Minus, type LucideIcon } from "lucide-react";
import type { KpiStrip, KpiValue } from "@/lib/data-overview";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

const SENTIMENT_CLASSES: Record<KpiValue["sentiment"], string> = {
  good: "bg-ok-bg text-ok",
  bad: "bg-danger-bg text-danger",
  neutral: "bg-subtle text-secondary",
};

const DIRECTION_ICON: Record<KpiValue["direction"], LucideIcon> = { up: ArrowUp, down: ArrowDown, neutral: Minus };

/**
 * Same visuals as components/ui/delta-pill.tsx but tone comes from `sentiment` (good/bad given
 * the metric's polarity), not from `direction` — DeltaPill hardcodes up=green/down=red which is
 * wrong for lower-is-better metrics (a response-time DROP is good news, arrow still points down).
 * Local to this file (not components/ui) since that primitive is locked/do-not-touch.
 */
function KpiTrendPill({ kpi }: { kpi: KpiValue }) {
  const Icon = DIRECTION_ICON[kpi.direction];
  return (
    <span className={cn("inline-flex items-center gap-1 self-start rounded-pill px-2 py-0.5 text-xs font-medium tabular-nums", SENTIMENT_CLASSES[kpi.sentiment])}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {kpi.deltaLabel}
    </span>
  );
}

interface TileProps {
  icon: LucideIcon;
  label: string;
  kpi: KpiValue;
  unit?: string;
  href: string;
}

function Tile({ icon: Icon, label, kpi, unit, href }: TileProps) {
  return (
    <div className="flex flex-1 flex-col gap-2 px-5 py-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-secondary">
        <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
        {label}
      </div>
      <Link
        to={href}
        className="w-fit text-2xl font-semibold leading-tight tabular-nums text-foreground outline-none transition-opacity duration-150 hover:opacity-70 focus-visible:ring-2 focus-visible:ring-primary rounded-control"
      >
        {kpi.value}
        {unit && <span className="ml-1 text-sm font-medium text-faint">{unit}</span>}
      </Link>
      {kpi.deltaLabel ? <KpiTrendPill kpi={kpi} /> : <span className="text-xs text-faint">first run</span>}
    </div>
  );
}

export function KpiStripView({ strip, runId }: { strip: KpiStrip; runId: string }) {
  const q = `run=${encodeURIComponent(runId)}`;
  return (
    <Card className="flex flex-col divide-y divide-border p-0 sm:flex-row sm:divide-x sm:divide-y-0">
      <Tile icon={FileStack} label="Pages crawled" kpi={strip.pagesCrawled} href={`/pages?${q}&status=2xx`} />
      <Tile icon={Timer} label="Avg response time" kpi={strip.avgResponseMs} unit="ms" href={`/pages?${q}&sort=responseTime&dir=desc`} />
      <Tile icon={Sparkles} label="JS-rendered" kpi={strip.jsRendered} href={`/pages?${q}&rendered=playwright`} />
      <Tile icon={Link2} label="Internal links" kpi={strip.internalLinks} href={`/pages?${q}`} />
    </Card>
  );
}
