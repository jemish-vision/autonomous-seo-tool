import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check, Globe, Hash } from "lucide-react";
import { cn } from "@/lib/cn";

export type CrawlScope = "all" | "limited";

const OPTIONS: { value: CrawlScope; title: string; description: string; icon: typeof Globe }[] = [
  { value: "limited", title: "Up to a limit", description: "Stop after a set number of pages", icon: Hash },
  { value: "all", title: "Entire site", description: "No limit — crawl every reachable page", icon: Globe },
];

interface Props {
  value: CrawlScope;
  onChange: (v: CrawlScope) => void;
  disabled?: boolean;
  /** Rendered inside the "Up to a limit" card when it's selected (the number field). */
  limitedControl: ReactNode;
}

/** Page-scope radio-card pair — same visual language as RenderModeCards so the limit choice
 * reads as a first-class decision, not a bolted-on checkbox. The number field lives INSIDE the
 * "limited" card so choosing a scope and setting its value are one coherent gesture. */
export function ScopeCards({ value, onChange, disabled, limitedControl }: Props) {
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
    <div role="radiogroup" aria-label="Crawl scope" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {OPTIONS.map((opt, i) => {
        const selected = value === opt.value;
        const Icon = opt.icon;
        return (
          <div
            key={opt.value}
            className={cn(
              "relative flex flex-col rounded-control border transition-colors duration-150",
              selected ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border bg-card hover:border-border-strong",
            )}
          >
            <button
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
                "flex items-start gap-2.5 rounded-control px-3 py-2.5 text-left outline-none",
                "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <Icon
                size={16}
                strokeWidth={1.75}
                className={cn("mt-0.5 shrink-0", selected ? "text-primary" : "text-secondary")}
                aria-hidden="true"
              />
              <span className="flex flex-col gap-0.5">
                <span className={cn("text-sm font-semibold", selected ? "text-primary" : "text-foreground")}>{opt.title}</span>
                <span className="text-[11px] leading-snug text-secondary">{opt.description}</span>
              </span>
              {selected && (
                <span className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-contrast">
                  <Check size={11} strokeWidth={3} aria-hidden="true" />
                </span>
              )}
            </button>
            {opt.value === "limited" && selected && (
              <div className="px-3 pb-3 pt-1">{limitedControl}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
