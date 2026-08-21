import { useState } from "react";
import { Link } from "react-router-dom";
import type { TimelineBucket, TimelineData } from "@/lib/data-overview";
import { pagesHrefForRenderMode } from "@/lib/data-overview";
import { Card } from "@/components/ui/card";

const DOT_R = 2.5;
const DOT_GAP = 7;
const COL_WIDTH = 22;
const CHART_HEIGHT = 160;
const MAX_DOTS = Math.floor(CHART_HEIGHT / DOT_GAP);

interface Tooltip {
  x: number;
  y: number;
  bucket: TimelineBucket;
}

function DotColumn({ bucket, index, maxTotal, onHover, onLeave }: { bucket: TimelineBucket; index: number; maxTotal: number; onHover: (t: Element, b: TimelineBucket) => void; onLeave: () => void }) {
  const total = bucket.http + bucket.playwright;
  const scale = maxTotal > 0 ? MAX_DOTS / Math.max(maxTotal, 1) : 0;
  const httpDots = Math.round(bucket.http * scale);
  const playwrightDots = Math.round(bucket.playwright * scale);
  const cx = index * COL_WIDTH + COL_WIDTH / 2;

  const dots = [
    ...Array.from({ length: httpDots }, (_, i) => ({ i, color: "var(--data-blue)" })),
    ...Array.from({ length: playwrightDots }, (_, i) => ({ i: httpDots + i, color: "var(--data-violet)" })),
  ];

  return (
    <g
      tabIndex={total > 0 ? 0 : -1}
      role={total > 0 ? "img" : undefined}
      aria-label={total > 0 ? `${bucket.label}: ${bucket.http} HTTP, ${bucket.playwright} Playwright` : undefined}
      className="outline-none focus-visible:opacity-70"
      onMouseEnter={(e) => onHover(e.currentTarget, bucket)}
      onMouseLeave={onLeave}
      onFocus={(e) => onHover(e.currentTarget, bucket)}
      onBlur={onLeave}
    >
      <rect x={cx - COL_WIDTH / 2} y={0} width={COL_WIDTH} height={CHART_HEIGHT} fill="transparent" />
      {dots.map(({ i, color }) => (
        <circle key={i} cx={cx} cy={CHART_HEIGHT - DOT_R - i * DOT_GAP} r={DOT_R} fill={color} />
      ))}
    </g>
  );
}

export function DotMatrixTimeline({ data, runId }: { data: TimelineData; runId: string }) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const maxTotal = Math.max(1, ...data.buckets.map((b) => b.http + b.playwright));
  const width = Math.max(data.buckets.length * COL_WIDTH, COL_WIDTH);
  const gridLines = 4;

  function handleHover(target: Element, bucket: TimelineBucket) {
    const rect = target.getBoundingClientRect();
    setTooltip({ x: rect.left + rect.width / 2, y: rect.top, bucket });
  }

  if (data.buckets.length === 0) {
    return (
      <Card className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Crawl progress over time</h3>
        <p className="text-xs text-faint">No fetch timestamps recorded yet for this run.</p>
      </Card>
    );
  }

  // Show at most ~8 x-axis labels so long runs don't overcrowd the axis.
  const labelStride = Math.max(1, Math.ceil(data.buckets.length / 8));

  return (
    <Card className="relative flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-foreground">Crawl progress over time</h3>
        <span className="inline-flex items-center gap-3 text-[11px] text-secondary">
          <Link
            to={pagesHrefForRenderMode(runId, "http")}
            className="inline-flex items-center gap-1 rounded-control px-1 py-0.5 outline-none transition-colors duration-150 hover:bg-subtle hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--data-blue)" }} aria-hidden="true" />
            HTTP
          </Link>
          <Link
            to={pagesHrefForRenderMode(runId, "playwright")}
            className="inline-flex items-center gap-1 rounded-control px-1 py-0.5 outline-none transition-colors duration-150 hover:bg-subtle hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--data-violet)" }} aria-hidden="true" />
            Playwright
          </Link>
        </span>
      </div>

      <div>
        <Link
          to={`/pages?run=${encodeURIComponent(runId)}`}
          className="inline-block text-[28px] font-semibold leading-tight tabular-nums text-foreground outline-none transition-opacity duration-150 hover:opacity-70 focus-visible:ring-2 focus-visible:ring-primary rounded-control"
        >
          {data.total}
        </Link>
        <p className="text-xs text-faint">{data.pagesPerMinute} pages/min avg</p>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${CHART_HEIGHT}`} width={width} height={CHART_HEIGHT} role="img" aria-label="Pages fetched per minute, stacked by rendering method">
          {Array.from({ length: gridLines }, (_, i) => {
            const y = (CHART_HEIGHT / gridLines) * i;
            return <line key={i} x1={0} x2={width} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />;
          })}
          {data.buckets.map((bucket, i) => (
            <DotColumn key={bucket.key} bucket={bucket} index={i} maxTotal={maxTotal} onHover={handleHover} onLeave={() => setTooltip(null)} />
          ))}
        </svg>
        <div className="mt-1 flex text-[10px] text-faint" style={{ width }}>
          {data.buckets.map((bucket, i) => (
            <span key={bucket.key} style={{ width: COL_WIDTH, textAlign: "center" }}>
              {i % labelStride === 0 ? bucket.label : ""}
            </span>
          ))}
        </div>
      </div>

      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-control border border-border bg-elevated px-2.5 py-1.5 text-xs shadow-popover"
          style={{ left: tooltip.x, top: tooltip.y - 8 }}
        >
          <p className="font-medium text-foreground">{tooltip.bucket.label}</p>
          <p className="text-faint">
            {tooltip.bucket.http} HTTP · {tooltip.bucket.playwright} Playwright
          </p>
        </div>
      )}
    </Card>
  );
}
