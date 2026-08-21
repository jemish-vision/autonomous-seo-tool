/**
 * One template per supported category. Ported verbatim from
 * poc/seo-dashboard/lib/ai-recommend/prompts.ts (only the ./types import gained a .js extension).
 * Each template owns category-specific instructions, a JSON Schema the provider enforces via
 * constrained decoding, and a user-prompt builder. Pure — no filesystem.
 */
import type { AiContextPack, AiRecommendationCategory, JsonSchema } from "./types.js";

export const PROMPT_VERSION = "v6";

export const SYSTEM_PREAMBLE = `
You are an SEO content assistant fixing ONE already-confirmed issue on ONE real web page.
Hard rules — never break them:
1. Only use facts present in the "Evidence" / "Page context" given to you below. Never invent
   prices, brand names, statistics, dates, or claims that are not present in what you were given.
2. Every recommendation must cite which piece of evidence justified it, in "basedOn" — field name
   plus the value you used from it.
3. If you cannot produce a safe, specific, grounded value from the given context, set
   needsHumanInput=true, leave recommendedValuePlain as an empty string, and explain what's
   missing in needsHumanInputReason. Do NOT guess just to fill the field.
4. Output MUST match the given JSON schema exactly — no prose outside the JSON fields.
5. Never use filler like "image of", "picture of", "click here", or restate a URL slug verbatim as
   if it were written content.
6. Be specific to THIS page's actual content — a recommendation that would look equally at home on
   any other page in this rule's finding list is not acceptable.
7. whyThisValue must be a CLEAR EXPLANATION (2-4 sentences) of why this fix is needed: the SEO
   impact of the defect on THIS page (search visibility, click-through rate, user experience,
   indexing) and why this exact value addresses it — grounded in basedOn, written so a non-technical
   site owner understands.
8. howToApply must be CONCRETE, NUMBERED, STEP-BY-STEP instructions ("1. ...", "2. ...", "3. ..."):
   which file/CMS field to edit, what to replace with what, and how to verify the change worked.
   Never a vague single sentence like "add it to the page".
`.trim();

const BASED_ON_SCHEMA: JsonSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      field: { type: "string", description: "Name of the evidence field used, e.g. 'headings.h1[0]' or 'topKeywords'." },
      value: { type: "string", description: "The value from that field, as text." },
    },
    required: ["field", "value"],
  },
};

function baseSchema(recommendedValueDescription: string): JsonSchema {
  return {
    type: "object",
    properties: {
      whatIsWrong: { type: "string", description: "Plain-language restatement of the defect, grounded in the evidence given." },
      recommendedValuePlain: { type: "string", description: recommendedValueDescription },
      whyThisValue: { type: "string", description: "Why this fix is needed and why this exact value is right for THIS page — 2-4 sentences explaining the SEO impact (visibility, click-through, user experience) and the reasoning, grounded in basedOn." },
      basedOn: BASED_ON_SCHEMA,
      howToApply: { type: "string", description: "Numbered step-by-step instructions (1., 2., 3., ...) for where to edit, what to replace, and how to verify — specific to this page and fix." },
      selfReportedConfidence: { type: "number", description: "Your own confidence 0.0-1.0 — recorded for audit only, not authoritative." },
      needsHumanInput: { type: "boolean", description: "True if you could not (or must not) produce a safe grounded value." },
      needsHumanInputReason: { type: "string", nullable: true, description: "Required when needsHumanInput is true; null otherwise." },
    },
    required: ["whatIsWrong", "recommendedValuePlain", "whyThisValue", "basedOn", "howToApply", "selfReportedConfidence", "needsHumanInput"],
  };
}

export interface PromptTemplate {
  category: AiRecommendationCategory;
  instructions: string;
  schema: JsonSchema;
  buildUserPrompt(pack: AiContextPack): string;
  usesVision: boolean;
}

function pageSignalsLine(pack: AiContextPack): string | null {
  const s = pack.pageSignals;
  if (!s) return null;
  const parts = [
    `HTTP ${s.statusCode ?? "?"}`,
    s.canonical ? `canonical=${s.canonical}` : "no canonical tag",
    s.noindex ? "noindex" : "indexable" + (s.nofollow ? "/nofollow" : ""),
    `${s.internalLinkCount} internal / ${s.externalLinkCount} external links`,
    `${s.imageCount} images (${s.imagesMissingAlt} missing alt)`,
    s.structuredDataTypes.length > 0 ? `JSON-LD: ${s.structuredDataTypes.join(", ")}` : "no JSON-LD",
    s.videoCount > 0 ? `${s.videoCount} videos` : null,
    `response ${s.responseTimeMs ?? "?"}ms`,
  ];
  if (s.h4to6.length > 0) parts.push(`H4-H6: ${s.h4to6.map((h) => `${h.level}.${h.text}`).join(" | ")}`);
  return `Page signals: ${parts.filter((x): x is string => Boolean(x)).join("; ")}.`;
}

function pageIssuesLines(pack: AiContextPack): string[] {
  const issues = pack.pageIssues ?? [];
  if (issues.length === 0) return ["Other issues on this page: none."];
  return [
    `Other issues on this page (${issues.length}${(pack.pageIssues?.length ?? 0) >= 8 ? "+ listed first 8" : ""}):`,
    ...issues.map((i) => `  - ${i.ruleId} [${i.severity}]: ${i.message}`),
  ];
}

function pageContextLines(pack: AiContextPack): string[] {
  return [
    `Page URL: ${pack.url ?? "(unknown)"}`,
    `Current title: ${pack.pageTitle ?? "(none)"}`,
    `Current meta description: ${pack.metaDescription ?? "(none)"}`,
    `H1: ${pack.h1.join(" | ") || "(none)"}`,
    `H2s: ${pack.h2.join(" | ") || "(none)"}`,
    `H3s: ${pack.h3.join(" | ") || "(none)"}`,
    `Derived top keywords: ${pack.topKeywords.join(", ") || "(none)"}`,
    `Word count: ${pack.wordCount ?? "(unknown)"}`,
    `Content excerpt: ${pack.contentExcerpt ?? "(none captured)"}`,
    ...(pageSignalsLine(pack) ? [pageSignalsLine(pack)!] : []),
    ...pageIssuesLines(pack),
  ];
}

function constraintLine(pack: AiContextPack): string {
  const c = pack.constraints;
  const parts: string[] = [];
  if (c.minChars !== undefined || c.maxChars !== undefined) parts.push(`length must be ${c.minChars ?? 0}-${c.maxChars ?? "∞"} characters`);
  if (c.minPx !== undefined || c.maxPx !== undefined) parts.push(`estimated SERP pixel width must be ${c.minPx ?? 0}-${c.maxPx ?? "∞"}px`);
  return parts.length > 0 ? `Constraints: ${parts.join("; ")}.` : "Constraints: none beyond being accurate and specific.";
}

const IMAGE_ALT: PromptTemplate = {
  category: "image-alt",
  usesVision: true,
  instructions: `
Task: this <img> either has no alt attribute (rule image-missing-alt) or has an explicitly empty
one (rule image-empty-alt — see "Rule" below).
- If the image is genuinely decorative (a spacer, a background flourish, a repeat of text already
  on the page), then alt="" is CORRECT — say so in whatIsWrong and set recommendedValuePlain to
  exactly "" (the empty string) with needsHumanInput=false.
- Otherwise write the exact alt text to use: if the image is attached, describe what it actually
  shows, specifically (e.g. "red running shoes", not "a shoe" or "footwear") — ground this in
  what you can see.
- The image's DOM position is strong evidence of what it depicts — use the nearest heading,
  figcaption, wrapping link, and surrounding text given below to disambiguate (a product image
  under an H2 about care instructions is a care shot, not a product shot).
- If the image could not be attached, use the page context AND the image's DOM position to write
  a specific, honest description — do not invent visual details you were not given, and prefer
  needsHumanInput=true if the context is too thin to be specific.
- Keep it under 125 characters. No "image of"/"picture of" prefix. No keyword stuffing.
- recommendedValuePlain is the alt text ONLY — no markup, no surrounding quotes.
`.trim(),
  schema: baseSchema("The alt text to use — plain text only, no markup, no quotes."),
  buildUserPrompt(pack) {
    const img = pack.image!;
    const c = img.context;
    const contextLines = c
      ? [
          c.nearbyHeading ? `Nearest preceding heading: ${c.nearbyHeading}` : null,
          c.figcaption ? `Figcaption: ${c.figcaption}` : null,
          c.linkHref ? `Wrapped in a link to: ${c.linkHref}${c.linkTitle ? ` (title: ${c.linkTitle})` : ""}` : null,
          c.surroundingText ? `Surrounding text: ${c.surroundingText}` : null,
        ].filter((x): x is string => Boolean(x))
      : [];
    return [
      `Page URL: ${pack.url ?? "(unknown)"}`,
      `Page title: ${pack.pageTitle ?? "(none)"}`,
      `Page H1: ${pack.h1.join(", ") || "(none)"}`,
      `Derived top keywords: ${pack.topKeywords.join(", ") || "(none)"}`,
      `Image URL: ${img.url}`,
      `Image dimensions: ${img.width ?? "?"}x${img.height ?? "?"} (${img.format ?? "unknown format"})`,
      ...contextLines,
      img.imageDataUrl ? "The image itself is attached to this message." : "The image could not be fetched — base your answer ONLY on the page context above; prefer needsHumanInput=true if that context is too thin to be specific.",
      constraintLine(pack),
    ].join("\n");
  },
};

const TITLE: PromptTemplate = {
  category: "title",
  usesVision: false,
  instructions: `
Task: this page's <title> tag is missing, too short, too long, or duplicated (see "Rule" and
"Issue message" below). FIRST assess the CURRENT title against the page's actual content; THEN
write the exact title to use.

STEP 1 — Assess the current title (if one exists):
- Relevance: does it describe what this page's actual content (content excerpt, H1, top
  keywords) is really about? A title that contradicts or ignores the page's content is itself a
  defect.
- Quality: flag typos and capitalization errors (e.g. "lot" instead of "IoT", "Iot" instead of
  "IoT"), keyword stuffing or redundancy (the same phrase repeated — e.g. a "... Empowering X
  with Y" tail that just restates the first half), generic filler ("Home", "Welcome",
  "Untitled"), or a verbatim restatement of the URL slug.
- If the current title is already accurate, relevant, and well-written, keep it (or make only a
  minimal improvement to fit the constraint) and say so in whyThisValue.

STEP 2 — Write the corrected title:
- Ground it in the page's actual primary topic: H1, content excerpt, top keywords.
- NEVER copy a typo or capitalization error from the current title into your answer — fix it
  (e.g. "lot" → "IoT"). When the excerpt contains the correctly-spelled term, prefer it.
- Rewrite keyword-stuffed / redundant phrasing into natural, concise title text — one clear
  topic, not the same keyword repeated twice.
- Never a generic placeholder, never a fabricated product/brand name, never the URL slug
  restated verbatim.
- If the operator supplied a brand name in "Business facts" below, you may append it as a suffix
  ("— Brand") when it fits the length constraint; never invent one.
- Aim for the given length/pixel-width constraints.

In whatIsWrong, state what you found: a missing title, OR the specific defect of the current one
(irrelevant to the content, typo/capitalization error, keyword-stuffed/redundant, or the rule's
own length/duplication problem). recommendedValuePlain is the title text ONLY — no <title> tags,
no quotes.
`.trim(),
  schema: baseSchema("The exact <title> text to use — plain text only, no markup, no quotes."),
  buildUserPrompt: (pack) => {
    const brand = pack.businessContext.brand;
    return [...pageContextLines(pack), brand ? `Business facts: brand=${brand}` : "Business facts: (none configured)", constraintLine(pack)].join("\n");
  },
};

const META_DESCRIPTION: PromptTemplate = {
  category: "meta-description",
  usesVision: false,
  instructions: `
Task: this page's meta description is missing, too short, too long, or duplicated. Write the
exact meta description to use.
- Summarize the page's ACTUAL content excerpt and H1 — do not copy it verbatim, and do not invent
  a claim or offer that isn't in the content excerpt or other given context.
- The description must read as written for THIS page specifically, grounded in its own H1, top
  keywords and content excerpt — never a generic blurb that would fit any page on the site.
- HARD LENGTH REQUIREMENT: the final text MUST be at most the maxChars in the constraint line
  below (count the characters). If your draft exceeds it, shorten it before answering — a
  too-long description is rejected and you will be asked to redo it.
- recommendedValuePlain is the description text ONLY — no <meta> tag, no quotes.
`.trim(),
  schema: baseSchema("The exact meta description text to use — plain text only, no markup, no quotes."),
  buildUserPrompt: (pack) => [...pageContextLines(pack), constraintLine(pack)].join("\n"),
};

const HEADING: PromptTemplate = {
  category: "heading",
  usesVision: false,
  instructions: `
Task: fix a heading-structure issue on this page (missing H1, multiple H1s, a skipped heading
level, an empty heading, a title/H1 mismatch, or long content with no subheadings — see "Rule" and
"Issue message" below for which one). Write the exact heading text to use.
- Reflect the page's actual primary topic and the surrounding content — a single, descriptive
  heading, not a restatement of the URL slug.
- Never propagate typos or capitalization errors from the current heading text into your answer
  — fix them (e.g. "lot" → "IoT"), grounding the correction in how the term appears elsewhere in
  the excerpt.
- If the issue requires a JUDGMENT CALL you cannot safely make from the given context alone (e.g.
  choosing which of several H1s to keep, or exactly where to insert a missing intermediate
  heading), set needsHumanInput=true and explain the decision a human needs to make.
- recommendedValuePlain is the heading text ONLY — no <h1>/<h2> tags, no quotes.
`.trim(),
  schema: baseSchema("The exact heading text to use — plain text only, no markup, no quotes."),
  buildUserPrompt: (pack) => [`Rule: ${pack.ruleId}`, `Issue message: ${pack.message}`, ...pageContextLines(pack), constraintLine(pack)].join("\n"),
};

const SOCIAL: PromptTemplate = {
  category: "social",
  usesVision: false,
  instructions: `
Task: this page is missing Open Graph and/or Twitter Card tags, or has some but not all of them.
Write the exact og:title/og:description (Twitter reuses the same values by default) to use.
- Reuse the page's title/meta-description content where accurate — do not invent a different
  message for social sharing than what the page actually says.
- recommendedValuePlain must be a single string in the exact form:
  "og:title=<title> | og:description=<description>" (both parts required, separated by " | ").
`.trim(),
  schema: baseSchema('A single string: "og:title=<title> | og:description=<description>" — plain text, no markup, no quotes around the values.'),
  buildUserPrompt(pack) {
    const s = pack.social!;
    return [
      ...pageContextLines(pack),
      `Existing og: tags: ${Object.entries(s.og).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`,
      `Existing twitter: tags: ${Object.entries(s.twitter).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`,
    ].join("\n");
  },
};

const DUPLICATE_CONTENT: PromptTemplate = {
  category: "duplicate-content",
  usesVision: false,
  instructions: `
Task: this page shares its title or meta description with one or more other pages on the same
site (listed below as "Other pages using this value"). Write a NEW value for THIS page only that
differentiates it, grounded in what makes THIS page's own content different from the others.
- Do not just append the page name — actually reflect what's distinct about this page's content.
- If this page's content excerpt is too similar to tell them apart, set needsHumanInput=true and
  say so — do not fabricate a difference that isn't really there.
- recommendedValuePlain is the new value ONLY (title or description text, matching whichever the
  rule below is about) — no markup, no quotes.
`.trim(),
  schema: baseSchema("The new, differentiated title or meta-description text — plain text only, no markup, no quotes."),
  buildUserPrompt(pack) {
    const peers = pack.duplicatePeers ?? [];
    return [
      `Rule: ${pack.ruleId} (differentiate ${pack.ruleId === "duplicate-title" ? "the <title>" : "the meta description"})`,
      ...pageContextLines(pack),
      `Other pages using this value:`,
      ...(peers.length > 0
        ? peers.map((p, i) => `  ${i + 1}. ${p.url} — title: ${p.title ?? "(none)"} — excerpt: ${p.contentExcerpt ?? "(none)"}`)
        : ["  (peer page records unavailable in this run)"]),
      constraintLine(pack),
    ].join("\n");
  },
};

const STRUCTURED_DATA: PromptTemplate = {
  category: "structured-data",
  usesVision: false,
  instructions: `
Task: this page's structured data (JSON-LD) is missing, missing a @type, missing a
required/recommended property, malformed, or using the wrong type — see "Rule" and "Issue
message" below for which. Propose ONLY properties whose values are directly derivable from the
page context given below (name from title, description from meta description, url from the page
URL, headline from H1) OR from the operator-supplied business facts (authoritative — see
"Business facts" below). NEVER invent business data that is neither in the page context nor in
the business facts — price, SKU, availability, rating, review count, author, or publish date. If
the missing property needs one of those and it isn't supplied, set needsHumanInput=true and name
exactly which property needs real business input.
- When "Raw JSON-LD block(s)" or "Parse error" lines are present below, your job is to REPAIR
  that actual block (fix the JSON syntax, the @type, or the @context) — keep everything that is
  already correct, change only what the error/rule calls for.
- recommendedValuePlain must be a single, valid, minified JSON object string — the repaired node,
  the properties to add, or the full suggested JSON-LD node when none exists yet.
`.trim(),
  schema: baseSchema("A single minified JSON object string — the JSON-LD properties to add (or full suggested node)."),
  buildUserPrompt(pack) {
    const sd = pack.structuredData!;
    const facts = Object.entries(pack.businessContext);
    const rawLines = (sd.rawBlocks ?? []).map((b, i) => `  ${i + 1}. ${b}`);
    const errorLines = (sd.errors ?? []).map((e, i) => `  ${i + 1}. ${e}`);
    return [
      `Rule: ${pack.ruleId}`,
      `Issue message: ${pack.message}`,
      ...pageContextLines(pack),
      `Business facts (operator-supplied, authoritative): ${facts.length > 0 ? facts.map(([k, v]) => `${k}=${v}`).join(", ") : "(none configured — treat every business field as unavailable)"}`,
      `Existing structured data types on this page: ${sd.existingTypes.join(", ") || "(none)"}`,
      `Missing required properties: ${sd.missingRequired.join(", ") || "(none listed)"}`,
      `Missing recommended properties: ${sd.missingRecommended.join(", ") || "(none listed)"}`,
      ...(rawLines.length ? [`Raw JSON-LD block(s):`, ...rawLines] : []),
      ...(errorLines.length ? [`Parse error(s):`, ...errorLines] : []),
    ].join("\n");
  },
};

const CANONICAL: PromptTemplate = {
  category: "canonical",
  usesVision: false,
  instructions: `
Task: this page has a canonical-tag conflict (points somewhere unexpected, or the target is
invalid). Whether the current canonical is intentional or a mistake is a judgment call this
pipeline cannot safely make on its own — you MUST set needsHumanInput=true for every answer in
this category. Still provide real value: clearly explain the conflict in whatIsWrong, and in
needsHumanInputReason tell a human exactly what to check and what the two plausible outcomes are
(keep the current canonical vs. point it at the page's own URL).
`.trim(),
  schema: baseSchema("Always an empty string for this category — leave blank, needsHumanInput is always true."),
  buildUserPrompt(pack) {
    const c = pack.canonicalInfo!;
    return [`Issue message: ${pack.message}`, `Page's own URL: ${c.selfUrl}`, `Current canonical tag value: ${c.currentCanonical ?? "(none)"}`, ...pageContextLines(pack).slice(0, 3)].join("\n");
  },
};

const CONTENT_BRIEF: PromptTemplate = {
  category: "content-brief",
  usesVision: false,
  instructions: `
Task: this page is thin, low on text relative to its markup, empty, or hard to read (see "Rule"
and "Issue message" below). Produce a CONTENT BRIEF — not a full rewrite — that a human writer
can follow to fix it.
- recommendedValuePlain must be a short, structured brief (a few sentences to a short list):
  what the page should cover (grounded in the page's URL, title, H1 and any existing text), a
  rough outline of 2-4 sections, and a target word count range.
- Do NOT invent facts about the business (prices, products, dates) that are not in the given
  context. The target word count is a recommendation you are allowed to make; it is not a fact
  claim about the page.
- This is guidance for a human writer, so needsHumanInput should be false — the brief itself is
  the deliverable. If the context is too empty to write anything grounded (e.g. a truly blank
  page), set needsHumanInput=true and say what's missing.
`.trim(),
  schema: baseSchema("The content brief — a short structured block of guidance text (no markup)."),
  buildUserPrompt: (pack) => [`Rule: ${pack.ruleId}`, `Issue message: ${pack.message}`, ...pageContextLines(pack), `Threshold: ${pack.threshold ?? "(none)"}`].join("\n"),
};

const DUPLICATE_CONTENT_REWRITE: PromptTemplate = {
  category: "duplicate-content-rewrite",
  usesVision: false,
  instructions: `
Task: this page's BODY CONTENT is identical or near-identical to one or more other pages (listed
below as "Other pages in this cluster"). Produce guidance for rewriting THIS page's content so it
is genuinely distinct — a short brief, not a full rewrite.
- Ground the guidance in what THIS page's own URL/title/H1/excerpt already say, and in how the
  peer pages are similar, so the rewrite targets the real overlap.
- Do NOT propose merging/canonicalizing — that is a separate, mechanical decision. Here the ask
  is: what should this page uniquely cover?
- If the pages are so similar that you cannot identify anything distinct to anchor the rewrite,
  set needsHumanInput=true and say so.
- recommendedValuePlain is the guidance text ONLY (no markup).
`.trim(),
  schema: baseSchema("Guidance for differentiating this page's content — plain text, no markup."),
  buildUserPrompt(pack) {
    const peers = pack.duplicatePeers ?? [];
    return [
      `Rule: ${pack.ruleId}`,
      `Issue message: ${pack.message}`,
      ...pageContextLines(pack),
      `Other pages in this cluster:`,
      ...(peers.length > 0
        ? peers.map((p, i) => `  ${i + 1}. ${p.url} — title: ${p.title ?? "(none)"} — excerpt: ${p.contentExcerpt ?? "(none)"}`)
        : ["  (peer page records unavailable in this run)"]),
    ].join("\n");
  },
};

const INTERNAL_LINK_ANCHOR: PromptTemplate = {
  category: "internal-link-anchor",
  usesVision: false,
  instructions: `
Task: an internal link on this page uses vague anchor text (e.g. "click here", "read more",
"this page"). Write descriptive replacement anchor text for that link, grounded in what the
TARGET page is actually about (its own title/H1, given below) — not this page's own content.
- Keep it short (a few words), natural as inline link text, and specific to the target page.
- recommendedValuePlain is the anchor text ONLY — no <a> tag, no quotes.
`.trim(),
  schema: baseSchema("The new anchor text ONLY — plain text, no markup, no quotes."),
  buildUserPrompt(pack) {
    const l = pack.linkInfo!;
    return [
      `Current (vague) anchor text: "${l.currentAnchor}"`,
      `Link target URL: ${l.targetUrl}`,
      `Target page title: ${l.targetTitle ?? "(none)"}`,
      `Target page H1: ${l.targetH1.join(", ") || "(none)"}`,
      `This page's own title (for context only — the anchor should describe the TARGET, not this page): ${pack.pageTitle ?? "(none)"}`,
    ].join("\n");
  },
};

export const PROMPT_TEMPLATES: Record<AiRecommendationCategory, PromptTemplate> = {
  "image-alt": IMAGE_ALT,
  title: TITLE,
  "meta-description": META_DESCRIPTION,
  heading: HEADING,
  social: SOCIAL,
  "duplicate-content": DUPLICATE_CONTENT,
  "duplicate-content-rewrite": DUPLICATE_CONTENT_REWRITE,
  "structured-data": STRUCTURED_DATA,
  canonical: CANONICAL,
  "internal-link-anchor": INTERNAL_LINK_ANCHOR,
  "content-brief": CONTENT_BRIEF,
};
