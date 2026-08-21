export const SIDEBAR_COLLAPSE_STORAGE_KEY = "sidebar-collapsed";

export function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === "1";
}

export function writeStoredCollapsed(collapsed: boolean): void {
  window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
}
