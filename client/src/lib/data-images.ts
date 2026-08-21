/**
 * Client type shim for the old server-only `lib/data-images.ts`. Image rows are aggregated
 * server-side and returned by the API. Keeps ONLY the shared TYPES the /images UI imports.
 *
 * TODO(api): use @/api/images (GET /api/crawls/:id/images) for the ImageRow[] payload.
 */
export type AltState = "missing" | "empty" | "described";

export type SizeCategory = "normal" | "large" | "oversized";

export interface ImageRow {
  key: string;
  url: string;
  altState: AltState;
  alt: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  hasDimensions: boolean;
  sizeBytes: number | null;
  sizeCategory: SizeCategory | null;
  usageCount: number;
  pages: { pageId: string; url: string }[];
}
