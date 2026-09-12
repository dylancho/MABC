import { readFileSync, writeFileSync } from "node:fs";
import { readContainer } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";
import { fill } from "../src/lib/hwpx/fill";
const buf = new Uint8Array(readFileSync("C:/MABC_본선/D1-test/01-identity.hwpx"));
const { slots } = dissect(readContainer(buf));
const values = {
  "s0.t0.r2c1": "재단법인 미래나눔",        // CENTER
  "s0.t0.r2c7": "2015. 3. 12.",             // CENTER
  "s0.t0.r5c7": "02-2220-1234",             // CENTER
  "s0.t0.r22c2": "목적사업 조항 신설",       // CENTER
  "s0.t1.r1c1": "1,850,000",                // CENTER
  "s0.t0.r8c1.a0": "박서연",                // JUSTIFY (원본)
  "s0.t0.r5c1.a0": "서울 성동구 왕십리로 222", // JUSTIFY (원본)
};
for (const [name, dropLineSegs] of [["A-캐시삭제", true], ["B-캐시유지", false]] as const) {
  const r = fill(buf, slots, { values, dropLineSegs });
  writeFileSync(`C:/Users/dylan/Downloads/정렬확인-${name}.hwpx`, r.file);
  console.log(name, r.report.ok ? "OK" : "FAIL", "lineseg 제거", r.report.lineSegsDropped);
}
