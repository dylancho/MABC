import { readFileSync } from "node:fs";
import { readContainer } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";
const r = dissect(readContainer(new Uint8Array(readFileSync(process.argv[2])))).result;
const t = r.slots.filter((s) => s.kind !== "readonly_note" && (s.kind !== "text" || s.confidence === "high"));
console.log(`전체 ${r.slots.length} → 매핑 대상 ${t.length}  (빈칸/high ${t.filter((s) => s.kind === "text").length} + 표식형 ${t.filter((s) => s.kind !== "text").length})`);
console.log("대상이 걸친 표:", [...new Set(t.map((s) => s.id.split(".")[1]))].join(" "));
