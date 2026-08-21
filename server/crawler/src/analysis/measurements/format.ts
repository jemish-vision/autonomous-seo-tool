/** Display-string formatters — pure functions, no locale surprises beyond en-US grouping. */

export function formatCount(n: number, noun: string): string {
  return `${Math.round(n).toLocaleString("en-US")} ${noun}${Math.round(n) === 1 ? "" : "s"}`;
}

export function formatMs(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} ms`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatScore(n: number): string {
  return n.toFixed(1);
}

export function formatWords(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} words`;
}

export function formatNodes(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} nodes`;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
