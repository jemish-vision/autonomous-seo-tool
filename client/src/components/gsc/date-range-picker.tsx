import { useState } from "react";
import { cn } from "@/lib/cn";

export interface Range {
  start: string;
  end: string;
}

/**
 * Presets first, calendar second. Almost every real question is "the last N
 * days"; 16 months is Google's retention ceiling, so nothing longer is offered.
 */
const PRESETS: Array<{ label: string; days: number }> = [
  { label: "7d", days: 7 },
  { label: "28d", days: 28 },
  { label: "3m", days: 90 },
  { label: "6m", days: 180 },
  { label: "16m", days: 480 },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (from: string, days: number) => iso(new Date(new Date(`${from}T00:00:00Z`).getTime() + days * 86_400_000));

export function DateRangePicker({
  value,
  latestAvailable,
  busy,
  onChange,
}: {
  value: Range;
  /** Newest day with settled data; the calendar cannot go past it. */
  latestAvailable: string;
  /** Subtle loading hint — must NOT disable the controls (a long pull must not strand the user). */
  busy: boolean;
  onChange: (next: Range) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState<Range>(value);
  // Keep the custom inputs aligned with an externally-changed range (preset,
  // server clamp) without an effect — the React-recommended derived-state
  // pattern, keyed on the date strings rather than the object identity.
  const [syncedKey, setSyncedKey] = useState(`${value.start}|${value.end}`);
  const valueKey = `${value.start}|${value.end}`;
  if (valueKey !== syncedKey) {
    setSyncedKey(valueKey);
    setDraft(value);
  }

  function applyPreset(days: number) {
    setCustom(false);
    onChange({ start: shift(latestAvailable, -(days - 1)), end: latestAvailable });
  }

  function activePreset(): number | null {
    if (value.end !== latestAvailable) return null;
    const span = Math.round((new Date(`${value.end}T00:00:00Z`).getTime() - new Date(`${value.start}T00:00:00Z`).getTime()) / 86_400_000) + 1;
    return PRESETS.find((p) => p.days === span)?.days ?? null;
  }

  const active = activePreset();

  return (
    <div className={cn("flex items-center gap-2", busy && "opacity-70")}>
      <div className="flex items-center gap-0.5 rounded-control border border-border bg-subtle p-0.5" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={!custom && active === p.days}
            onClick={() => applyPreset(p.days)}
            className={cn(
              "rounded-control px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary",
              !custom && active === p.days ? "bg-elevated text-foreground shadow-sm" : "text-faint hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom}
          onClick={() => setCustom((c) => !c)}
          className={cn(
            "rounded-control px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary",
            custom ? "bg-elevated text-foreground shadow-sm" : "text-faint hover:text-foreground",
          )}
        >
          Custom
        </button>
      </div>

      {custom && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            className="h-8 rounded-control border border-border bg-subtle px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={draft.start}
            max={latestAvailable}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
          />
          <span className="text-faint">→</span>
          <input
            type="date"
            className="h-8 rounded-control border border-border bg-subtle px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={draft.end}
            max={latestAvailable}
            onChange={(e) => setDraft({ ...draft, end: e.target.value })}
          />
          <button
            type="button"
            className="rounded-control bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-contrast outline-none hover:opacity-95 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            disabled={!draft.start || !draft.end}
            onClick={() => onChange(draft)}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
