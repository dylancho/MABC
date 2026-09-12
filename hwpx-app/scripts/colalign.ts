import { readFileSync } from "node:fs";
import { readContainer, sectionNames } from "../src/lib/hwpx/container";
import { parseXml, findAll, findFirst, children, type XmlNode } from "../src/lib/hwpx/xml";
const c = readContainer(new Uint8Array(readFileSync(process.argv[2])));
const dec = new TextDecoder("utf-8");
const head = dec.decode(c.files["Contents/header.xml"]);
const align: Record<string, string> = {};
for (const m of head.matchAll(/<hh:paraPr id="(\d+)"[\s\S]*?<hh:align horizontal="(\w+)"/g)) align[m[1]] = m[2];
const xml = dec.decode(c.files[sectionNames(c)[0]]);
const tbls = findAll(parseXml(xml), "hp:tbl");
for (const spec of process.argv.slice(3)) {
  const [t, col] = spec.split(":").map(Number);
  const dist = new Map<string, number>();
  for (const tr of children(tbls[t], "hp:tr"))
    for (const tc of children(tr, "hp:tc")) {
      const a = findFirst(tc, "hp:cellAddr");
      if (Number(a?.attrs.colAddr) !== col) continue;
      const p = children(findFirst(tc, "hp:subList")!, "hp:p")[0] as XmlNode | undefined;
      const k = `${p?.attrs.paraPrIDRef}=${align[p?.attrs.paraPrIDRef ?? ""] ?? "?"}`;
      dist.set(k, (dist.get(k) ?? 0) + 1);
    }
  console.log(`t${t} c${col}: ` + [...dist.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join("  "));
}
