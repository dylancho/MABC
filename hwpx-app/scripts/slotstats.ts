import { readFileSync } from "node:fs";
import { readContainer } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";
const { result } = dissect(readContainer(new Uint8Array(readFileSync(process.argv[2]))));
const s = result.slots;
const by = (f: (x: (typeof s)[0]) => boolean) => s.filter(f).length;
console.log("전체", s.length);
console.log("  confidence high  ", by((x) => x.confidence === "high"));
console.log("  confidence medium", by((x) => x.confidence === "medium"));
console.log("  confidence low   ", by((x) => x.confidence === "low"));
const labels = new Map<string, number>();
for (const x of s) labels.set(x.label, (labels.get(x.label) ?? 0) + 1);
console.log("서로 다른 라벨", labels.size, "개");
console.log("가장 많이 겹치는 라벨:");
[...labels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  .forEach(([l, n]) => console.log(`   ${n}회  "${l}"`));
console.log("첫 400개가 속한 표:", [...new Set(s.slice(0, 400).map((x) => x.id.split(".")[1]))].join(","));
console.log("전체가 걸친 표:", [...new Set(s.map((x) => x.id.split(".")[1]))].length, "개");
