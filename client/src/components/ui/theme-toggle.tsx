import { useEffect, useState } from "react";
import { Sun, Moon, Monitor, type LucideIcon } from "lucide-react";
import { THEME_STORAGE_KEY, isThemePreference, applyTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/cn";

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeToggle() {
  // Matches SSR default (system) so hydration never mismatches; corrects itself post-mount.
  const [pref, setPref] = useState<ThemePreference>("system");

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate post-mount upgrade from the SSR-safe "system" default above, not derivable at render time (same pattern as components/preview/page-replay.tsx)
    if (isThemePreference(stored)) setPref(stored);
  }, []);

  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [pref]);

  function choose(next: ThemePreference) {
    setPref(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  }

  return (
    <div role="radiogroup" aria-label="Appearance" className="flex items-center gap-1 rounded-control border border-border bg-subtle p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          onClick={() => choose(value)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2 py-1.5 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary",
            pref === value ? "bg-card text-foreground shadow-card" : "text-secondary hover:text-foreground",
          )}
        >
          <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
