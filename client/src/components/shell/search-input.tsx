import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";

export function SearchInput() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  const run = searchParams.get("run");
  const withRun = (href: string) => (run ? `${href}${href.includes("?") ? "&" : "?"}run=${encodeURIComponent(run)}` : href);

  // Global "/" focuses search, like most dashboards — skipped when already typing somewhere.
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (typing) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    navigate(withRun(value ? `/pages?q=${encodeURIComponent(value)}` : "/pages"));
  }

  function onEscape(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") inputRef.current?.blur();
  }

  return (
    <form onSubmit={submit} role="search">
      <div className="flex h-8 items-center gap-2 rounded-control border border-border bg-subtle px-2.5 focus-within:ring-2 focus-within:ring-primary">
        <Search size={14} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onEscape}
          placeholder="Search pages..."
          aria-label="Search pages by URL"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-faint outline-none"
        />
        <kbd className="shrink-0 rounded-[4px] border border-border bg-elevated px-1 text-[10px] text-faint font-mono">/</kbd>
      </div>
    </form>
  );
}
