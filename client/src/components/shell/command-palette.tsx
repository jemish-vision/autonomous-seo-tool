import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft } from "lucide-react";
import { NAV_SECTIONS } from "./nav-config";
import { cn } from "@/lib/cn";
import { hostnameFor, formatRunTimestamp } from "./run-label";
import type { RunListItem } from "@/lib/data";

/** One jump target in the palette. `run` carries an already-encoded ?run= value when the target
 *  is run-scoped (nav pages) — destinations fall back to latest on an absent param, so forward it. */
interface Entry {
  id: string;
  label: string;
  sub: string;
  href: string;
  group: string;
}

/** Cmd/Ctrl+K command palette — jump to any nav page, any run, any rule of the current run, or a
 *  free-text page-URL search, in one keystroke. Runs arrive as props (the shell already loads
 *  them); rules are fetched lazily on first open from the existing issues API (groupBy=rule,
 *  pageSize capped — the rule index, not the full finding payload). */
export function CommandPalette({ runs, runId }: { runs: RunListItem[]; runId: string | null }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [rules, setRules] = useState<{ ruleId: string; category: string; count: number }[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Which runId the rule index was fetched for — refetch when the selected run changes (a plain
  // boolean would go stale across run switches and dev HMR remounts).
  const fetchedForRunRef = useRef<string | null>(null);
  // Reset the query + cursor each open — same during-render sync pattern the explorer clients use
  // (adjusting state from a prop transition, not an effect, so the lint rule stays quiet).
  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) {
      setQ("");
      setCursor(0);
    }
  }

  // Global toggle: Cmd/Ctrl+K opens (or closes). Esc handled on the overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Focus the input on open (DOM, not state — allowed in an effect) and fetch the current run's
  // rules once (cached per runId via fetchedRef; the index is the rule list, not the payloads).
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (!runId || fetchedForRunRef.current === runId) return;
    fetchedForRunRef.current = runId;
    void fetch(`/api/crawls/${encodeURIComponent(runId)}/issues?groupBy=rule&pageSize=100`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const rows = (body?.data ?? []) as { ruleId?: string; category?: string; affectedPageCount?: number }[];
        setRules(
          rows
            .filter((g) => g.ruleId)
            .map((g) => ({ ruleId: g.ruleId!, category: g.category ?? "", count: g.affectedPageCount ?? 0 })),
        );
      })
      .catch(() => {
        // best-effort — palette still searches nav + runs without the rule index
      });
  }, [open, runId]);

  const qBase = runId ? `run=${encodeURIComponent(runId)}` : "";

  const entries: Entry[] = useMemo(() => {
    const list: Entry[] = [];
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        list.push({
          id: `nav-${item.href}`,
          label: item.label,
          sub: section.label,
          href: runId ? `${item.href}?${qBase}` : item.href,
          group: "Pages",
        });
      }
    }
    for (const r of runs) {
      list.push({
        id: `run-${r.runId}`,
        label: hostnameFor(r.startUrl),
        sub: `${formatRunTimestamp(r.startedAt)} · ${r.successful} pages · ${r.analyzed ? `health ${r.healthScore ?? "—"}` : "not analyzed"}`,
        href: `/?run=${encodeURIComponent(r.runId)}`,
        group: "Runs",
      });
    }
    for (const rule of rules ?? []) {
      list.push({
        id: `rule-${rule.ruleId}`,
        label: rule.ruleId.replace(/-/g, " "),
        sub: `${rule.category} · ${rule.count} ${rule.count === 1 ? "page" : "pages"}`,
        href: `/issues?${qBase}${qBase ? "&" : ""}rule=${encodeURIComponent(rule.ruleId)}`,
        group: "Rules",
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, rules, runId]);

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return entries;
    return entries.filter(
      (e) => e.label.toLowerCase().includes(needle) || e.sub.toLowerCase().includes(needle) || e.group.toLowerCase().includes(needle),
    );
  }, [entries, needle]);

  // Group the filtered list while keeping one flat cursor over it.
  const groups = useMemo(() => {
    const out: { group: string; items: Entry[] }[] = [];
    for (const e of filtered) {
      const g = out.find((x) => x.group === e.group);
      if (g) g.items.push(e);
      else out.push({ group: e.group, items: [e] });
    }
    return out;
  }, [filtered]);

  function jump(entry: Entry) {
    setOpen(false);
    navigate(entry.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (filtered.length ? (c + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (filtered.length ? (c - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[cursor]) jump(filtered[cursor]);
      else if (needle) jump({ id: "search", label: `Search pages for “${q.trim()}”`, sub: "Pages explorer", href: `/pages?${qBase}${qBase ? "&" : ""}q=${encodeURIComponent(q.trim())}`, group: "Pages" });
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-card border border-border bg-card shadow-popover">
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
          <Search size={15} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, run, rule, or search pages…"
            aria-label="Command palette search"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-faint outline-none"
          />
          <kbd className="shrink-0 rounded-[4px] border border-border bg-elevated px-1 text-[10px] font-mono text-faint">esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-faint">
              No matches — press Enter to search pages for “{q.trim()}”.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.group} className="mb-1">
                <p className="px-3.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{g.group}</p>
                {g.items.map((entry) => {
                  const idx = filtered.indexOf(entry);
                  const active = idx === cursor;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => jump(entry)}
                      onMouseEnter={() => setCursor(idx)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-sm outline-none",
                        active ? "bg-primary/10 text-foreground" : "text-secondary hover:bg-subtle",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{entry.label}</span>
                        <span className="block truncate text-xs text-faint">{entry.sub}</span>
                      </span>
                      {active && <CornerDownLeft size={13} strokeWidth={2} className="shrink-0 text-faint" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {needle && (
          <button
            type="button"
            onClick={() =>
              jump({ id: "search", label: `Search pages for “${q.trim()}”`, sub: "Pages explorer", href: `/pages?${qBase}${qBase ? "&" : ""}q=${encodeURIComponent(q.trim())}`, group: "Pages" })
            }
            className="flex w-full items-center justify-between gap-3 border-t border-border px-3.5 py-2 text-left text-sm text-secondary hover:bg-subtle outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="truncate">Search pages for “{q.trim()}”…</span>
            <CornerDownLeft size={13} strokeWidth={2} className="shrink-0 text-faint" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
