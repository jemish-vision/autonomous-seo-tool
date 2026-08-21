import path from "node:path";
import { backfillJsonGscState } from "./backfill.js";

async function main(): Promise<void> {
  const [, , explicitRoot] = process.argv;
  const gscRoot = explicitRoot ?? path.resolve(import.meta.dirname, "..", "..", "..", "..", "poc", "seo-dashboard", "storage", "gsc");
  const summary = await backfillJsonGscState(gscRoot);
  console.log(
    `[gsc-backfill] users=${summary.users} connections=${summary.connections} properties=${summary.properties} ` +
      `metrics=${summary.metrics} inspectionsWritten=${summary.inspectionsWritten}` +
      (summary.inspectionsSkipped.length ? ` inspectionsSkipped(empty json)=[${summary.inspectionsSkipped.join(", ")}]` : ""),
  );
}

main().catch((err) => {
  console.error("[gsc-backfill] failed:", err);
  process.exit(1);
});
