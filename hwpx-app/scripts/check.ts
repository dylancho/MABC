/**
 * hwpx-core 검증 하네스.
 *
 * 실제 공문서 양식으로 다음을 확인한다.
 *   ① 항등      — 값 없이 왕복하면 모든 엔트리가 바이트 단위로 동일한가
 *   ② 해부      — 슬롯을 몇 개 어떤 유형으로 찾는가, 라벨 귀속은 되는가
 *   ③ 주입/검증 — 값을 넣고 무손상 리포트가 통과하는가
 *
 * 실행: npx tsx scripts/check.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { readContainer } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";
import { fill, identityCheck } from "../src/lib/hwpx/fill";

const DOWNLOADS = "C:\\Users\\dylan\\Downloads";
const FIXTURES = [
  `${DOWNLOADS}\\(서식1) 비영리법인 현황 제출 양식.hwpx`,
  `${DOWNLOADS}\\(서식2) 사업실적 및 사업계획 제출 양식.hwpx`,
  `${DOWNLOADS}\\(첨부1) 2026 금융 AI Challenge 공모전 기획서.hwpx`,
  `${DOWNLOADS}\\(첨부2) 2026 금융 AI Challenge 기능명세서.hwpx`,
];
const OUT = "C:\\MABC_본선\\D1-test";

const bar = (s: string) => `\n${"=".repeat(72)}\n${s}\n${"=".repeat(72)}`;

mkdirSync(OUT, { recursive: true });

for (const path of FIXTURES) {
  if (!existsSync(path)) {
    console.log(`\n[건너뜀] 파일 없음: ${basename(path)}`);
    continue;
  }
  const name = basename(path);
  console.log(bar(name));

  const buf = new Uint8Array(readFileSync(path));

  // ① 항등
  const id = identityCheck(buf);
  console.log(
    `① 항등   ${id.ok ? "통과" : "실패"}  ` +
      `(내용동일=${id.sameContent} 순서동일=${id.sameOrder} mimetype=${id.mimetypeOk})`,
  );

  // ② 해부
  const c = readContainer(buf);
  const t0 = Date.now();
  const { result, slots } = dissect(c);
  const ms = Date.now() - t0;

  const byKind: Record<string, number> = {};
  const byConf: Record<string, number> = {};
  for (const s of result.slots) {
    byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
    byConf[s.confidence] = (byConf[s.confidence] ?? 0) + 1;
  }
  console.log(
    `② 해부   슬롯 ${result.slots.length}개  ${ms}ms  ` +
      `(section ${result.stats.sections} / 표 ${result.stats.tables} / ` +
      `셀 ${result.stats.cells} / 병합 ${result.stats.mergedCells})`,
  );
  console.log(`         유형: ${JSON.stringify(byKind)}`);
  console.log(`         확신: ${JSON.stringify(byConf)}`);
  console.log(`         작성요령 블록: ${result.formNotes.length}줄`);
  if (result.unsupported.length) {
    console.log(`         미지원: ${result.unsupported.length}건`);
  }

  const hinted = result.slots.filter((s) => s.hint);
  if (hinted.length) {
    console.log(`         힌트 붙은 슬롯: ${hinted.length}개`);
    for (const h of hinted.slice(0, 3)) {
      console.log(`           · ${h.label} → "${h.hint?.slice(0, 50)}"`);
    }
  }

  console.log("\n         [슬롯 표본]");
  for (const s of result.slots.slice(0, 10)) {
    const extra =
      s.kind === "choice" ? ` choices=[${s.choices?.join("/")}]` : ` cap=${s.capacity.chars}자`;
    console.log(
      `           ${s.confidence.padEnd(6)} ${s.kind.padEnd(12)} ${s.label.slice(0, 24).padEnd(26)}${extra}`,
    );
  }

  // ③ 주입 — 값이 있는 슬롯만 골라 실제로 채워본다
  const values: Record<string, string> = {};
  let n = 0;
  for (const s of slots) {
    if (n >= 8) break;
    if (s.kind === "text" && s.confidence !== "low") {
      values[s.id] = `[${s.label.slice(0, 10)}]`;
      n++;
    } else if (s.kind === "choice" && s.choices?.length) {
      values[s.id] = s.choices[0];
      n++;
    }
  }

  const res = fill(buf, slots, { values });
  const r = res.report;
  console.log(
    `\n③ 주입   ${r.ok ? "통과" : "실패"}  ` +
      `슬롯 ${r.filledSlots}개 · 교체 ${r.changedRatio ? (r.changedRatio * 100).toFixed(3) : "0"}% · ` +
      `범위이탈 ${r.inBounds ? "0건" : "있음"} · header ${r.headerUntouched ? "무변경" : "★변경"} · ` +
      `기타엔트리 ${r.otherChanged.length === 0 ? "무변경" : r.otherChanged.join(",")}`,
  );
  for (const s of r.sections) {
    console.log(
      `         ${s.file}: ${s.beforeBytes.toLocaleString()} → ${s.afterBytes.toLocaleString()} B ` +
        `(교체 ${s.replacedFrom} → ${s.replacedTo} B)`,
    );
  }
  if (r.problems.length) console.log(`         문제: ${r.problems.join(" / ")}`);
  console.log(`         비워둠 ${res.unfilled.length}개 · 넘침 ${res.overflow.length}개`);

  if (r.ok && r.filledSlots > 0) {
    const outPath = `${OUT}\\core-${name}`;
    writeFileSync(outPath, res.file);
    console.log(`         → ${outPath}`);
  }
}

console.log("");
