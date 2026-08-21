import { LayoutGrid, History, FileText, Map, ShieldAlert, GitCompare, ListTodo, Link2, ImageIcon, GitBranch, SearchCheck, Plug, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: "runs";
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

// Ordered to match how the tool is actually used: pick/start a run, review what it found,
// drill into the pages behind a finding, then compare or trace history (owner-directed regroup —
// previously one flat 8-item "Crawl data" bucket mixed findings, page drill-downs, and crawler-
// directive info with no structure).
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Start here",
    items: [
      { href: "/", label: "Overview", icon: LayoutGrid },
      { href: "/runs", label: "Runs", icon: History, badgeKey: "runs" },
      { href: "/queue", label: "Crawl queue", icon: ListTodo },
    ],
  },
  {
    label: "Findings",
    items: [
      { href: "/issues", label: "What to Fix.", icon: ShieldAlert },
      { href: "/sitemap", label: "Sitemap & Robots", icon: Map },
      { href: "/gsc", label: "Search Console", icon: SearchCheck },
    ],
  },
  {
    label: "Integrations",
    items: [
      { href: "/sources", label: "Sources", icon: Plug },
    ],
  },
  {
    label: "Explore pages",
    items: [
      { href: "/pages", label: "Pages", icon: FileText },
      // All Measurements removed from the sidebar per owner request 2026-08-14 — the measurements
      // grid renders inline on the Overview page. The /measurements route still exists; re-enable
      // by uncommenting.
      // { href: "/measurements", label: "All Measurements", icon: Gauge },
      { href: "/links", label: "Links", icon: Link2 },
      { href: "/images", label: "Images", icon: ImageIcon },
      { href: "/redirects", label: "Redirects", icon: GitBranch },
    ],
  },
  {
    label: "Compare & history",
    items: [
      { href: "/compare", label: "Compare", icon: GitCompare },
      // Activity Log removed from the sidebar per owner request 2026-08-14 — the New Crawl page
      // shows the same full event stream inline. The /activity route still exists (unreachable
      // from the nav); re-enable by uncommenting.
      // { href: "/activity", label: "Activity", icon: Activity },
    ],
  },
];

export const ROUTE_TITLES: { test: (path: string) => boolean; title: string }[] = [
  { test: (p) => p === "/", title: "Overview" },
  { test: (p) => p === "/runs", title: "Runs" },
  { test: (p) => p.startsWith("/pages/"), title: "Page detail" },
  { test: (p) => p === "/pages", title: "Pages" },
  { test: (p) => p === "/sitemap", title: "Sitemap & Robots" },
  { test: (p) => p === "/gsc", title: "Search Console" },
  { test: (p) => p === "/issues", title: "What to Fix." },
  { test: (p) => p === "/compare", title: "Compare" },
  // Activity Log — see the commented-out nav item above; the page is unreachable from the UI.
  // { test: (p) => p === "/activity", title: "Activity" },
  // All Measurements — see the commented-out nav item above.
  // { test: (p) => p === "/measurements", title: "All Measurements" },
  { test: (p) => p === "/queue", title: "Crawl queue" },
  { test: (p) => p === "/links", title: "Links" },
  { test: (p) => p === "/images", title: "Images" },
  { test: (p) => p === "/redirects", title: "Redirects" },
  { test: (p) => p === "/sources", title: "Sources" },
];

export function titleForPath(pathname: string): string {
  return ROUTE_TITLES.find((r) => r.test(pathname))?.title ?? "SEO Platform";
}

// Hidden where a single "current run" is meaningless: /new-crawl has no run yet, /runs IS the
// run list, /compare drives its own base/head pair via RunPairSelector.
const RUN_SELECTOR_HIDDEN_ON = new Set(["/new-crawl", "/runs", "/compare", "/queue", "/gsc"]);

export function showRunSelectorFor(pathname: string): boolean {
  return !RUN_SELECTOR_HIDDEN_ON.has(pathname);
}
