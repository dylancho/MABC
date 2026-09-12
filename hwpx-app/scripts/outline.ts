import { readFileSync } from "node:fs";
import { readContainer } from "../src/lib/hwpx/container";
import { extractFromHwpx } from "../src/lib/extract";
const t = extractFromHwpx(new Uint8Array(readFileSync(process.argv[2])));
void readContainer;
const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
console.log("총", lines.length, "줄");
for (const l of lines.slice(Number(process.argv[3] ?? 0), Number(process.argv[4] ?? 60))) {
  console.log("  " + l.slice(0, 110));
}
