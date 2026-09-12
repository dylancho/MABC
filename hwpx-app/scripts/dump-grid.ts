import { readFileSync } from "node:fs";
import { readContainer, sectionNames } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";
import { parseXml, findAll, findFirst, textOf, children } from "../src/lib/hwpx/xml";

const path = process.argv[2];
const onlyTable = process.argv[3] ? Number(process.argv[3]) : null;
const buf = new Uint8Array(readFileSync(path));
const c = readContainer(buf);
const dec = new TextDecoder("utf-8");

for (const file of sectionNames(c)) {
  const xml = dec.decode(c.files[file]);
  const roots = parseXml(xml);
  findAll(roots, "hp:tbl").forEach((tbl, ti) => {
    if (onlyTable !== null && ti !== onlyTable) return;
    console.log(`\n===== table ${ti} (${file}) =====`);
    for (const tr of children(tbl, "hp:tr")) {
      const line: string[] = [];
      for (const tc of children(tr, "hp:tc")) {
        const a = findFirst(tc, "hp:cellAddr");
        const s = findFirst(tc, "hp:cellSpan");
        const t = textOf(xml, tc, "hp:tbl").replace(/\s+/g, "␣").trim();
        line.push(`r${a?.attrs.rowAddr}c${a?.attrs.colAddr}[${s?.attrs.rowSpan}x${s?.attrs.colSpan}]"${t}"`);
      }
      console.log("  " + line.join("  "));
    }
  });
}

const { result } = dissect(c);
console.log(`\n===== slots (${result.slots.length}) =====`);
for (const s of result.slots) {
  console.log(`${s.id.padEnd(18)} ${s.kind.padEnd(12)} conf=${s.confidence.padEnd(6)} label="${s.label}"`);
}
