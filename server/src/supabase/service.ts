/**
 * Service-role Supabase access, re-exported from the vendored db layer so the whole backend has
 * ONE source for Storage (blobs) and JWT verification. The service-role key bypasses RLS and is
 * server-only — never send it to the browser.
 *
 * `verifyUserJwt` — used by the auth middleware to identify the caller from their Bearer token.
 * `mintSignedUrl` / `uploadArtifact` — used by blob endpoints (screenshots, raw HTML, exports).
 */
export {
  getServiceClient,
  verifyUserJwt,
  mintSignedUrl,
  uploadArtifact,
  ensureBuckets,
  BUCKETS,
} from "../db/src/storage/supabaseStorage.js";
export type {
  JwtVerifyResult,
  SignedUrlResult,
  UploadResult,
  BucketEnsureResult,
} from "../db/src/storage/supabaseStorage.js";
