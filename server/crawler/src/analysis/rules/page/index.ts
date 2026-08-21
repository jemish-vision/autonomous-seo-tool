/** Slice A3 implements — page-scope rule packs registered here. */
import type { CrawledPage, Issue, RuleMeta } from "../../../models/types";
import type { AnalysisConfig } from "../../config";
import { contentRules } from "./content";
import { fontRules } from "./fonts";
import { headRules } from "./head";
import { httpRules } from "./http";
import { imageRules } from "./images";
import { indexabilityRules } from "./indexability";
import { onPageRules } from "./on-page";
import { renderDivergenceRules } from "./render-divergence";
import { securityRules } from "./security";
import { socialRules } from "./social";
import { structureRules } from "./structure";
import { structuredDataReportRules } from "./structured-data-report";
import { structuredDataRules } from "./structured-data";
import { transportRules } from "./transport";

export interface PageRule {
  meta: RuleMeta;
  /** Pure: same page + config → same findings. Missing dataRequirements → return null (skipped). */
  evaluate(page: CrawledPage, config: AnalysisConfig): Issue[] | null;
}

export function pageRules(): PageRule[] {
  return [
    ...onPageRules(),
    ...indexabilityRules(),
    ...imageRules(),
    ...structuredDataRules(),
    ...structuredDataReportRules(),
    ...socialRules(),
    ...contentRules(),
    ...httpRules(),
    ...securityRules(),
    ...transportRules(),
    ...headRules(),
    ...fontRules(),
    ...structureRules(),
    ...renderDivergenceRules(),
  ];
}
