import { useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { titleForPath, showRunSelectorFor } from "./nav-config";
import { RunSelector } from "./run-selector";
import { useTopbarActions } from "@/lib/topbar-actions-context";
import type { RunListItem } from "@/lib/data";

interface TopbarProps {
  runs: RunListItem[];
  onOpenMobileNav?: () => void;
  showMenuButton?: boolean;
}

export function Topbar({ runs, onOpenMobileNav, showMenuButton = true }: TopbarProps) {
  const pathname = useLocation().pathname;
  const { actions } = useTopbarActions();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-1.5 sm:gap-3 border-b border-border bg-card/80 backdrop-blur-sm px-2.5 sm:px-4 md:px-6">
      {/* Left side: Hamburger button + Title. Always preserved and never squished. */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 min-w-0 max-w-[45%] sm:max-w-none">
        {onOpenMobileNav && showMenuButton && (
          <button
            type="button"
            onClick={onOpenMobileNav}
            aria-label="Open navigation menu"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-border bg-subtle text-secondary hover:bg-elevated hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors lg:hidden"
          >
            <Menu size={18} strokeWidth={1.75} />
          </button>
        )}
        <h1 className="truncate text-xs sm:text-base font-semibold text-foreground">{titleForPath(pathname)}</h1>
      </div>

      {/* Right side: Run Selector + Actions */}
      <div className="flex items-center gap-1 sm:gap-2 min-w-0 shrink-0">
        {runs.length > 0 && showRunSelectorFor(pathname) && <RunSelector runs={runs} />}
        {actions}
      </div>
    </header>
  );
}
