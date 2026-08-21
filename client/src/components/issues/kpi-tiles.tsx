import { cn } from "@/lib/cn";

export interface KpiTileSpec {
  value: number | string;
  label: string;
  /** Tiny status dot beside the caption — the app's established micro-accent, not a line. */
  dot?: "bad" | "warn" | "ok" | "neutral";
  /** Present on tiles that do something when clicked (filter the list or switch view). */
  onClick?: () => void;
  active?: boolean;
  /** Word shown under an active tile — "filtering" for list filters, "viewing" for view switches. */
  activeLabel?: string;
}

const DOT_CLASSES = { bad: "bg-danger", warn: "bg-warn", ok: "bg-ok", neutral: "bg-faint" };

/** Headline numbers as the app's standard stat cards (Card + StatValue pattern). A tile only
 *  becomes a button when it is given something to do — the severity tiles filter the list below
 *  them — so plain tiles stay static rather than looking clickable and doing nothing. */
export function KpiTiles({ items }: { items: KpiTileSpec[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2.5 sm:gap-3">
      {items.map((t) => {
        const body = (
          <>
            <span className="block text-2xl font-semibold leading-tight tabular-nums text-foreground">{t.value ?? "—"}</span>
            <span className="mt-1 flex items-center gap-1.5 text-xs text-faint">
              {t.dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASSES[t.dot])} aria-hidden="true" />}
              <span className="truncate">{t.label}</span>
            </span>
          </>
        );
        if (!t.onClick) {
          return (
            <div key={t.label} className="rounded-card border border-border bg-card px-4 py-3.5">
              {body}
            </div>
          );
        }
        return (
          <button
            type="button"
            key={t.label}
            aria-pressed={Boolean(t.active)}
            onClick={t.onClick}
            className={cn(
              "cursor-pointer rounded-card border bg-card px-4 py-3.5 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary",
              t.active ? "border-primary bg-subtle ring-1 ring-primary" : "border-border hover:border-border-strong hover:bg-elevated",
            )}
          >
            {body}
            {t.active && (
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-primary">{t.activeLabel ?? "filtering"}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
