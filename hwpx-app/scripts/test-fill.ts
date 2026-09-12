/** append 앵커까지 넣고 무손상 검증을 통과하는지, 결과 표가 제대로 읽히는지 본다. */
import { readFileSync, writeFileSync } from "node:fs";
import { readContainer, sectionNames } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";
import { fill } from "../src/lib/hwpx/fill";
import { parseXml, findAll, findFirst, textOf, children } from "../src/lib/hwpx/xml";

const FORM = "C:/MABC_본선/D1-test/01-identity.hwpx";
const buf = new Uint8Array(readFileSync(FORM));
const { slots } = dissect(readContainer(buf));

const values: Record<string, string> = {
  "s0.t0.r2c1": "재단법인 미래나눔",
  "s0.t0.r4c1.a0": "김민수",
  "s0.t0.r4c1.a1": "02-2220-1200",
  "s0.t0.r5c1.i0": "04769",
  "s0.t0.r5c1.a0": "서울 성동구 왕십리로 222",
  "s0.t0.r8c1.a0": "박서연",
  "s0.t0.r9c1.a0": "사무국장",
  "s0.t0.r3c1.ch": "재단",
};

const res = fill(buf, slots, { values });
console.log("무손상 검증:", res.report.ok ? "통과" : "실패", res.report.problems);
console.log("범위 이탈 없음:", res.report.inBounds, "| header 무변경:", res.report.headerUntouched);
console.log("변경 비율:", (res.report.changedRatio * 100).toFixed(3) + "%");

const out = "C:/Users/dylan/AppData/Local/Temp/claude/C--MABC---/e4bc4c4d-994b-49fc-8575-cf59ab1f726c/scratchpad/07-append.hwpx";
writeFileSync(out, res.file);

const c2 = readContainer(res.file);
const xml = new TextDecoder("utf-8").decode(c2.files[sectionNames(c2)[0]]);
const tbl = findAll(parseXml(xml), "hp:tbl")[0];
console.log("\n--- 채운 뒤 기본 사항 표 (r2~r10)");
for (const tr of children(tbl, "hp:tr")) {
  const cells = children(tr, "hp:tc");
  const r = Number(findFirst(cells[0], "hp:cellAddr")?.attrs.rowAddr ?? -1);
  if (r < 2 || r > 10) continue;
  console.log(
    "  " + cells.map((tc) => `"${textOf(xml, tc, "hp:tbl").replace(/\s+/g, " ").trim()}"`).join("  "),
  );
}
console.log("\n출력:", out);
