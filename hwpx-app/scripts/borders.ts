import { readFileSync } from "node:fs";
import { readContainer, sectionNames } from "../src/lib/hwpx/container";
import { parseXml, findAll, findFirst, textOf, children } from "../src/lib/hwpx/xml";

const buf = new Uint8Array(readFileSync(process.argv[2]));
const c = readContainer(buf);
const dec = new TextDecoder("utf-8");
const head = dec.decode(c.files["Contents/header.xml"]);

const top: Record<string, string> = {};
for (const m of head.matchAll(/<hh:borderFill id="(\d+)"[\s\S]*?<\/hh:borderFill>/g)) {
  const t = m[0].match(/<hh:topBorder[^>]*type="(\w+)"/);
  top[m[1]] = t ? t[1] : "?";
}

const xml = dec.decode(c.files[sectionNames(c)[0]]);
const tbl = findAll(parseXml(xml), "hp:tbl")[Number(process.argv[3] ?? 0)];
for (const tr of children(tbl, "hp:tr")) {
  const out: string[] = [];
  for (const tc of children(tr, "hp:tc")) {
    const a = findFirst(tc, "hp:cellAddr");
    const bf = tc.attrs.borderFillIDRef ?? "?";
    const t = textOf(xml, tc, "hp:tbl").replace(/\s+/g, "␣").trim().slice(0, 14);
    out.push(`r${a?.attrs.rowAddr}c${a?.attrs.colAddr} top=${(top[bf] ?? "?").padEnd(5)} "${t}"`);
  }
  console.log(out.join(" | "));
}
