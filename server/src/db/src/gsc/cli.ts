import { loadEnv } from "../env.js";
import { importInspections } from "./importInspections.js";

async function main(): Promise<void> {
  const [, , filePath, userId, domain] = process.argv;
  if (!filePath || !userId || !domain) {
    console.error("Usage: npm run import:gsc-inspections -- <file.json> <userId> <domain>");
    process.exit(1);
  }
  loadEnv();
  const result = await importInspections(filePath, userId, domain);
  console.log(`[gsc-import] ${result.inserted} of ${result.total} inspection rows inserted for ${domain} (${userId})`);
}

main().catch((err) => {
  console.error("[gsc-import] failed:", err);
  process.exit(1);
});
