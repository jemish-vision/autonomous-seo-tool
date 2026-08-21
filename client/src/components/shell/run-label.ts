/** Runs are labelled by the site they crawled, not by runId (e.g. "ui-20260812-145824" says
 * when, never which site) — runId stays visible as a secondary/title attribute since it's the storage key. */
export function hostnameFor(startUrl: string): string {
  try {
    return new URL(startUrl).hostname;
  } catch {
    return startUrl;
  }
}

export function formatRunTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}
