/**
 * npm run wp — CLI client for the autonomous-seo-connector WordPress plugin.
 *
 * Talks to /wp-json/autonomous-seo/v1/* with WordPress Application Passwords.
 * With --run <runId>, connection checks and every write (success or failure,
 * with the before/after receipt) are recorded under
 * storage/runs/<runId>/wordpress/.
 *
 * Credentials: flags override env vars, and the password is never printed,
 * echoed back, or stored in evidence — only the site URL is recorded.
 *
 *   --site URL       WP_SITE_URL | WP_SITE
 *   --user NAME      WP_USERNAME | WP_USER
 *   --password PASS  WP_APP_PASSWORD | WP_PASSWORD
 *   --api-key KEY    WP_API_KEY (optional shared key)
 */
import { parseArgs } from "node:util";
import path from "node:path";
import { existsSync } from "node:fs";
import { ConnectorError } from "./errors";
import { WordPressClient } from "./client";
import { WordPressEvidenceStore, type StoredReceipt } from "./evidence";
import { parseAssignments } from "./assignments";
import type { ChangeReceipt } from "./types";

const HELP_TEXT = `
seo-crawler-poc WordPress connector client — the platform half of the Fix & Apply bridge.

Usage:
  npm run wp -- [connection options] <command> [args]

Connection options (flag wins over env var):
  --site URL       WordPress site origin (WP_SITE_URL / WP_SITE)
  --user NAME      WordPress user, least privilege = Editor (WP_USERNAME / WP_USER)
  --password PASS  WordPress Application Password (WP_APP_PASSWORD / WP_PASSWORD)
  --api-key KEY    Optional shared API key from the connector settings (WP_API_KEY)
  --timeout MS     Per-request timeout (default: 30000)
  --run RUN_ID     Record evidence under storage/runs/<RUN_ID>/wordpress/ (writes only)
  --out DIR        Storage root used with --run (default: storage)
  --provider NAME  Explicit SEO provider for seo-set (required when the site has
                   more than one supported SEO provider active)

Commands:
  status                     Connection + version + detected SEO provider
  capabilities               What this site safely supports
  resolve <url>              URL -> owning WordPress resource
  resource <type> <id>       Resource info (type: page|post|product|cpt)
  seo-get <type> <id>        Read supported SEO fields
  seo-set <type> <id> <field>=<value>...   Write SEO fields, print + store receipt
  media-get <id>             Attachment info incl. alt text
  media-set <id> <field>=<value>...        Write media fields (alt_text), print + store receipt

Writable SEO fields (per provider): title, description, canonical, robots
(robots takes JSON, e.g. robots={"index":false,"follow":true}). Values that
start with { or [ are parsed as JSON; everything else is a string.

  -h, --help       Show this help

Exit codes: 0 success, 1 any error.
`.trim();

function env(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : undefined;
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      site: { type: "string" },
      user: { type: "string" },
      password: { type: "string" },
      "api-key": { type: "string" },
      timeout: { type: "string" },
      run: { type: "string" },
      out: { type: "string" },
      provider: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const command = positionals[0];
  if (!command) {
    console.error("Error: missing <command>.\n");
    console.log(HELP_TEXT);
    process.exit(1);
  }

  const siteUrl = values.site ?? env("WP_SITE_URL") ?? env("WP_SITE");
  const username = values.user ?? env("WP_USERNAME") ?? env("WP_USER");
  const appPassword = values.password ?? env("WP_APP_PASSWORD") ?? env("WP_PASSWORD");
  if (!siteUrl) fail("missing --site URL (or WP_SITE_URL env)");
  if (!username) fail("missing --user NAME (or WP_USERNAME env)");
  if (!appPassword) fail("missing --password PASS (or WP_APP_PASSWORD env)");

  let timeoutMs = 30_000;
  if (values.timeout !== undefined) {
    timeoutMs = Number(values.timeout);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      fail(`--timeout must be a positive number of milliseconds (got "${values.timeout}")`);
    }
  }

  const runId = values.run;
  const outDir = values.out ?? "storage";
  let evidence: WordPressEvidenceStore | null = null;
  if (runId !== undefined) {
    const runDir = path.resolve(outDir, "runs", runId);
    if (!existsSync(runDir)) {
      fail(`--run ${runId}: no run directory at ${runDir} — receipts belong to a real run`);
    }
    evidence = new WordPressEvidenceStore(runDir);
  }

  const client = new WordPressClient({ siteUrl, username, appPassword, apiKey: values["api-key"], timeoutMs });

  const writeReceipt = async (entry: Omit<StoredReceipt, "runId" | "siteUrl" | "recordedAt">): Promise<StoredReceipt> => {
    const stored: StoredReceipt = {
      runId: runId ?? "(no-run)",
      siteUrl: client.siteOrigin,
      recordedAt: new Date().toISOString(),
      ...entry,
    };
    if (evidence) {
      const file = await evidence.recordReceipt(stored);
      console.log(`\nReceipt stored: ${file}`);
    }
    return stored;
  };

  const args = positionals.slice(1);

  switch (command) {
    case "status": {
      const status = await client.status();
      console.log(JSON.stringify(status, null, 2));
      if (evidence) {
        const file = await evidence.recordConnection(client.siteOrigin, status);
        console.log(`\nConnection recorded: ${file}`);
      }
      break;
    }

    case "capabilities": {
      const caps = await client.capabilities();
      console.log(JSON.stringify(caps, null, 2));
      break;
    }

    case "resolve": {
      const url = args[0];
      if (!url) fail("resolve requires <url>");
      const result = await client.resolveUrl(url);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "resource": {
      const [type, idRaw] = args;
      const id = Number(idRaw);
      if (!type || !idRaw || !Number.isInteger(id) || id <= 0) {
        fail("resource requires <type> <id> (numeric)");
      }
      const result = await client.getResource(type, id);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "seo-get": {
      const [type, idRaw] = args;
      const id = Number(idRaw);
      if (!type || !idRaw || !Number.isInteger(id) || id <= 0) {
        fail("seo-get requires <type> <id> (numeric)");
      }
      const result = await client.getSeo(type, id);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "seo-set": {
      const [type, idRaw, ...assignments] = args;
      const id = Number(idRaw);
      if (!type || !idRaw || !Number.isInteger(id) || id <= 0) {
        fail("seo-set requires <type> <id> <field>=<value>...");
      }
      const changes = parseAssignments(assignments);
      try {
        const receipt = await client.updateSeo(type, id, changes, values.provider);
        console.log(JSON.stringify(receipt, null, 2));
        await writeReceipt({
          success: true,
          operation: receipt.operation,
          resource: receipt.resource,
          provider: receipt.provider,
          requestedChanges: changes,
          changes: receipt.changes,
          connectorTimestamp: receipt.timestamp,
        });
      } catch (err) {
        if (err instanceof ConnectorError) {
          console.error(`error: ${err.code} — ${err.message}`);
          await writeReceipt({
            success: false,
            operation: "update_seo",
            resource: { type, id },
            provider: values.provider,
            requestedChanges: changes,
            changes: (err.details.changes as ChangeReceipt | undefined) ?? {},
            error: { code: err.code, message: err.message, status: err.status },
          });
          process.exit(1);
        }
        throw err;
      }
      break;
    }

    case "media-get": {
      const idRaw = args[0];
      const id = Number(idRaw);
      if (!idRaw || !Number.isInteger(id) || id <= 0) {
        fail("media-get requires <id> (numeric)");
      }
      const result = await client.getMedia(id);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "media-set": {
      const [idRaw, ...assignments] = args;
      const id = Number(idRaw);
      if (!idRaw || !Number.isInteger(id) || id <= 0) {
        fail("media-set requires <id> <field>=<value>...");
      }
      const changes = parseAssignments(assignments);
      try {
        const receipt = await client.updateMedia(id, changes);
        console.log(JSON.stringify(receipt, null, 2));
        await writeReceipt({
          success: true,
          operation: receipt.operation,
          resource: receipt.resource,
          requestedChanges: changes,
          changes: receipt.changes,
          connectorTimestamp: receipt.timestamp,
        });
      } catch (err) {
        if (err instanceof ConnectorError) {
          console.error(`error: ${err.code} — ${err.message}`);
          await writeReceipt({
            success: false,
            operation: "update_media",
            resource: { type: "attachment", id },
            requestedChanges: changes,
            changes: (err.details.changes as ChangeReceipt | undefined) ?? {},
            error: { code: err.code, message: err.message, status: err.status },
          });
          process.exit(1);
        }
        throw err;
      }
      break;
    }

    default:
      fail(`unknown command "${command}" — see --help`);
  }
}

main().catch((err) => {
  if (err instanceof ConnectorError) {
    console.error(`error: ${err.code} — ${err.message}`);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});