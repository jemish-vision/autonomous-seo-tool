export const THEME_STORAGE_KEY = "theme";
export type ThemePreference = "light" | "dark" | "system";

export function isThemePreference(v: string | null): v is ThemePreference {
  return v === "light" || v === "dark" || v === "system";
}

export function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return pref;
}

export function applyTheme(pref: ThemePreference): void {
  document.documentElement.setAttribute("data-theme", resolveTheme(pref));
}
