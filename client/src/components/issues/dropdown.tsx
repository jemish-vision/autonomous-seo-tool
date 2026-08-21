import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/** A secondary filter — and it has to LOOK secondary. The reference poc notes: three rows of
 *  pills each showing a highlighted default read as three active filters when nothing was
 *  actually narrowed. So the group control stays as pills, and everything else becomes a
 *  dropdown that stays quiet until it is genuinely narrowing something: the trigger only tints
 *  once the value moves off the "all" option.
 *
 *  Options carry a trailing check on the active row, and the sheet portals to <body> because the
 *  toolbar's ancestors clip in-tree popovers.
 */
interface Option {
  value: string;
  label: string;
  count?: number;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  label: string;
  /** The value that means "nothing narrowed" — anything else tints the trigger. */
  allValue?: string;
  /** For controls that never narrow anything (e.g. grouping). */
  neutral?: boolean;
}

export function Dropdown({ value, onChange, options, label, allValue = options[0]?.value, neutral = false }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const active = !neutral && value !== allValue;
  const current = options.find((o) => o.value === value)?.label ?? label;

  useLayoutEffect(() => {
    if (!open || !ref.current) return undefined;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 252) });
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.focus();
      }
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-control border px-2.5 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary",
          active ? "border-primary bg-subtle text-primary" : "border-border bg-subtle text-secondary hover:bg-elevated hover:text-foreground",
        )}
      >
        <span className="text-[11px] uppercase tracking-wide text-faint">{label}</span>
        <span>{current}</span>
        <span className="text-faint" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
            <div
              className="fixed z-50 w-60 overflow-hidden rounded-card border border-border bg-card shadow-popover"
              style={{ top: pos.top, left: pos.left }}
              role="listbox"
              aria-label={label}
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs outline-none transition-colors duration-100 hover:bg-elevated focus-visible:bg-elevated",
                    o.value === value ? "text-foreground" : "text-secondary",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.count !== undefined && <span className="tabular-nums text-faint">{o.count}</span>}
                  {o.value === value && (
                    <span className="shrink-0 text-primary" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
