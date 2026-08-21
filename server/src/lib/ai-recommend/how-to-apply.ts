/** Presentation helpers for the AI card's "How to apply" section — the prompts demand numbered
 *  step-by-step instructions ("1. ...", "2. ..."), but older stored recommendations may be a
 *  single sentence. Ported verbatim from poc/seo-dashboard/lib/ai-recommend/how-to-apply.ts. Pure
 *  functions, no imports, no filesystem. (Primarily a client render helper — kept here for a
 *  complete port of the lib.) */

/** True when the text looks like a numbered step list (at least two lines, most starting with a
 *  number + period/paren). A single line — or prose without numbers — renders as a paragraph. */
export function isNumberedSteps(text: string): boolean {
  const lines = splitLines(text);
  if (lines.length < 2) return false;
  const numbered = lines.filter((l) => /^\d+[.)]/.test(l)).length;
  return numbered >= Math.ceil(lines.length / 2);
}

/** Split the howToApply text into trimmed, non-empty lines plus whether they read as numbered
 *  steps. */
export function splitHowToApply(text: string): { lines: string[]; numbered: boolean } {
  const lines = splitLines(text);
  return { lines, numbered: isNumberedSteps(text) };
}

function splitLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}
