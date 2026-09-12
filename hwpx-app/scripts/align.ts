/** 채워진 칸의 문단 정렬 속성을 원본과 대조한다. 정렬이 바뀌었는지, 원래 무엇이었는지. */
import { readFileSync } from "node:fs";
import { readContainer, sectionNames } from "../src/lib/hwpx/container";
import { parseXml, findAll, findFirst, textOf, children, type XmlNode } from "../src/lib/hwpx/xml";

function load(path: string) {
  const c = readContainer(new Uint8Array(readFileSync(path)));
  const dec = new TextDecoder("utf-8");
  const head = dec.decode(c.files["Contents/header.xml"]);
  const align: Record<string, string> = {};
  for (const m of head.matchAll(/<hh:paraPr id="(\d+)"[\s\S]*?<hh:align horizontal="(\w+)"/g)) align[m[1]] = m[2];
  const xml = dec.decode(c.files[sectionNames(c)[0]]);
  const cells = new Map<string, { text: string; paras: string[]; hasSeg: boolean[]; vert: string }>();
  findAll(parseXml(xml), "hp:tbl").forEach((tbl, ti) => {
    for (const tr of children(tbl, "hp:tr"))
      for (const tc of children(tr, "hp:tc")) {
        const a = findFirst(tc, "hp:cellAddr");
        const sub = findFirst(tc, "hp:subList");
        const paras = sub ? children(sub, "hp:p") : [];
        cells.set(`t${ti}.r${a?.attrs.rowAddr}c${a?.attrs.colAddr}`, {
          text: textOf(xml, tc, "hp:tbl").replace(/\s+/g, " ").trim(),
          paras: paras.map((p: XmlNode) => `${p.attrs.paraPrIDRef}=${align[p.attrs.paraPrIDRef ?? ""] ?? "?"}`),
          hasSeg: paras.map((p: XmlNode) => p.children.some((c) => c.name === "hp:linesegarray")),
          vert: sub?.attrs.vertAlign ?? "?",
        });
      }
  });
  return cells;
}
const A = load(process.argv[2]), B = load(process.argv[3]);
for (const [k, a] of A) {
  const b = B.get(k)!;
  if (a.text === b.text) continue;
  const changed = a.paras.join(",") !== b.paras.join(",");
  console.log(`${k.padEnd(11)} 원본 문단정렬 [${a.paras.join(",")}] → 결과 [${b.paras.join(",")}]${changed ? "  ⚠ 정렬속성 변경" : ""}  lineseg ${a.hasSeg.join("")}→${b.hasSeg.join("")}  "${b.text.slice(0, 30)}"`);
}
