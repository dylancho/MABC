import { readFileSync } from "node:fs";
import { readContainer, sectionNames } from "../src/lib/hwpx/container";
import { parseXml, findAll, findFirst, textOf, children } from "../src/lib/hwpx/xml";
const c = readContainer(new Uint8Array(readFileSync(process.argv[2])));
const dec = new TextDecoder("utf-8");
const head = dec.decode(c.files["Contents/header.xml"]);
const h: Record<string, number> = {};
for (const m of head.matchAll(/<hh:charPr\b[^>]*\bid="(\d+)"[^>]*\bheight="(\d+)"/g)) h[m[1]] = +m[2];
const xml = dec.decode(c.files[sectionNames(c)[0]]);
const tbl = findAll(parseXml(xml), "hp:tbl")[+process.argv[3]];
for (const tr of children(tbl, "hp:tr")) {
  const out: string[] = [];
  for (const tc of children(tr, "hp:tc")) {
    const a = findFirst(tc, "hp:cellAddr"), sz = findFirst(tc, "hp:cellSz"),
          mg = findFirst(tc, "hp:cellMargin"), sp = findFirst(tc, "hp:cellSpan");
    const run = findAll(tc, "hp:run")[0];
    const size = h[run?.attrs.charPrIDRef ?? "0"] ?? 1000;
    const w = +(sz?.attrs.width ?? 0), mx = +(mg?.attrs.left ?? 0) + +(mg?.attrs.right ?? 0);
    out.push(`r${a?.attrs.rowAddr}c${a?.attrs.colAddr}[span${sp?.attrs.colSpan}] w=${w} m=${mx} font=${size} → ${Math.max(1, Math.floor((w - mx) / size))}자 "${textOf(xml, tc, "hp:tbl").replace(/\s+/g, " ").trim().slice(0, 10)}"`);
  }
  console.log(out.join("\n"));
}
