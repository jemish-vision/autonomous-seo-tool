import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const SECTIONS = [
  { id: "issues", label: "Issues" },
  { id: "metadata", label: "Metadata" },
  { id: "head-metadata", label: "Head metadata" },
  { id: "head-integrity", label: "Head integrity" },
  { id: "favicons", label: "Favicons" },
  { id: "fonts", label: "Fonts" },
  { id: "headings", label: "Headings" },
  { id: "document-structure", label: "Document structure" },
  { id: "links", label: "Links" },
  { id: "images", label: "Images" },
  { id: "media", label: "Media" },
  { id: "structured-data", label: "Structured data" },
  { id: "content", label: "Content" },
  { id: "replay", label: "Replay" },
  { id: "redirects", label: "Redirects" },
  { id: "headers", label: "Headers" },
  { id: "crawl", label: "Crawl" },
];

/** Sticky, keyboard-reachable (native <a href="#id">), scroll-spied via IntersectionObserver.
 *  `main` (components/shell/app-shell.tsx, do-not-touch) is the actual scroll container, so we
 *  observe against it rather than the viewport. */
export function SectionNav() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const main = navRef.current?.closest("main");
    const elements = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { root: main ?? null, rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
    setActive(id);
  }

  return (
    <nav
      ref={navRef}
      aria-label="Page detail sections"
      className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto bg-canvas/95 px-1 py-2 backdrop-blur-sm lg:top-0 lg:mx-0 lg:max-h-[calc(100dvh-6rem)] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible lg:px-0"
    >
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          onClick={(e) => handleClick(e, s.id)}
          aria-current={active === s.id ? "true" : undefined}
          className={cn(
            "shrink-0 rounded-control px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary",
            active === s.id ? "bg-primary text-primary-contrast" : "text-secondary hover:bg-subtle hover:text-foreground",
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
