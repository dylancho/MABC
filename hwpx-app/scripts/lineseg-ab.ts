/**
 * linesegarray A/B 비교.
 *
 * 같은 값을 같은 칸에 넣되, 줄 렌더링 캐시를 남긴 것과 지운 것 두 개를 만든다.
 * LLM을 안 쓰므로 두 파일의 차이는 오직 캐시 처리뿐이다.
 *
 * 한글로 둘 다 열어서 글자 겹침이 사라지는지 확인한다.
 *
 * 실행: npx tsx scripts/lineseg-ab.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readContainer } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";
import { fill } from "../src/lib/hwpx/fill";

const FORM = "C:\\Users\\dylan\\Downloads\\(서식1) 비영리법인 현황 제출 양식.hwpx";
const OUT = "C:\\MABC_본선\\D1-test";

// 겹침이 잘 드러나도록 칸을 꽉 채우는 값을 쓴다
const WANT: Record<string, string> = {
  법인명: "재단법인 미래나눔",
  설립허가일: "2015. 3. 12.",
  허가번호: "제2015-041호",
  "고유번호 또는 사업자번호": "214-82-09915",
  "주사무소 소재지": "서울특별시 성동구 왕십리로 222, 3층",
  전화번호: "02-2220-1234",
  팩스번호: "02-2220-1235",
  홈페이지: "https://mirae-nanum.or.kr",
  전자우편: "office@mirae-nanum.or.kr",
  "주 업무 담당자": "박서연",
};

mkdirSync(OUT, { recursive: true });

const buf = new Uint8Array(readFileSync(FORM));
const { slots } = dissect(readContainer(buf));

const values: Record<string, string> = {};
const used = new Set<string>();
for (const s of slots) {
  if (s.kind !== "text") continue;
  const want = WANT[s.label];
  if (want && !used.has(s.label)) {
    values[s.id] = want;
    used.add(s.label);
  }
}

console.log(`채울 칸 ${Object.keys(values).length}개: ${[...used].join(", ")}\n`);

for (const [name, drop] of [
  ["05-linesegs-KEPT", false],
  ["06-linesegs-DROPPED", true],
] as const) {
  const res = fill(buf, slots, { values, dropLineSegs: drop });
  const r = res.report;
  const path = `${OUT}\\${name}.hwpx`;
  writeFileSync(path, res.file);

  console.log(`${name}`);
  console.log(`  캐시 처리      ${drop ? "제거함 (한글이 재계산)" : "그대로 둠 (옛 줄 폭 유지)"}`);
  console.log(`  값 주입        ${r.filledSlots}칸 · 캐시 제거 ${r.lineSegsDropped}개`);
  for (const s of r.sections) {
    console.log(`  ${s.file.replace("Contents/", "")}  ${s.beforeBytes.toLocaleString()} → ${s.afterBytes.toLocaleString()} B`);
  }
  console.log(`  무손상         ${r.ok ? "통과" : "실패"} · 범위이탈 ${r.inBounds ? "0건" : "있음"} · header ${r.headerUntouched ? "동일" : "★변경"}`);
  console.log(`  → ${path}\n`);
}

console.log("한글로 두 파일을 열어 비교하세요.");
console.log("  05 (KEPT)    글자가 겹쳐 보이면 → 캐시가 원인이 맞음");
console.log("  06 (DROPPED) 정상으로 보이면   → 이 방식으로 확정");
