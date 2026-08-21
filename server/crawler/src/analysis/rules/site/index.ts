/** Slice A4 implements — site-scope passes over the whole run (registry). */
export type { SiteRule, SiteRuleContext } from "./types";
import type { SiteRule } from "./types";
import {
  duplicateTitleRule,
  duplicateDescriptionRule,
  exactDuplicateContentRule,
  nearDuplicateContentRule,
  urlVariantDuplicateRule,
} from "./duplicates";
import { orphanPageRule } from "./orphans";
import {
  sitemap404Rule,
  sitemapNoindexIncludedRule,
  inSitemapNotCrawledRule,
  crawledNotInSitemapRule,
  sitemapTooManyUrlsRule,
  noSitemapFoundRule,
  sitemapListsBlockedUrlsRule,
  sitemapPageNoInlinksRule,
  sitemapUrlNoncanonicalRule,
  sitemapLastmodSuspectRule,
} from "./sitemap";
import { robotsBlockedRule, noUsableRobotsTxtRule } from "./robots";
import { redirectChainRule, redirectLoopRule, redirectToErrorRule, redirectTemporaryRule, redirectSingleHopRule } from "./redirects";
import {
  weaklyLinkedRule,
  canonicalTargetValidityRule,
  brokenInternalLinkRule,
  authRequiredLinkRule,
  canonicalChainRule,
  excessiveLinksRule,
  vagueAnchorTextRule,
  highEmptyAnchorRatioRule,
  pageNoInternalLinksRule,
} from "./links";
import { internalLinkSchemeMixRule, internalLinkWwwMixRule } from "./link-consistency";
import { hreflangReciprocityRule } from "./hreflang";
import { faviconInconsistentRule } from "./favicons";

export function siteRules(): SiteRule[] {
  return [
    duplicateTitleRule,
    duplicateDescriptionRule,
    exactDuplicateContentRule,
    nearDuplicateContentRule,
    urlVariantDuplicateRule,
    orphanPageRule,
    sitemap404Rule,
    sitemapNoindexIncludedRule,
    inSitemapNotCrawledRule,
    crawledNotInSitemapRule,
    sitemapTooManyUrlsRule,
    noSitemapFoundRule,
    sitemapListsBlockedUrlsRule,
    sitemapPageNoInlinksRule,
    sitemapUrlNoncanonicalRule,
    sitemapLastmodSuspectRule,
    robotsBlockedRule,
    noUsableRobotsTxtRule,
    redirectChainRule,
    redirectLoopRule,
    redirectToErrorRule,
    redirectTemporaryRule,
    redirectSingleHopRule,
    weaklyLinkedRule,
    canonicalTargetValidityRule,
    brokenInternalLinkRule,
    authRequiredLinkRule,
    canonicalChainRule,
    excessiveLinksRule,
    vagueAnchorTextRule,
    highEmptyAnchorRatioRule,
    pageNoInternalLinksRule,
    internalLinkSchemeMixRule,
    internalLinkWwwMixRule,
    hreflangReciprocityRule,
    faviconInconsistentRule,
  ];
}
