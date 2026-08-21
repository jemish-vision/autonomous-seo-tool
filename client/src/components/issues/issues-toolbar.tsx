import { useEffect, useState } from "react";
import { Download, Search, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "./dropdown";
import { HintTip } from "./hint-tip";
import { cn } from "@/lib/cn";
import type { IssueSeverity } from "@/lib/types";
import type { AutomationLevel } from "@/lib/data-issue-extras";

export type IssueGroup = "area" | "priority" | "worst" | "since";

const GROUPS: { key: IssueGroup; label: string }[] = [
  { key: "area", label: "By area" },
  { key: "priority", label: "By priority" },
  { key: "worst", label: "Worst pages" },
  { key: "since", label: "Since last crawl" },
];

const SHOWS: { value: string; label: string }[] = [
  { value: "failing", label: "Needs fixing" },
  { value: "all", label: "All rules" },
  { value: "passed", label: "Passing" },
];

const SEVERITY_OPTIONS: { value: string; label: string }[] = [
  { value: "any", label: "All" },
  { value: "error", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "notice", label: "Notice" },
];

/** Debounced search over both the finding and the URLs it names — every keystroke would
 *  otherwise be a history entry and the back button would walk letter by letter out of it. */
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  // keep the field in sync when the URL query changes (back/forward) — adjusted during render,
  // not in an effect, so it cannot cascade
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(value);
  }
  useEffect(() => {
    if (text === value) return undefined;
    const t = setTimeout(() => onChange(text), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <span className="inline-flex h-9 w-full min-w-40 flex-1 items-center gap-2 rounded-control border border-border bg-subtle px-2.5 transition-colors duration-150 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25 sm:w-56 sm:flex-none">
      <Search size={13} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
      <input
        type="search"
        value={text}
        placeholder="Search findings or URLs…"
        aria-label="Search findings or URLs"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setText("");
            onChange("");
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-faint outline-none"
      />
      {text && (
        <button
          type="button"
          className="shrink-0 text-faint hover:text-secondary"
          onClick={() => {
            setText("");
            onChange("");
          }}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </span>
  );
}

const AUTOMATION_HINT: { title: string; body: string; rows: [string, string][] } = {
  title: "Automation level",
  body: "Whether a machine may apply the fix without a human deciding. Three questions, and **all three** must pass before anything is automatic:\n\n**1.** Is the correct value derivable without judgment?\n\n**2.** Is the change reversible?\n\n**3.** Is the blast radius one page, or the whole template?",
  rows: [
    ["⚡ auto-safe", "Apply it. Value is computable, change is reversible."],
    ["◐ needs review", "Generate the change; a human approves before it ships."],
    ["✋ human only", "Needs judgment, or is too dangerous to get wrong."],
  ],
};

const CONFIDENCE_HINT: { title: string; body: string; rows?: [string, string][] } = {
  title: "Confidence",
  body: "How much to trust the finding — derived from **how it was detected**, not assigned by hand.\n\n**Observed (100%)** — read straight off the page.\n\n**Derived (90%)** — needs crawl-wide knowledge, so it is only as complete as the crawl.\n\n**Heuristic (70%)** — a threshold or pattern that can legitimately be wrong.",
};

interface Props {
  group: IssueGroup;
  onGroup: (g: IssueGroup) => void;
  show: string;
  onShow: (v: string) => void;
  severity: IssueSeverity | null;
  onSeverity: (v: IssueSeverity | null) => void;
  /** Category (rulebook area) filter — options built from the areas present in the current view. */
  category: string | null;
  onCategory: (v: string | null) => void;
  categoryOptions: { value: string; label: string; count?: number }[];
  automation: AutomationLevel | "not-classified" | null;
  onAutomation: (v: AutomationLevel | "not-classified" | null) => void;
  automationOptions: { value: string; label: string; count?: number }[];
  /** "has" = rules with at least one generated AI recommendation; "ready" = rules the AI layer
   *  can generate for; null = no AI filter. Mirrors the other ?show=/?severity=/?fixType= params. */
  ai: string | null;
  onAi: (v: string | null) => void;
  aiOptions: { value: string; label: string; count?: number }[];
  filtersActive: boolean;
  onClear: () => void;
  q: string;
  onQChange: (v: string) => void;
  autoFixablePages: number;
  planOpen: boolean;
  onTogglePlan: () => void;
  onExportCsv: () => void;
}

/** ONE primary control is selected (the group pills); everything else stays quiet until it
 *  narrows something. Three rows of pills each showing a highlighted default would read as
 *  three active filters when nothing had been filtered at all. */
export function IssuesToolbar({
  group,
  onGroup,
  show,
  onShow,
  severity,
  onSeverity,
  category,
  onCategory,
  categoryOptions,
  automation,
  onAutomation,
  automationOptions,
  ai,
  onAi,
  aiOptions,
  filtersActive,
  onClear,
  q,
  onQChange,
  autoFixablePages,
  planOpen,
  onTogglePlan,
  onExportCsv,
}: Props) {
  const showRuleFilters = group === "area" || group === "priority";

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2.5 rounded-card border border-border bg-card px-3 py-2.5">
      {/* the ONE primary control: segmented group pills */}
      <div className="flex flex-wrap items-center gap-0.5 rounded-pill bg-subtle p-1" role="group" aria-label="View">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            aria-pressed={group === g.key}
            onClick={() => onGroup(g.key)}
            className={cn(
              "cursor-pointer rounded-pill px-3 py-1.5 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary",
              group === g.key ? "bg-primary text-primary-contrast shadow-card" : "text-secondary hover:text-foreground",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      {showRuleFilters && (
        <>
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <Dropdown
            label="Show"
            value={show}
            allValue="failing"
            onChange={onShow}
            options={SHOWS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <Dropdown
            label="Severity"
            value={severity ?? "any"}
            allValue="any"
            onChange={(v) => onSeverity(v === "any" ? null : (v as IssueSeverity))}
            options={SEVERITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          {categoryOptions.length > 0 && (
            <Dropdown
              label="Area"
              value={category ?? "any"}
              allValue="any"
              onChange={(v) => onCategory(v === "any" ? null : v)}
              options={[{ value: "any", label: "All areas" }, ...categoryOptions]}
            />
          )}
          <Dropdown
            label="Fix type"
            value={automation ?? "any"}
            allValue="any"
            onChange={(v) => onAutomation(v === "any" ? null : (v as AutomationLevel | "not-classified"))}
            options={automationOptions}
          />
          <Dropdown
            label="AI"
            value={ai ?? "any"}
            allValue="any"
            onChange={(v) => onAi(v === "any" ? null : v)}
            options={[{ value: "any", label: "All" }, ...aiOptions]}
          />
          {filtersActive && (
            <Button size="sm" variant="ghost" onClick={onClear}>
              Clear
            </Button>
          )}
          <SearchBox value={q} onChange={onQChange} />
          <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
            fix types<HintTip {...AUTOMATION_HINT} />
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
            confidence<HintTip {...CONFIDENCE_HINT} />
          </span>
        </>
      )}

      {group !== "since" && (
        <>
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <Button
            size="sm"
            variant="outline"
            aria-expanded={planOpen}
            onClick={onTogglePlan}
            className={cn(planOpen && "border-primary text-primary hover:bg-primary/5")}
          >
            <Wrench size={13} strokeWidth={1.75} aria-hidden="true" />
            {planOpen ? "Hide fix plan" : `Fix plan${autoFixablePages ? ` (${autoFixablePages})` : ""}`}
          </Button>
          <Button size="sm" variant="outline" onClick={onExportCsv}>
            <Download size={13} strokeWidth={1.75} aria-hidden="true" />
            Download CSV
          </Button>
        </>
      )}
    </div>
  );
}
