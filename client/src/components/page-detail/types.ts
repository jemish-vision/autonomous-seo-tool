/** Aliases onto the canonical shapes in lib/types.ts, which now carries the v3 extraction fields.
 * Kept so the panels' import names stay stable; there is no second definition to drift. */
import type { CrawledPageWithId } from "@/lib/types";

export type {
  MetaTagRecord as HeadMetaTag,
  OgImageRecord as OgImage,
  HeadMetaReport as HeadMeta,
  HeadBoundary,
  CharsetInfo,
  BaseHrefInfo,
  IconRecord as FaviconCandidate,
  FaviconReport as FaviconsInfo,
  FontFaceRecord as FontFace,
  FontReport as FontsInfo,
  HeadingRecord as HeadingOutlineEntry,
  DocumentStructure as PageStructureInfo,
} from "@/lib/types";

export type StrandedSignal = { signal: string; tag: string; honoured: boolean };

/** CrawledPageWithId already carries the v3 fields — this alias remains only for import stability. */
export type ExtendedCrawledPage = CrawledPageWithId;
