import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A designed explainer, ported from the reference poc's HintTip: a titled card with an accent
 *  bar, a body that understands **bold** and paragraph breaks, and an optional label→value list.
 *
 *  It portals to <body> deliberately — ancestors that set overflow (the toolbar, finding rows)
 *  silently clip an in-tree popover. Escape closes it, scrolling closes it.
 */
const rich = (text: string): ReactNode =>
  text.split("\n\n").map((para, i) => (
    <p key={i}>
      {para.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <b key={j} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </b>
        ) : (
          <span key={j}>{part}</span>
        ),
      )}
    </p>
  ));

interface Props {
  title: string;
  body: string;
  rows?: [string, string][];
  children?: ReactNode;
  label?: string;
}

export function HintTip({ title, body, rows, children, label = "What this means" }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open || !ref.current) return undefined;
    const place = () => {
      const r = ref.current!.getBoundingClientRect();
      const W = 320;
      setPos({
        top: r.bottom + 8,
        // keep the card on screen when the trigger sits near the right edge
        left: Math.max(12, Math.min(r.left, window.innerWidth - W - 12)),
      });
    };
    place();
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.focus();
      }
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="inline-flex items-center gap-1 text-[11px] text-faint outline-none transition-colors duration-150 hover:text-secondary focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        {children ?? "ⓘ"}
      </button>
      {open && pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
            <div
              className="fixed z-50 w-80 rounded-card border border-border bg-card shadow-popover"
              style={{ top: pos.top, left: pos.left }}
              role="dialog"
              aria-label={title}
            >
              <div className="h-1 rounded-t-card bg-primary" />
              <div className="p-3.5">
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <div className="mt-1.5 space-y-1.5 text-xs leading-relaxed text-secondary">{rich(body)}</div>
                {rows && rows.length > 0 && (
                  <dl className="mt-2 space-y-1 border-t border-border pt-2">
                    {rows.map(([k, v]) => (
                      <div key={k} className="flex items-baseline justify-between gap-3">
                        <dt className="shrink-0 text-[11px] text-faint">{k}</dt>
                        <dd className="truncate text-right text-[11px] font-medium text-foreground">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
