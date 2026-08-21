/** Document-structure rule pack over the v3 `structure` inventory. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { captured, capturedList, issueFor } from "./shared";

function mainLandmarkMissing(): PageRule {
  const meta: RuleMeta = {
    id: "main-landmark-missing",
    category: "structure",
    defaultSeverity: "notice",
    description: "Page declares no main landmark, so assistive tech has no \"skip to content\" target and content extractors cannot tell body copy from chrome.",
    howToFix: "Wrap the primary content in <main> (or an element with role=\"main\").",
    dataRequirements: ["structure", "content.contentAreaMethod"],
  };
  return {
    meta,
    evaluate(page, config) {
      // structure.landmarks only tracks the <main> ELEMENT, so role="main" has to come from
      // contentAreaMethod — without it we cannot tell a missing landmark from an ARIA one.
      if (!capturedList(page.structure?.landmarks) || !captured(page.content, "contentAreaMethod")) return null;
      if (page.structure.landmarks.includes("main") || page.content.contentAreaMethod === "role-main") return [];
      return [
        issueFor(meta, config, page, {
          message: `No main landmark. Landmarks present: ${page.structure.landmarks.length ? page.structure.landmarks.join(", ") : "none"}.`,
          evidence: [
            { field: "structure.landmarks", value: page.structure.landmarks },
            { field: "content.contentAreaMethod", value: page.content.contentAreaMethod },
          ],
        }),
      ];
    },
  };
}

export function structureRules(): PageRule[] {
  return [mainLandmarkMissing()];
}
