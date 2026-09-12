/** 원본과 결과를 셀 단위로 비교해 "무엇이 어디에 들어갔는가"만 뽑는다. */
import { readFileSync } from "node:fs";
import { readContainer, sectionNames } from "../src/lib/hwpx/container";
import { parseXml, findAll, findFirst, textOf, children } from "../src/lib/hwpx/xml";

function cells(path: string) {
  const c = readContainer(new Uint8Array(readFileSync(path)));
  const xml = new TextDecoder("utf-8").decode(c.files[sectionNames(c)[0]]);
  const map = new Map<string, string>();
  findAll(parseXml(xml), "hp:tbl").forEach((tbl, ti) => {
    for (const tr of children(tbl, "hp:tr"))
      for (const tc of children(tr, "hp:tc")) {
        const a = findFirst(tc, "hp:cellAddr");
        map.set(`t${ti}.r${a?.attrs.rowAddr}c${a?.attrs.colAddr}`,
          textOf(xml, tc, "hp:tbl").replace(/\s+/g, " ").trim());
      }
  });
  return map;
}
const a = cells(process.argv[2]);
const b = cells(process.argv[3]);
let n = 0;
for (const [k, before] of a) {
  const after = b.get(k) ?? "";
  if (after === before) continue;
  n++;
  console.log(`${k.padEnd(12)} "${before.slice(0, 28)}" → "${after.slice(0, 60)}"`);
}
console.log(`\n바뀐 칸 ${n}개`);
