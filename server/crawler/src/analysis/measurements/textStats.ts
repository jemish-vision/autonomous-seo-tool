/**
 * Flesch Reading Ease over already-extracted `content.text`. No new extraction field — every
 * input here is already stored. The syllable counter is a heuristic vowel-group approximation
 * (English-tuned), not a dictionary lookup, so treat the score as directional, the way this
 * codebase already treats lab web vitals (see LabWebVitals.note) rather than a lab-exact figure.
 */

export interface ReadingEaseResult {
  /** Flesch Reading Ease, roughly 0 (very hard) to 100 (very easy); can go outside that range on
   * unusual text. */
  score: number;
  sentences: number;
  words: number;
  syllables: number;
}

const TRAILING_SILENT_E = /(?:[^aeiouy]e|[^laeiouy]es|[^laeiouy]ed)$/;

/** Heuristic vowel-group count — not phonetically exact, but stable and dependency-free. */
function countSyllables(rawWord: string): number {
  const word = rawWord.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length === 0) return 0;
  if (word.length <= 3) return 1;
  const trimmed = word.replace(TRAILING_SILENT_E, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Sentence count via terminal punctuation; a floor of 1 avoids divide-by-zero on a single
 * fragment (e.g. a nav-only page with no full sentences). */
function countSentences(text: string): number {
  const matches = text.match(/[.!?]+(?:\s|$)/g);
  return matches && matches.length > 0 ? matches.length : 1;
}

/** null when there is no real text to score (empty/whitespace-only content). */
export function fleschReadingEase(text: string): ReadingEaseResult | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const sentences = countSentences(text);
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
  return { score: Math.round(score * 10) / 10, sentences, words: words.length, syllables };
}
