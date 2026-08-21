/**
 * SERP title/description pixel-width ESTIMATE — not a browser measurement.
 *
 * Table provenance: per-1000-em character advance widths from Adobe's standard Base-14
 * Helvetica AFM metrics (public-domain font metrics shipped with every PostScript/PDF
 * implementation). Arial is Microsoft's metric-compatible substitute for Helvetica (same
 * advance widths by design), and Google's desktop SERP renders title/snippet text in an
 * Arial-family sans-serif — so Helvetica's published metrics are a reasonable stand-in.
 * Real rendering varies by OS font hinting, kerning, and Google's actual SERP CSS/font at
 * request time, so this is deliberately an estimate, flagged as such on the type
 * (`PixelWidths` doc comment) and never treated as exact.
 */
const HELVETICA_WIDTHS_PER_1000: Readonly<Record<string, number>> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
  "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584,
};

/** Chars outside the table (accented Latin, CJK, emoji, ...) fall back to the average lowercase width. */
const FALLBACK_WIDTH_PER_1000 = 556;

const TITLE_FONT_SIZE_PX = 20; // approximates Google desktop SERP title rendering
const DESC_FONT_SIZE_PX = 14; // approximates Google desktop SERP snippet rendering

function estimatePx(text: string, fontSizePx: number): number {
  let unitsSum = 0;
  for (const ch of text) {
    unitsSum += HELVETICA_WIDTHS_PER_1000[ch] ?? FALLBACK_WIDTH_PER_1000;
  }
  return Math.round((unitsSum / 1000) * fontSizePx);
}

export function estimateTitlePx(title: string | null | undefined): number | null {
  if (!title) return null;
  return estimatePx(title, TITLE_FONT_SIZE_PX);
}

export function estimateMetaDescriptionPx(description: string | null | undefined): number | null {
  if (!description) return null;
  return estimatePx(description, DESC_FONT_SIZE_PX);
}
