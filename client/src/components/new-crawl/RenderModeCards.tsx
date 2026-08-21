import { useRef, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import type { RenderMode } from "./types";

const OPTIONS: { value: RenderMode; title: string; description: string }[] = [
  { value: "auto", title: "Auto", description: "HTTP-first, Chromium when needed — recommended" },
  { value: "never", title: "Never", description: "HTTP only, fastest" },
  { value: "always", title: "Always", description: "Every page in Chromium, slowest" },
];

interface Props {
  value: RenderMode;
  onChange: (v: RenderMode) => void;
  disabled?: boolean;
}

/**
 * Radio-card group. Selected state must be readable "from 2 meters away": filled 2px primary
 * ring + tinted bg + a solid check badge, never color alone (title also switches to --primary).
 */
export function RenderModeCards({ value, onChange, disabled }: Props) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (disabled) return;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % OPTIONS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + OPTIONS.length) % OPTIONS.length;
    else return;
    e.preventDefault();
    onChange(OPTIONS[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Render mode" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {OPTIONS.map((opt, i) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative flex flex-col gap-1 rounded-control border px-3 py-2.5 text-left transition-colors duration-150 outline-none",
              "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              "disabled:pointer-events-none disabled:opacity-50",
              selected
                ? "border-primary bg-primary/10 ring-2 ring-primary"
                : "border-border bg-card hover:border-border-strong hover:bg-subtle",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className={cn("text-sm font-semibold", selected ? "text-primary" : "text-foreground")}>{opt.title}</span>
              {selected && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-contrast">
                  <Check size={11} strokeWidth={3} aria-hidden="true" />
                </span>
              )}
            </span>
            <span className="text-[11px] leading-snug text-secondary">{opt.description}</span>
          </button>
        );
      })}
    </div>
  );
}
