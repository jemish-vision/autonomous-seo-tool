import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { slug } from "./group-section";

interface Props {
  names: string[];
  counts: Record<string, { firing: number; critical: number }>;
}

/** The requirement areas as a rail that stays put. A long report scrolls past the point where
 *  anyone remembers which area they are in; this answers "where am I and what is left" without
 *  scrolling back. It is a shortcut only — every target is already rendered on the page.
 *
 *  The current section is tracked with IntersectionObserver rather than scroll maths, so it stays
 *  right when groups are collapsed and the page height changes underneath it. Hidden on small
 *  screens (the sections are all rendered, so the rail is a convenience, not a requirement). */
export function GroupNav({ names, counts }: Props) {
  const [here, setHere] = useState(names[0]);

  useEffect(() => {
    const seen = new Map<string, IntersectionObserverEntry>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e);
        // the topmost section currently on screen wins
        const visible = [...seen.values()]
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const target = names.find((n) => slug(n) === visible[0].target.id);
          if (target) setHere(target);
        }
      },
      { rootMargin: "-70px 0px -60% 0px" },
    );
    for (const n of names) {
      const el = document.getElementById(slug(n));
      if (el) io.observe(el);
    }
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join("|")]);

  return (
    <nav className="hidden w-52 shrink-0 md:block" aria-label="Requirement areas">
      <div className="sticky top-4">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Areas</p>
        <div className="space-y-1">
          {names.map((n) => {
            const c = counts[n] ?? { firing: 0, critical: 0 };
            const active = n === here;
            return (
              <a
                key={n}
                href={`#${slug(n)}`}
                aria-current={active ? "true" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(slug(n))?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-secondary hover:bg-subtle hover:text-foreground",
                )}
              >
                <span className="truncate">{n}</span>
                {/* the count is the point of the rail: what is left in each area */}
                <span
                  className={cn(
                    "shrink-0 rounded-pill px-2 py-0.5 text-xs font-semibold tabular-nums",
                    c.critical > 0
                      ? "bg-danger-bg text-danger"
                      : active
                        ? "bg-primary/15 text-primary"
                        : "bg-subtle text-faint",
                  )}
                >
                  {c.firing || "✓"}
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
