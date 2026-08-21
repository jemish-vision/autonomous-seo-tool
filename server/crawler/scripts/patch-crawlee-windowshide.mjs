// Crawlee's systemInfoV2 ps-tree spawns `powershell` every snapshot tick (1s) WITHOUT
// windowsHide, opening a visible console window per poll on Windows. Idempotent postinstall
// patch until fixed upstream (https://github.com/apify/crawlee — spawn in ps-tree.js).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const target = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../node_modules/@crawlee/utils/internals/systemInfoV2/ps-tree.js",
);

let src;
try {
  src = readFileSync(target, "utf8");
} catch {
  console.log("[patch-crawlee] ps-tree.js not found — skipping");
  process.exit(0);
}

if (src.includes("windowsHide")) {
  console.log("[patch-crawlee] already patched");
  process.exit(0);
}

const needle = "'Get-CimInstance Win32_Process | Format-Table ProcessId,ParentProcessId,WorkingSetSize,Name',\n            ]);";
const replacement = "'Get-CimInstance Win32_Process | Format-Table ProcessId,ParentProcessId,WorkingSetSize,Name',\n            ], { windowsHide: true });";

if (!src.includes(needle)) {
  console.error("[patch-crawlee] spawn block not found — crawlee version changed, re-check the patch");
  process.exit(1);
}

writeFileSync(target, src.replace(needle, replacement), "utf8");
console.log("[patch-crawlee] windowsHide applied to powershell spawn");
