import { cn } from "@/lib/cn";

/** Thin filled-track bar — used by the coverage action card and the runs list. */
export function CoverageBar({ percent, className }: { percent: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div
      role="img"
      aria-label={`${percent}% coverage`}
      className={cn("h-1.5 w-full overflow-hidden rounded-pill bg-subtle", className)}
    >
      <div className="h-full rounded-pill bg-data-blue transition-[width] duration-300 ease-out" style={{ width: `${clamped}%` }} />
    </div>
  );
}
