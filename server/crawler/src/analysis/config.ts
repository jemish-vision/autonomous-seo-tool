/** Slice A3 implements. Threshold defaults are Screaming-Frog-aligned per D-08 — every default
 * documents its source in analysis.config.json. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IssueSeverity } from "../models/types";

export interface AnalysisConfig {
  rulebookVersion: string;
  /** Per-rule overrides: severity and/or enabled=false. */
  rules: Record<string, { severity?: IssueSeverity; enabled?: boolean }>;
  thresholds: {
    titleMinChars: number;
    titleMaxChars: number;
    titleMaxPx: number;
    descMinChars: number;
    descMaxChars: number;
    descMaxPx: number;
    thinContentWords: number;
    lowTextRatio: number;
    slowPageMs: number;
    redirectChainMax: number;
    /** @deprecated Superseded by nearDupSimilarity (slice C3: real MinHash/Jaccard similarity).
     * Left in place, unread by near-duplicate-content — another slice/config may still reference it. */
    nearDupWordCountDeltaPct: number;
    /** Jaccard similarity threshold (0..1) near-duplicate-content clusters at (slice C3). Optional
     * so pre-C3 configs still validate; the rule falls back to similarity.ts's own default (0.75). */
    nearDupSimilarity?: number;
    weakInlinkCount: number;
    /* Screaming Frog's published limits (verified 2026-08-13). Optional so pre-existing configs
     * and fixtures still validate; each rule falls back to the constant below. */
    titleMinPx?: number;
    descMinPx?: number;
    urlMaxChars?: number;
    /** Both are XML sitemap protocol HARD limits — a sitemap over either is invalid, not merely large. */
    sitemapMaxUrls?: number;
    sitemapMaxBytes?: number;
    /** 0..1 share of rendered words that must be JS-only for content-requires-javascript to fire. */
    jsOnlyContentRatio?: number;
    /* ── Slice: indexability/http/on-page/redirects/robots/sitemap/links port wave. All optional
     * so pre-existing configs still validate; each rule falls back to its own local default. ── */
    /** excessive-links: internal+external link count on one page past which it's flagged. */
    excessiveLinksCount?: number;
    /** page-buried-too-deep: crawl.depth past which a page is "buried". */
    deepPageDepth?: number;
    /** soft-404: word-count ceiling under which 404-style wording on a 200 is flagged. */
    soft404MaxWords?: number;
    /** long-content-no-subheadings: word count past which <=1 subheading is flagged. */
    longContentNoSubheadingsWords?: number;
    /** high-empty-anchor-ratio: share (0..1) of a page's links with blank anchor text. */
    emptyAnchorRatioMax?: number;
    /** no-compression: htmlBytes floor below which an uncompressed response isn't worth flagging. */
    noCompressionMinBytes?: number;
    /* content/structured-data/duplicates/orphans family port wave (data-rules audit). Same
     * optional + local-default-fallback pattern as the rest of this block. */
    /** low-readability: Flesch Reading Ease score below which body text is flagged. */
    fleschReadingEaseMin?: number;
    /** oversized-html: htmlBytes past which the document itself (not subresources) is flagged. */
    oversizedHtmlBytes?: number;
  };
}

/** Resolved relative to this file, not cwd, so `npm run analyze` works from any directory. */
const DEFAULT_CONFIG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../analysis.config.json");

interface RawConfigFile {
  rulebookVersion?: string;
  rules?: AnalysisConfig["rules"];
  thresholds?: Partial<AnalysisConfig["thresholds"]>;
  // _docs / _sources doc-header keys are tolerated and ignored.
  [key: string]: unknown;
}

async function readConfigFile(filePath: string): Promise<RawConfigFile> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as RawConfigFile;
}

function mergeRules(base: AnalysisConfig["rules"], override: AnalysisConfig["rules"] | undefined): AnalysisConfig["rules"] {
  const merged: AnalysisConfig["rules"] = { ...base };
  for (const [ruleId, ov] of Object.entries(override ?? {})) {
    merged[ruleId] = { ...merged[ruleId], ...ov };
  }
  return merged;
}

const THRESHOLD_KEYS = [
  "titleMinChars",
  "titleMaxChars",
  "titleMaxPx",
  "descMinChars",
  "descMaxChars",
  "descMaxPx",
  "thinContentWords",
  "lowTextRatio",
  "slowPageMs",
  "redirectChainMax",
  "nearDupWordCountDeltaPct",
  "weakInlinkCount",
] as const satisfies readonly (keyof AnalysisConfig["thresholds"])[];

const VALID_SEVERITIES: IssueSeverity[] = ["error", "warning", "notice"];

function validate(config: AnalysisConfig): void {
  if (!config.rulebookVersion) throw new Error("analysis config: rulebookVersion is required");
  for (const key of THRESHOLD_KEYS) {
    const value = config.thresholds[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`analysis config: thresholds.${key} must be a non-negative finite number, got ${String(value)}`);
    }
  }
  if (config.thresholds.titleMinChars >= config.thresholds.titleMaxChars) {
    throw new Error("analysis config: thresholds.titleMinChars must be < titleMaxChars");
  }
  if (config.thresholds.descMinChars >= config.thresholds.descMaxChars) {
    throw new Error("analysis config: thresholds.descMinChars must be < descMaxChars");
  }
  if (config.thresholds.lowTextRatio > 1) {
    throw new Error("analysis config: thresholds.lowTextRatio must be a 0..1 fraction");
  }
  if (config.thresholds.nearDupWordCountDeltaPct > 100) {
    throw new Error("analysis config: thresholds.nearDupWordCountDeltaPct must be a 0..100 percentage");
  }
  for (const [ruleId, override] of Object.entries(config.rules)) {
    if (override.severity && !VALID_SEVERITIES.includes(override.severity)) {
      throw new Error(`analysis config: rules.${ruleId}.severity "${override.severity}" is invalid`);
    }
  }
}

/**
 * Loads analysis.config.json (project root) as defaults, then deep-merges an optional user
 * override file (--config path) on top: thresholds merge per-key, rules merge per-ruleId.
 */
export async function loadConfig(configPath?: string): Promise<AnalysisConfig> {
  const defaultsRaw = await readConfigFile(DEFAULT_CONFIG_PATH);
  let overrideRaw: RawConfigFile = {};
  if (configPath && path.resolve(configPath) !== DEFAULT_CONFIG_PATH) {
    overrideRaw = await readConfigFile(configPath);
  }

  const merged: AnalysisConfig = {
    rulebookVersion: overrideRaw.rulebookVersion ?? defaultsRaw.rulebookVersion ?? "1.0.0",
    rules: mergeRules((defaultsRaw.rules ?? {}) as AnalysisConfig["rules"], overrideRaw.rules),
    thresholds: {
      ...(defaultsRaw.thresholds as AnalysisConfig["thresholds"]),
      ...(overrideRaw.thresholds ?? {}),
    },
  };

  validate(merged);
  return merged;
}
