/**
 * Hand-reviewed automation classification, one entry per rule id this slice actually read the
 * source of. The rulebook grows live under concurrent edits from sibling slices — `registry.ts`
 * reads it at runtime and any id NOT in this map falls back to `DEFAULT_CLASSIFICATION`
 * (human-only, heuristic), never to auto-safe.
 *
 * Rule of thumb applied throughout: a fix is only auto-safe when its correct VALUE is
 * mechanically computable from data already captured (no prose, no business judgment) AND
 * reversible AND scoped to one page. "auto-with-review" still requires a computable value —
 * it just has a bigger blast radius (site-wide file/template) or a residual correctness risk
 * that needs a human look. Writing prose (titles, alt text, meta descriptions, schema business
 * data) is NEVER derivable by this tool — it has no content-generation component — so every
 * rule whose fix is "write better copy" is human-only regardless of how mechanical it sounds.
 */
import type { RuleClassification } from "./types";

export const DEFAULT_CLASSIFICATION: RuleClassification = {
  automation: "human-only",
  tier: "heuristic",
  rationale: "not individually reviewed yet (rule added after this slice's audit) — conservative default applied.",
};

/** The only four rules classified auto-safe. Kept deliberately small — see WORK_LOG.md for the
 * per-rule justification of each. Every one of these has a builder in ../fixplan/builders.ts. */
export const CLASSIFICATIONS: Record<string, RuleClassification> = {
  // ── indexability.ts ──────────────────────────────────────────────────────────────────
  noindex: { automation: "human-only", tier: "observed", rationale: "removing noindex changes indexing intent — a decision, not a value fix." },
  nofollow: { automation: "human-only", tier: "observed", rationale: "removing nofollow changes crawl intent — a decision, not a value fix." },
  "canonical-mismatch": { automation: "human-only", tier: "observed", rationale: "the mismatch may be intentional (deliberate cross-page canonicalization) — needs a human to confirm intent." },
  "canonical-absent": {
    automation: "auto-safe",
    tier: "observed",
    rationale: "self-referencing canonical = the page's own URL, mechanically computable, reversible, one page.",
  },
  "soft-404": { automation: "human-only", tier: "heuristic", rationale: "fix is a server status-code change (404/410) requiring routing config access, and whether removal is intentional is a judgment call." },
  "meta-refresh-present": { automation: "auto-with-review", tier: "observed", rationale: "redirect target is known, but replacing a meta-refresh with a real 301 is a server/routing config change outside a markup patch." },

  // ── content.ts ────────────────────────────────────────────────────────────────────────
  "thin-content": { automation: "human-only", tier: "heuristic", rationale: "needs new, substantive content written — content authoring." },
  "low-text-ratio": { automation: "human-only", tier: "heuristic", rationale: "rebalancing markup vs. content requires judgment on what's boilerplate." },
  "zero-word-content": { automation: "human-only", tier: "observed", rationale: "needs content written, or a deliberate noindex decision — either way, human judgment." },
  "low-readability": { automation: "human-only", tier: "heuristic", rationale: "rewriting prose for readability is content authoring, not a value swap." },

  // ── fonts.ts ──────────────────────────────────────────────────────────────────────────
  "font-preload-missing-crossorigin": {
    automation: "auto-with-review",
    tier: "observed",
    rationale: "adding crossorigin is always correct (fonts always fetch anonymous-CORS) and mechanical, but touches a <head> template with no fix-plan generator wired — held to review pending one.",
  },
  "font-display-blocking": { automation: "auto-with-review", tier: "observed", rationale: "swapping to font-display:swap is a computable value, but @font-face usually lives in a shared stylesheet — site-wide blast radius, needs sign-off." },
  "third-party-font-host": { automation: "human-only", tier: "observed", rationale: "self-hosting fonts is an asset-migration/infra task, not a value edit." },

  // ── head.ts ───────────────────────────────────────────────────────────────────────────
  "viewport-missing": { automation: "auto-with-review", tier: "observed", rationale: "standard value is well-known, but adding it can shift mobile layout — a rendering-risk change needs a look before shipping." },
  "viewport-blocks-zoom": { automation: "auto-with-review", tier: "observed", rationale: "removing user-scalable=no is mechanical, but some sites block zoom deliberately for app-like UX — sign-off first." },
  "charset-missing": { automation: "human-only", tier: "observed", rationale: "declaring utf-8 is only correct if the page's actual bytes ARE utf-8 — mis-declaring corrupts rendered text (mojibake), not a safe blind default." },
  "charset-not-effective": { automation: "human-only", tier: "observed", rationale: "same encoding-correctness risk as charset-missing, plus moving the tag is a template-structure fix." },
  "base-href-multiple": { automation: "human-only", tier: "observed", rationale: "which <base> tag is authoritative and what relative links depend on it needs template-level understanding." },
  "base-href-cross-origin": { automation: "human-only", tier: "observed", rationale: "whether the cross-origin base is intentional is a judgment call." },
  "head-signal-stranded": { automation: "human-only", tier: "observed", rationale: "root-cause is an HTML structure bug (an invalid element implicitly closing <head>) — a template fix, not a value patch." },
  "favicon-not-declared": { automation: "human-only", tier: "heuristic", rationale: "choosing which icon asset to declare is a content decision even when an implicit /favicon.ico exists." },

  // ── http.ts ───────────────────────────────────────────────────────────────────────────
  "http-error-4xx": { automation: "human-only", tier: "observed", rationale: "restore, redirect, or remove — the correct response is a judgment call, matches Kishan's status-4xx (manual)." },
  "http-error-5xx": { automation: "human-only", tier: "observed", rationale: "requires server-side investigation, matches Kishan's status-5xx (manual)." },
  "slow-page": { automation: "human-only", tier: "heuristic", rationale: "performance investigation with no single mechanical fix, matches Kishan's slow-response (manual)." },
  "no-compression": { automation: "auto-with-review", tier: "observed", rationale: "enabling gzip/brotli is an unambiguous, always-beneficial server-config flag, but needs infra access — matches Kishan's no-compression (review)." },
  "oversized-html": { automation: "human-only", tier: "heuristic", rationale: "trimming markup/pagination is an engineering effort, not a single computable value." },

  // ── images.ts ─────────────────────────────────────────────────────────────────────────
  "image-missing-alt": { automation: "human-only", tier: "observed", rationale: "accurate alt text requires understanding image content — no vision/captioning capability in this pipeline, so no correct value is derivable." },
  "image-empty-alt": { automation: "human-only", tier: "heuristic", rationale: "confirming an image is genuinely decorative (vs. needing real alt text) is a judgment call." },
  "image-bad-format": { automation: "auto-with-review", tier: "observed", rationale: "target format (webp/avif) is a known-good default, but re-encoding needs a real transcode pipeline and a human to verify the output renders correctly." },
  "image-missing-dimensions": {
    automation: "auto-safe",
    tier: "observed",
    rationale: "when the crawl's image-size probe measured real naturalWidth/naturalHeight, those are the browser-verified correct values — computable, reversible, one page. (Fix-plan skips any image the probe didn't measure — never guesses.)",
  },

  // ── on-page.ts ────────────────────────────────────────────────────────────────────────
  "url-too-long": { automation: "human-only", tier: "observed", rationale: "shortening a URL slug needs a 301 plus updating every internal link — routing change with site-wide blast radius, not reversible cheaply." },
  "title-missing": { automation: "human-only", tier: "observed", rationale: "writing a title is content authoring — no value is derivable without understanding the page." },
  "title-too-short": { automation: "human-only", tier: "observed", rationale: "same — expanding a title to be meaningful is content authoring." },
  "title-too-long": { automation: "human-only", tier: "observed", rationale: "shortening a title while keeping it meaningful is content authoring, not truncation." },
  "title-multiple": { automation: "human-only", tier: "observed", rationale: "which of the duplicate <title> tags is the intended one is a judgment call." },
  "meta-description-missing": { automation: "human-only", tier: "observed", rationale: "writing a meta description is content authoring." },
  "meta-description-too-short": { automation: "human-only", tier: "observed", rationale: "same — expanding meaningfully is content authoring." },
  "meta-description-too-long": { automation: "human-only", tier: "observed", rationale: "same — shortening meaningfully is content authoring." },
  "meta-description-multiple": { automation: "human-only", tier: "observed", rationale: "which duplicate tag is intended is a judgment call." },
  "h1-missing": { automation: "human-only", tier: "observed", rationale: "writing an H1 is content authoring." },
  "h1-multiple": { automation: "human-only", tier: "observed", rationale: "which H1 to keep vs. demote to H2/H3 is a judgment call." },
  "heading-hierarchy-skip": { automation: "human-only", tier: "observed", rationale: "inserting intermediate headings requires understanding document structure and authorial intent." },
  "heading-empty": { automation: "human-only", tier: "observed", rationale: "delete vs. fill with real text depends on whether the empty heading was intentional — a judgment call." },
  "title-h1-mismatch": { automation: "human-only", tier: "heuristic", rationale: "aligning title and H1 requires rewriting one of them meaningfully — content authoring." },
  "long-content-no-subheadings": { automation: "human-only", tier: "heuristic", rationale: "adding subheadings requires restructuring the content itself." },

  // ── security.ts ───────────────────────────────────────────────────────────────────────
  "security-headers-missing": { automation: "human-only", tier: "observed", rationale: "CSP specifically is site-specific and a wrong default can break the site's own scripts/styles — bundled with other headers in one finding, so the whole rule stays human-only." },

  // ── social.ts ─────────────────────────────────────────────────────────────────────────
  "og-missing": { automation: "human-only", tier: "observed", rationale: "og:title/description/image need real content decisions, even reusing an existing image is a choice." },
  "twitter-missing": { automation: "human-only", tier: "observed", rationale: "same reasoning as og-missing." },
  "og-incomplete": { automation: "human-only", tier: "observed", rationale: "filling in the missing og: keys is still a content decision." },

  // ── render-divergence.ts ──────────────────────────────────────────────────────────────
  "js-applied-noindex": { automation: "human-only", tier: "observed", rationale: "fix is finding and removing client-side code that injects noindex — a code investigation." },
  "noindex-in-raw-html-only": { automation: "human-only", tier: "observed", rationale: "same — requires code-level investigation of the render pipeline." },
  "canonical-changed-by-js": { automation: "human-only", tier: "observed", rationale: "determining which canonical (static or rendered) is correct needs investigation, then a code fix." },
  "content-requires-javascript": { automation: "human-only", tier: "heuristic", rationale: "fix is a server-rendering architecture change — a real engineering project, not a patch." },
  "render-added-nothing": { automation: "human-only", tier: "derived", rationale: "this is a crawl-tuning diagnostic (the render escalation heuristic may be over-firing), not a site defect with a fix." },

  // ── transport.ts ──────────────────────────────────────────────────────────────────────
  "page-not-https": { automation: "human-only", tier: "observed", rationale: "requires TLS/hosting config, matches Kishan's no-https (manual)." },
  "mixed-content": {
    automation: "auto-safe",
    tier: "observed",
    rationale: "http:→https: rewrite on a subresource whose host is already confirmed to serve this page over TLS — mechanical, reversible, one page.",
  },
  // oversized-html is classified under http.ts above (its actual rule-pack file is transport.ts, but it groups with the other size/perf checks there).

  // ── structured-data-report.ts ────────────────────────────────────────────────────────
  "structured-data-missing-recommended-property": { automation: "human-only", tier: "observed", rationale: "recommended properties (price, rating, etc.) need real business data this pipeline doesn't extract from visible page content." },
  "structured-data-unknown-type": { automation: "human-only", tier: "observed", rationale: "the correct schema.org type is a judgment call — not derivable from the typo alone." },
  "structured-data-missing-type": { automation: "human-only", tier: "observed", rationale: "the correct @type depends on page content — a judgment call." },
  "structured-data-missing-context": {
    automation: "auto-with-review",
    tier: "observed",
    rationale: "the value is always the same literal string (arguably as mechanical as canonical-absent), but rewriting an existing hand-authored JSON-LD block carries more risk of a serialization slip than appending one <link> tag — held to review, no fix-plan generator wired.",
  },
  "structured-data-invalid-context": { automation: "auto-with-review", tier: "observed", rationale: "same reasoning as structured-data-missing-context — mechanical value, but a JSON-block rewrite risk." },
  "structured-data-empty-block": { automation: "auto-with-review", tier: "observed", rationale: "deleting an empty script block is very safe, but still a template edit with no generator wired — conservative review tier." },
  "structured-data-no-json-ld": { automation: "human-only", tier: "observed", rationale: "converting legacy microdata/RDFa into JSON-LD is a markup-migration task, not a value patch." },
  "no-structured-data": { automation: "human-only", tier: "observed", rationale: "authoring structured data from nothing needs real content/business data." },

  // ── structure.ts ──────────────────────────────────────────────────────────────────────
  "main-landmark-missing": { automation: "human-only", tier: "observed", rationale: "wrapping content in <main> is a template restructuring with a real risk of breaking CSS/JS selectors keyed to the existing wrapper." },

  // ── structured-data.ts ────────────────────────────────────────────────────────────────
  "structured-data-parse-error": { automation: "human-only", tier: "observed", rationale: "the JSON syntax error can be anything — no mechanical fix for arbitrary broken JSON." },
  "structured-data-missing-required-property": { automation: "human-only", tier: "observed", rationale: "required properties (offers, headline) need real business data not captured elsewhere in the extraction." },
  "structured-data-type-mismatch": { automation: "human-only", tier: "heuristic", rationale: "deciding the correct @type for the page's actual topic is a content-judgment call." },
  "video-embed-without-schema": { automation: "human-only", tier: "observed", rationale: "VideoObject needs real name/description/thumbnail/uploadDate data." },

  // ── site/duplicates.ts ────────────────────────────────────────────────────────────────
  "duplicate-title": { automation: "human-only", tier: "derived", rationale: "writing unique titles per page is content authoring, matches Kishan's title-duplicate (review) only in that a draft could be generated — this pipeline generates no draft text, so human-only." },
  "duplicate-description": { automation: "human-only", tier: "derived", rationale: "same reasoning as duplicate-title." },
  "exact-duplicate-content": { automation: "human-only", tier: "derived", rationale: "merge, canonicalize, or differentiate is a structural/content decision." },
  "near-duplicate-content": { automation: "human-only", tier: "heuristic", rationale: "the Jaccard threshold is explicitly a could-legitimately-be-wrong cutoff, and the fix (differentiate or consolidate) is a content decision." },
  "url-variant-duplicate": { automation: "auto-with-review", tier: "derived", rationale: "content is proven byte-identical across variants and a self-referencing canonical is computable, but which URL form is 'the' canonical is a site preference — needs sign-off, matches Kishan's site-url-variants (review)." },

  // ── site/sitemap.ts ───────────────────────────────────────────────────────────────────
  "sitemap-404-entry": { automation: "human-only", tier: "derived", rationale: "remove-from-sitemap vs. fix-the-page is a branching decision, and sitemap.xml is typically CMS-generated, not hand-edited." },
  "sitemap-noindex-included": { automation: "human-only", tier: "derived", rationale: "same branching-decision and generated-file reasoning as sitemap-404-entry." },
  "sitemap-not-crawled": { automation: "human-only", tier: "derived", rationale: "could be intentional (an orphaned legacy entry) — needs a look before acting." },
  "crawled-not-in-sitemap": { automation: "auto-with-review", tier: "derived", rationale: "which URL to add is fully derivable from crawl data, but sitemap.xml is a shared generated file — matches Kishan's not-in-sitemap (review)." },
  "sitemap-too-many-urls": { automation: "human-only", tier: "observed", rationale: "splitting into an index requires re-architecting sitemap generation — a build/infra change." },
  "no-sitemap-found": { automation: "auto-with-review", tier: "derived", rationale: "a sitemap can be generated from the crawl's own URL list, but publishing it is a deployment action and the finding is site-wide, not one-page — matches Kishan's site-no-sitemap (review)." },
  "sitemap-lists-blocked-urls": { automation: "human-only", tier: "derived", rationale: "remove-from-sitemap vs. loosen-robots-disallow is a branching decision, matches Kishan's site-sitemap-robots-conflict (manual)." },
  "sitemap-page-no-inlinks": { automation: "human-only", tier: "derived", rationale: "choosing where to add an internal link is an editorial decision, matches Kishan's sitemap-page-no-inlinks (manual)." },
  "sitemap-url-noncanonical": { automation: "auto-with-review", tier: "derived", rationale: "the correct sitemap entry (the page's own canonical) is computable, but sitemap.xml is a shared generated file — matches Kishan's sitemap-url-noncanonical (review)." },
  "sitemap-lastmod-suspect": { automation: "human-only", tier: "heuristic", rationale: "fixing requires fixing the sitemap GENERATOR to stamp real per-page dates — investigative infra work, and 'suspect' is explicitly a pattern that can be wrong." },

  // ── site/robots.ts ────────────────────────────────────────────────────────────────────
  "robots-blocked": { automation: "human-only", tier: "observed", rationale: "confirming the block is intentional (vs. updating robots.txt) is a judgment call, matches Kishan's robots-blocked (manual) exactly." },
  "no-usable-robots-txt": { automation: "auto-with-review", tier: "observed", rationale: "a minimal permissive robots.txt is a known-good template, but publishing a new file is a deployment action — matches Kishan's site-no-robots (review)." },

  // ── site/link-consistency.ts ──────────────────────────────────────────────────────────
  "internal-link-scheme-mix": { automation: "auto-with-review", tier: "derived", rationale: "https is unambiguously correct once the crawl proves the host serves it, but one finding can span many links across many pages — bulk sweep needs review." },
  "internal-link-www-mix": { automation: "human-only", tier: "derived", rationale: "unlike the scheme mix, www vs. apex has no objectively correct answer — it's a branding/DNS decision, not derivable from crawl data." },

  // ── site/redirects.ts ─────────────────────────────────────────────────────────────────
  "redirect-chain": {
    automation: "auto-safe",
    tier: "derived",
    rationale: "final destination is directly observed in the page's own redirectChain — point the first hop straight at it. Mechanical, reversible, one page.",
  },
  "redirect-loop": { automation: "human-only", tier: "observed", rationale: "diagnosing why a redirect loops is an investigation, matches Kishan's site-redirect-loops (manual)." },
  "redirect-to-error": { automation: "human-only", tier: "derived", rationale: "repointing the redirect needs a human to pick the correct live destination, matches Kishan's site-redirect-to-error (manual)." },
  "redirect-temporary": { automation: "human-only", tier: "observed", rationale: "the rule's own fix is conditional on intent ('if the move is permanent...') — flipping 302 to 301 blindly can be actively wrong for a genuinely temporary redirect, and 301s cache hard. Diverges from Kishan's review classification for this reason." },
  "redirect-single-hop": { automation: "human-only", tier: "observed", rationale: "not a defect (informational), and the optional fix means locating and editing every referring page's link — needs a human to find them." },

  // ── site/orphans.ts, links.ts ─────────────────────────────────────────────────────────
  "orphan-page": { automation: "human-only", tier: "derived", rationale: "which pages should link here is an editorial decision, matches Kishan's orphan-page (manual)." },
  "weakly-linked": { automation: "human-only", tier: "derived", rationale: "same editorial-linking-strategy reasoning, matches Kishan's weak-inlinks (manual)." },
  "canonical-target-invalid": { automation: "human-only", tier: "derived", rationale: "picking a valid replacement canonical target is a judgment call." },
  "canonical-chain": { automation: "auto-with-review", tier: "derived", rationale: "final canonical target is directly observable by following the chain, matches Kishan's canonical-chain (review) exactly." },
  "broken-internal-link": { automation: "human-only", tier: "derived", rationale: "fix-or-remove, and which, needs a human decision, matches Kishan's links-broken-onpage (manual)." },
  "auth-required-link": { automation: "human-only", tier: "derived", rationale: "confirming the auth wall is intentional is a judgment call, informational by design." },
  "excessive-links": { automation: "human-only", tier: "heuristic", rationale: "trimming navigation/pagination is a structural decision, matches Kishan's excessive-links (manual)." },
  "vague-anchor-text": { automation: "human-only", tier: "heuristic", rationale: "writing descriptive anchor text is content authoring." },
  "high-empty-anchor-ratio": { automation: "human-only", tier: "heuristic", rationale: "same — anchor text needs to be written." },
  "page-no-internal-links": { automation: "human-only", tier: "observed", rationale: "choosing what to link to is an editorial decision." },

  // ── site/hreflang.ts ──────────────────────────────────────────────────────────────────
  "hreflang-not-reciprocal": { automation: "auto-with-review", tier: "derived", rationale: "the reciprocal tag's value is fully derivable from the source page's own hreflang entry, but it must be written onto a DIFFERENT page than the one the finding anchors to — cross-page write needs review. Matches Kishan's hreflang-no-return (review)." },

  // ── site/favicons.ts ──────────────────────────────────────────────────────────────────
  "favicon-inconsistent": { automation: "human-only", tier: "derived", rationale: "which of the conflicting favicons is 'the' correct one is not derivable from crawl data alone." },
};
