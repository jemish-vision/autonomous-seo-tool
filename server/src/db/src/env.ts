import path from "node:path";
import { fileURLToPath } from "node:url";

/** Loads packages/db/.env regardless of the caller's cwd (Node 20.6+ native, no dotenv dep). */
export function loadEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  try {
    (process as any).loadEnvFile(path.resolve(here, "../.env"));
  } catch {
    // already loaded by the shell, or file genuinely absent — callers that need it will fail loudly
  }
}
