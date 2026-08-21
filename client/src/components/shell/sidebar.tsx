import { useState } from "react";
import { Link } from "react-router-dom";
import { useLocation, useSearchParams } from "react-router-dom";
import { Radar, PanelLeftClose, Plus, Minus } from "lucide-react";
import { NAV_SECTIONS } from "./nav-config";
import { SearchInput } from "./search-input";
import { SignOutItem } from "./sign-out-item";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/cn";

interface Props {
  runCount: number;
  reportPath?: string;
  onNavigate?: () => void;
  onCollapse?: () => void;
}

export function Sidebar({ runCount, onNavigate, onCollapse }: Props) {
  const pathname = useLocation().pathname;
  const [searchParams] = useSearchParams();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Forwards the selected run across sections; destination pages fall back to latest on an
  // absent/invalid ?run= (lib/data.ts resolveRunId), so this is safe to forward as-is.
  const run = searchParams.get("run");
  const withRun = (href: string) => (run ? `${href}?run=${encodeURIComponent(run)}` : href);

  function toggleSection(label: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-primary text-primary-contrast">
          <Radar size={18} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">SEO Platform</p>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-control text-faint outline-none hover:bg-subtle hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary lg:flex"
          >
            <PanelLeftClose size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="px-4 pb-2.5">
        <SearchInput />
      </div>

      <div className="px-4 pb-3">
        <Link
          to={withRun("/new-crawl")}
          onClick={onNavigate}
          className="flex w-full items-center justify-center gap-2 rounded-control bg-primary px-3 py-2 text-xs font-semibold text-primary-contrast shadow-sm hover:opacity-95 transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
          <span>New Crawl</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-3">
        {NAV_SECTIONS.map((section) => {
          const isCollapsed = collapsedSections.has(section.label);
          return (
            <div key={section.label}>
              <div className="flex items-center justify-between px-2 pb-1.5">
                <button
                  type="button"
                  onClick={() => toggleSection(section.label)}
                  aria-expanded={!isCollapsed}
                  className="flex flex-1 items-center justify-between text-[11px] font-semibold uppercase tracking-[0.04em] text-faint hover:text-foreground transition-colors outline-none focus-visible:ring-1 focus-visible:ring-primary rounded py-0.5"
                >
                  <span>{section.label}</span>
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded text-faint hover:text-foreground hover:bg-subtle transition-colors"
                    title={isCollapsed ? `Expand ${section.label}` : `Collapse ${section.label}`}
                  >
                    {isCollapsed ? (
                      <Plus size={12} strokeWidth={2.5} aria-hidden="true" />
                    ) : (
                      <Minus size={12} strokeWidth={2.5} aria-hidden="true" />
                    )}
                  </span>
                </button>
              </div>

              {!isCollapsed && (
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          to={withRun(item.href)}
                          onClick={onNavigate}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm outline-none transition-colors duration-150",
                            "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                            active
                              ? "bg-elevated font-semibold text-primary"
                              : "font-medium text-secondary hover:bg-subtle hover:text-foreground",
                          )}
                        >
                          <Icon
                            size={16}
                            strokeWidth={active ? 2.25 : 1.75}
                            className={active ? "text-primary" : undefined}
                            aria-hidden="true"
                          />
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.badgeKey === "runs" && (
                            <span className="rounded-pill border border-border bg-elevated px-1.5 text-[11px] tabular-nums text-secondary">
                              {runCount}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-border px-4 py-4">
        <div>
          <p className="px-0.5 pb-1.5 text-[11px] font-medium text-faint">Account</p>
          <ThemeToggle />
        </div>
        <SignOutItem />
      </div>
    </div>
  );
}
