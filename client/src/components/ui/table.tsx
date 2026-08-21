import type { ReactNode, ThHTMLAttributes } from "react";
import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

export function TableContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("w-full max-w-full overflow-x-auto rounded-card border border-border bg-card", className)} style={{ WebkitOverflowScrolling: "touch" }}>
      <table className="w-full min-w-max border-collapse text-sm">{children}</table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-subtle text-xs text-secondary">
      <tr className="border-b border-border">{children}</tr>
    </thead>
  );
}

interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  sortDir?: "asc" | "desc" | null;
  onSort?: () => void;
}

/** Plain <th> when no onSort is given; otherwise a focusable sort button with aria-sort. */
export function Th({ children, sortDir, onSort, className, ...rest }: ThProps) {
  if (!onSort) {
    return (
      <th className={cn("px-4 py-2.5 text-left font-medium", className)} {...rest}>
        {children}
      </th>
    );
  }
  const ariaSort = sortDir === "asc" ? "ascending" : sortDir === "desc" ? "descending" : "none";
  const Icon = sortDir === "asc" ? ArrowUp : sortDir === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <th className={cn("px-4 py-2.5 text-left font-medium", className)} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={onSort}
        className="inline-flex items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-control"
      >
        {children}
        <Icon size={12} strokeWidth={2} className={sortDir ? "text-foreground" : "text-faint"} aria-hidden="true" />
      </button>
    </th>
  );
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("min-h-11 border-b border-border last:border-0 hover:bg-subtle", className)}>{children}</tr>;
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-2.5 align-middle tabular-nums", className)}>{children}</td>;
}
