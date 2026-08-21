/** Image alt / format / dimensions rule pack. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { issueFor } from "./shared";

/** Formats that are valid on the web but suboptimal for delivery vs. modern formats. */
const SUBOPTIMAL_FORMATS = new Set(["bmp", "tiff", "tif", "ico"]);

function imageMissingAlt(): PageRule {
  const meta: RuleMeta = {
    id: "image-missing-alt",
    category: "images",
    defaultSeverity: "warning",
    description: "Image has no alt attribute at all (distinct from an intentionally empty alt=\"\").",
    howToFix: "Add a descriptive alt attribute, or alt=\"\" if the image is purely decorative.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const offenders = page.images.map((img, i) => ({ img, i })).filter(({ img }) => img.alt === null);
      if (offenders.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `${offenders.length} image(s) missing an alt attribute.`,
          evidence: offenders.map(({ i }) => ({ field: `images[${i}].alt`, value: null })),
          threshold: `${offenders.length} of ${page.images.length} images`,
        }),
      ];
    },
  };
}

function imageEmptyAlt(): PageRule {
  const meta: RuleMeta = {
    id: "image-empty-alt",
    category: "images",
    defaultSeverity: "notice",
    description: "Image has an explicitly empty alt=\"\" — usually intentional for decorative images, flagged for review.",
    howToFix: "Confirm the image is decorative; add descriptive alt text if it conveys information.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const offenders = page.images.map((img, i) => ({ img, i })).filter(({ img }) => img.alt === "");
      if (offenders.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `${offenders.length} image(s) have an empty alt attribute.`,
          evidence: offenders.map(({ i }) => ({ field: `images[${i}].alt`, value: "" })),
          threshold: `${offenders.length} of ${page.images.length} images`,
        }),
      ];
    },
  };
}

function imageBadFormat(): PageRule {
  const meta: RuleMeta = {
    id: "image-bad-format",
    category: "images",
    defaultSeverity: "warning",
    description: "Image uses a suboptimal web format (bmp/tiff/ico).",
    howToFix: "Re-encode as webp/avif/jpg/png for smaller payloads and browser support.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const offenders = page.images
        .map((img, i) => ({ img, i }))
        .filter(({ img }) => img.format !== null && SUBOPTIMAL_FORMATS.has(img.format.toLowerCase()));
      if (offenders.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `${offenders.length} image(s) use a suboptimal format: ${offenders.map(({ img }) => img.format).join(", ")}.`,
          evidence: offenders.map(({ img, i }) => ({ field: `images[${i}].format`, value: img.format })),
        }),
      ];
    },
  };
}

function imageMissingDimensions(): PageRule {
  const meta: RuleMeta = {
    id: "image-missing-dimensions",
    category: "images",
    defaultSeverity: "notice",
    description: "Image has no width/height attributes, risking layout shift (CLS).",
    howToFix: "Add explicit width/height (or aspect-ratio CSS) so the browser can reserve space.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const offenders = page.images.map((img, i) => ({ img, i })).filter(({ img }) => img.width === null || img.height === null);
      if (offenders.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `${offenders.length} image(s) missing width and/or height.`,
          evidence: offenders.map(({ img, i }) => ({ field: `images[${i}]`, value: { width: img.width, height: img.height } })),
          threshold: `${offenders.length} of ${page.images.length} images`,
        }),
      ];
    },
  };
}

export function imageRules(): PageRule[] {
  return [imageMissingAlt(), imageEmptyAlt(), imageBadFormat(), imageMissingDimensions()];
}
