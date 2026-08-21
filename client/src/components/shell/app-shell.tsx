import { useEffect, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { useLocation, useSearchParams } from "react-router-dom";
import { PanelLeftOpen } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { NAV_SECTIONS } from "./nav-config";
import { SlideOver } from "@/components/ui/slide-over";
import { readStoredCollapsed, writeStoredCollapsed } from "@/lib/sidebar-collapse";
import { pickDefaultRun } from "@/lib/run-selection";
import { cn } from "@/lib/cn";
import { useRuns } from "@/api/crawls";

/**
 * Self-contained client layout: fetches the run list itself (React Query) and renders the matched
 * child route via <Outlet />. The old Next.js version received runs/runCount/reportPath as props
 * from a server layout; in Vite the shell owns that fetch. `reportPath` is dropped — the Sidebar
 * never consumed it.
 */
export function AppShell() {
  const { data: runs = [] } = useRuns();
  const runCount = runs.length;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useLocation().pathname;
  const [searchParams] = useSearchParams();
  const allItems = NAV_SECTIONS.flatMap((s) => s.items);

  useEffect(() => {
    setCollapsed(readStoredCollapsed());
  }, []);

  function toggleCollapsed(next: boolean) {
    setCollapsed(next);
    writeStoredCollapsed(next);
  }

  const run = searchParams.get("run");
  // Effective run for the command palette's rule index: same rule as the RunSelector (valid ?run=
  // wins, otherwise the newest substantial run) so the palette always has a run to fetch rules for.
  const currentRun = (run && runs.find((r) => r.runId === run)) || pickDefaultRun(runs);
  const withRun = (href: string) => (run ? `${href}?run=${encodeURIComponent(run)}` : href);

  function iconLink(item: (typeof allItems)[number]) {
    const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        to={withRun(item.href)}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-primary",
          active ? "bg-elevated text-foreground shadow-[inset_2px_0_0_0_var(--primary)]" : "text-secondary hover:bg-subtle",
        )}
      >
        <Icon size={18} strokeWidth={1.75} />
      </Link>
    );
  }

  return (
    <div
      className={cn(
        "grid h-dvh w-full grid-rows-[minmax(0,1fr)] transition-[grid-template-columns] duration-200",
        collapsed
          ? "grid-cols-1 lg:grid-cols-[64px_1fr]"
          : "grid-cols-1 lg:grid-cols-[264px_1fr]",
      )}
    >
      {/* Desktop expanded sidebar (>= 1024px) */}
      <aside className={cn("min-h-0 flex-col overflow-y-auto border-r border-border bg-card", collapsed ? "hidden" : "hidden lg:flex")}>
        <Sidebar runCount={runCount} onCollapse={() => toggleCollapsed(true)} />
      </aside>

      {/* Desktop collapsed rail (>= 1024px) */}
      {collapsed && (
        <aside className="hidden min-h-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card py-4 lg:flex">
          <button
            type="button"
            onClick={() => toggleCollapsed(false)}
            aria-label="Expand sidebar"
            className="mb-2 flex h-9 w-9 items-center justify-center rounded-control text-secondary outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary"
          >
            <PanelLeftOpen size={18} strokeWidth={1.75} />
          </button>
          {allItems.map(iconLink)}
        </aside>
      )}

      {/* Mobile & Tablet slide-over navigation drawer (< 1024px) */}
      <SlideOver
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        title="Navigation"
        side="left"
        widthClassName="w-full max-w-[280px]"
        bodyClassName="p-0"
      >
        <Sidebar runCount={runCount} onNavigate={() => setMobileNavOpen(false)} />
      </SlideOver>

      <div className="flex min-h-0 min-w-0 flex-col">
        <Topbar runs={runs} onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3.5 sm:p-5 lg:p-6">
          <Outlet />
        </main>
      </div>

      <CommandPalette runs={runs} runId={currentRun?.runId ?? null} />
    </div>
  );
}
