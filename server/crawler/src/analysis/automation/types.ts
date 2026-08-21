/**
 * FR-3.7 — classify every detectable issue by whether it can safely be fixed automatically.
 * Standalone map keyed by rule id (never edits src/analysis/rules/**), so it composes with
 * whatever rules exist at runtime and can't collide with concurrent rule-pack edits.
 */

/** auto-safe: apply it, the correct value is computable and reversible. auto-with-review:
 * we can compute a concrete change, but a human must sign off before it ships. human-only:
 * needs judgment (content authoring, intent, or a blast radius too large to risk). */
export type AutomationLevel = "auto-safe" | "auto-with-review" | "human-only";

/** How the underlying finding was arrived at — drives confidence, not hand-assigned.
 * observed: read straight off the page's own record. derived: needs crawl-wide
 * cross-referencing (only as complete as what was crawled). heuristic: a threshold or
 * pattern match that can legitimately be wrong. */
export type DetectionTier = "observed" | "derived" | "heuristic";

/** Confidence is a function of tier alone — never hand-tuned per rule (77+ rules and
 * growing would rot the moment one was hand-set and the rest weren't). */
export const TIER_CONFIDENCE: Record<DetectionTier, number> = {
  observed: 1,
  derived: 0.9,
  heuristic: 0.7,
};

export interface RuleClassification {
  automation: AutomationLevel;
  tier: DetectionTier;
  /** One-line why — shown in reports, not prose. */
  rationale: string;
}

export type EffortLevel = "low" | "medium" | "high";

export interface EffortResult {
  level: EffortLevel;
  why: string;
}
