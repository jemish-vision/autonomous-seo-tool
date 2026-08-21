const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aug 20, 2026", formatted deterministically from UTC parts. Use this — never
 *  toLocaleDateString — for any date that renders inside a component that both the server and the
 *  browser render (every "use client" component is SSR'd first). toLocaleDateString picks the
 *  runtime's locale, so the server emits "20 Aug 2026" and the browser "Aug 20, 2026", which React
 *  reports as a hydration mismatch. UTC parts also keep the day stable across timezones. */
export function formatShortDate(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
