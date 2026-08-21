import { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import type { HexCell, HexLegendRow } from "@/lib/data-overview";
import { pagesHrefForStatusClass } from "@/lib/data-overview";
import { Card } from "@/components/ui/card";

const COLOR_VAR: Record<HexCell["statusClass"], string> = {
  "2xx": "var(--data-blue)",
  "3xx": "var(--data-violet)",
  "4xx": "var(--data-orange)",
  "5xx": "var(--data-red)",
  blocked: "var(--text-faint)",
  empty: "var(--border)",
};

const COLS = 24;
const R = 9; // hex circumradius (px)
const HORIZ = Math.sqrt(3) * R;
const VERT = 1.5 * R;

interface Tooltip {
  x: number;
  y: number;
  url: string;
  statusCode: number | null;
  statusClass: HexCell["statusClass"];
}

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

export function HexMatrix({ cells, legend, runId }: { cells: HexCell[]; legend: HexLegendRow[]; runId: string }) {
  const navigate = useNavigate();
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  const rows = Math.ceil(cells.length / COLS);
  const width = COLS * HORIZ + HORIZ / 2 + R;
  const height = rows * VERT + 0.5 * VERT + R;

  const positioned = useMemo(
    () =>
      cells.map((cell, i) => {
        const row = Math.floor(i / COLS);
        const col = i % COLS;
        const cx = col * HORIZ + (row % 2 === 1 ? HORIZ / 2 : 0) + R + 1;
        const cy = row * VERT + R + 1;
        return { cell, cx, cy };
      }),
    [cells],
  );

  const showTooltip = useCallback((cell: HexCell, target: Element) => {
    if (cell.statusClass === "empty") return;
    const rect = target.getBoundingClientRect();
    setTooltip({
      x: rect.left + rect.width / 2,
      y: rect.top,
      url: cell.url ?? "unknown URL",
      statusCode: cell.statusCode,
      statusClass: cell.statusClass,
    });
  }, []);

  return (
    <Card className="relative flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-foreground">Pages by status</h3>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Hex matrix of crawled pages colored by HTTP status class"
        className="h-auto w-full max-w-2xl"
      >
        {positioned.map(({ cell, cx, cy }) => {
          const interactive = cell.statusClass !== "empty";
          return (
            <polygon
              key={cell.key}
              points={hexPoints(cx, cy, R - 1)}
              fill={COLOR_VAR[cell.statusClass]}
              opacity={cell.statusClass === "empty" ? 0.5 : 1}
              tabIndex={interactive ? 0 : -1}
              role={interactive ? "button" : undefined}
              aria-label={interactive ? `${cell.url}, status ${cell.statusCode ?? "blocked"}` : undefined}
              className={interactive ? "cursor-pointer outline-none transition-opacity duration-150 hover:opacity-80 focus-visible:stroke-primary focus-visible:stroke-2" : undefined}
              onMouseEnter={(e) => showTooltip(cell, e.currentTarget)}
              onMouseLeave={() => setTooltip(null)}
              onFocus={(e) => showTooltip(cell, e.currentTarget)}
              onBlur={() => setTooltip(null)}
              onClick={() => cell.pageId && navigate(`/pages/${cell.pageId}?run=${encodeURIComponent(runId)}`)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && cell.pageId) {
                  e.preventDefault();
                  navigate(`/pages/${cell.pageId}?run=${encodeURIComponent(runId)}`);
                }
              }}
            />
          );
        })}
      </svg>

      <ul className="flex flex-col gap-1">
        {legend.map((row) => (
          <li key={row.statusClass}>
            <Link
              to={pagesHrefForStatusClass(runId, row.statusClass)}
              className="flex items-center gap-2 rounded-control px-1 py-0.5 text-xs outline-none transition-colors duration-150 hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: COLOR_VAR[row.statusClass] }} aria-hidden="true" />
              <span className="flex-1 text-secondary">{row.label}</span>
              <span className="rounded-pill bg-subtle px-1.5 py-0.5 tabular-nums text-faint">{row.percent}%</span>
              <span className="w-10 text-right font-medium tabular-nums text-foreground">{row.count}</span>
            </Link>
          </li>
        ))}
      </ul>

      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-control border border-border bg-elevated px-2.5 py-1.5 text-xs shadow-popover"
          style={{ left: tooltip.x, top: tooltip.y - 8 }}
        >
          <p className="max-w-[240px] truncate font-medium text-foreground">{tooltip.url}</p>
          <p className="text-faint">{tooltip.statusCode ?? "blocked by robots.txt"}</p>
        </div>
      )}
    </Card>
  );
}
