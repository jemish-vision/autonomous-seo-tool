/**
 * Envelope encryption for Google refresh tokens (AES-256-GCM).
 *
 * A refresh token is a long-lived bearer credential to a user's Search Console data — it does not
 * expire on its own and cannot be invalidated from our side. Storing it in plaintext would make a
 * DB leak equivalent to handing over every connected Google account, so it is sealed before it ever
 * reaches Postgres.
 *
 * GCM rather than CBC because it authenticates as well as encrypts: a tampered ciphertext fails to
 * open instead of decrypting to garbage that then gets sent to Google.
 *
 * Ported from poc/seo-dashboard/lib/gsc/crypto.ts. The only adaptation: this app has no on-disk
 * GSC storage root, so the file-path export is dropped — the key derivation is unchanged.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SALT = "gsc-token-encryption-v1";

let cachedKey: Buffer | null = null;

/**
 * Derives the encryption key. Prefers a dedicated GSC_TOKEN_KEY so token encryption and any other
 * secret can rotate independently. Falls back to GSC_STATE_SECRET, then a dev constant. Rotating
 * the source secret makes stored tokens unreadable and every user must reconnect — a safe failure
 * (a reconnect prompt, not silent corruption).
 */
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const material = process.env.GSC_TOKEN_KEY?.trim() || process.env.GSC_STATE_SECRET?.trim() || "gsc-token-key-dev";
  cachedKey = scryptSync(material, SALT, KEY_BYTES);
  return cachedKey;
}

/** Returns `iv.authTag.ciphertext`, all base64url, safe for a text column. */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export class TokenDecryptionError extends Error {
  constructor() {
    super(
      "Stored Google token could not be decrypted. This normally means GSC_TOKEN_KEY or GSC_STATE_SECRET changed since it was saved — reconnect Search Console to store a fresh token.",
    );
    this.name = "TokenDecryptionError";
  }
}

export function decryptToken(sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 3) throw new TokenDecryptionError();

  try {
    const [iv, tag, data] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv(ALGORITHM, key(), iv as Buffer);
    decipher.setAuthTag(tag as Buffer);
    return Buffer.concat([decipher.update(data as Buffer), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenDecryptionError();
  }
}
