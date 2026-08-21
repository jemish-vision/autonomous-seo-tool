/** Flesch readability + keyword density — zero dependencies, same well-known formulas every
 * readability tool uses (Flesch 1948 / Kincaid 1975). Operates on already-extracted content text. */
import type { KeywordCount, KeywordDensityReport, ReadabilityReport } from "../models/types";

const EMPTY_READABILITY: ReadabilityReport = {
  fleschReadingEase: null,
  fleschKincaidGrade: null,
  sentences: 0,
  syllables: 0,
  averageWordsPerSentence: 0,
  band: "not enough text",
};

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Vowel groups minus a silent trailing "e"; never returns less than 1. English spelling has no
 * closed-form syllable rule, so every implementation of this is a heuristic, not a dictionary. */
function syllablesIn(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return (trimmed.match(/[aeiouy]{1,2}/g) ?? []).length || 1;
}

function easeBand(ease: number): string {
  if (ease >= 90) return "very easy — around 5th grade";
  if (ease >= 80) return "easy — 6th grade";
  if (ease >= 70) return "fairly easy — 7th grade";
  if (ease >= 60) return "plain English — 8th to 9th grade";
  if (ease >= 50) return "fairly hard — 10th to 12th grade";
  if (ease >= 30) return "hard — university level";
  return "very hard — postgraduate";
}

/** Flesch Reading Ease + Flesch-Kincaid Grade, from word/sentence/syllable counts alone. */
export function computeReadability(text: string): ReadabilityReport {
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  // Sentence enders, but not the dot inside "3.5" or "e.g." — approximate, not a real tokenizer.
  const sentences = (text.match(/[.!?]+(?=\s|$)/g) ?? []).length || (words.length ? 1 : 0);
  if (words.length === 0 || sentences === 0) return EMPTY_READABILITY;

  const syllables = words.reduce((n, w) => n + syllablesIn(w), 0);
  const wordsPerSentence = words.length / sentences;
  const syllablesPerWord = syllables / words.length;
  const ease = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;

  return {
    fleschReadingEase: round(ease, 1),
    fleschKincaidGrade: round(grade, 1),
    sentences,
    syllables,
    averageWordsPerSentence: round(wordsPerSentence, 1),
    band: easeBand(ease),
  };
}

/** Small common-English stopword list — enough to keep density meaningful without a dependency. */
const STOPWORDS = new Set(
  `a an the and or but if then else when while of to in on at by for with about against between
   into through during before after above below from up down out off over under again further
   here there all any both each few more most other some such no nor not only own same so than too
   very s t can will just don should now is are was were be been being have has had do does did
   this that these those i you he she it we they me him her us them my your his its our their
   what which who whom as it's i'm you're he's she's we're they're`
    .split(/\s+/)
    .filter(Boolean)
);

function tally(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of list) m.set(item, (m.get(item) ?? 0) + 1);
  return m;
}

function topTerms(counts: Map<string, number>, total: number, limit: number): KeywordCount[] {
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count, density: round((count / total) * 100, 2) }));
}

/** 1- and 2-word term frequency, stopword-filtered — the only on-page relevance signal captured. */
export function computeKeywordDensity(text: string, limit = 10): KeywordDensityReport {
  const tokens = (text.toLowerCase().match(/[a-z][a-z'’-]{1,}/g) ?? []).filter(
    (w) => w.length > 2 && !STOPWORDS.has(w)
  );
  const total = tokens.length || 1;
  const pairs = tokens.slice(0, -1).map((w, i) => `${w} ${tokens[i + 1]}`);

  return {
    totalTerms: tokens.length,
    oneWord: topTerms(tally(tokens), total, limit),
    twoWord: topTerms(tally(pairs), total, limit),
  };
}
