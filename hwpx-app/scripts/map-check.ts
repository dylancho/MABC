/**
 * Solar 매핑 품질 확인.
 *
 * 실제 양식(A) + 실제 자료(B)로 전 경로를 돌린다.
 * 특히 보는 것:
 *   - 근거(evidence)를 대는가, 아니면 지어내는가
 *   - 자료에 없는 항목을 비워두는가
 *   - 후보가 둘일 때 고르지 않고 되묻는가
 *
 * 실행: npx tsx scripts/map-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" }); // Next는 .env.local을 읽지만 dotenv 기본값은 .env 다
import { readFileSync, writeFileSync } from "node:fs";
import { readContainer } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";
import { fill } from "../src/lib/hwpx/fill";
import { mapContentToSlots } from "../src/lib/ai/map";
import { solarModelName } from "../src/lib/ai/solar";

const FORM = "C:\\Users\\dylan\\Downloads\\(서식1) 비영리법인 현황 제출 양식.hwpx";
const SOURCE = "C:\\MABC_본선\\hwpx-app\\scripts\\fixtures\\법인자료.txt";
const OUT = "C:\\MABC_본선\\D1-test\\04-solar.hwpx";

const bar = (s: string) => console.log(`\n${"=".repeat(74)}\n${s}\n${"=".repeat(74)}`);

async function main() {
  const buf = new Uint8Array(readFileSync(FORM));
  const source = readFileSync(SOURCE, "utf-8");

  const c = readContainer(buf);
  const { result, slots } = dissect(c);
  console.log(`모델: ${solarModelName()}`);
  console.log(`양식 슬롯 ${result.slots.length}개 · 자료 ${source.length}자`);

  const t0 = Date.now();
  const mapped = await mapContentToSlots(result.slots, source);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const labelOf = new Map(result.slots.map((s) => [s.id, s]));
  const filled = mapped.fills.filter((f) => f.value);
  const blank = mapped.fills.filter((f) => !f.value);

  bar(`매핑 결과 — ${secs}s`);
  console.log(`채움 ${filled.length} · 비움 ${blank.length} · 질문 ${mapped.questions.length}`);
  if (mapped.errors.length) {
    console.log(`
★ 실패한 요청 ${mapped.errors.length}건:`);
    for (const e of [...new Set(mapped.errors)].slice(0, 3)) console.log(`   ${e.slice(0, 300)}`);
  }

  bar("채운 칸 (값 ← 근거)");
  for (const f of filled) {
    const s = labelOf.get(f.id);
    console.log(`  ${(s?.label ?? f.id).slice(0, 20).padEnd(22)} ${f.value.slice(0, 28).padEnd(30)}`);
    console.log(`     ← "${f.evidence.slice(0, 70)}"`);
  }

  bar("되묻는 것 — 자료에 후보가 둘 이상");
  if (!mapped.questions.length) console.log("  (없음)");
  for (const q of mapped.questions) {
    const s = labelOf.get(q.id);
    console.log(`  [${s?.label ?? q.id}] ${q.question}`);
    console.log(`     후보: ${q.candidates.join(" | ")}`);
  }

  bar("비워둔 칸 표본 — 근거가 없어 채우지 않음");
  for (const f of blank.slice(0, 12)) {
    const s = labelOf.get(f.id);
    console.log(`  ${(s?.label ?? f.id).slice(0, 24).padEnd(26)} ${f.note.slice(0, 44)}`);
  }
  console.log(`  … 총 ${blank.length}개`);

  // 실제 hwpx 생성
  const values: Record<string, string> = {};
  for (const f of filled) values[f.id] = f.value;
  const res = fill(buf, slots, { values });
  const r = res.report;

  bar("무손상 검증");
  console.log(`  ${r.ok ? "통과" : "실패"} · 채운 칸 ${r.filledSlots} · 교체 ${(r.changedRatio * 100).toFixed(3)}%`);
  for (const s of r.sections) {
    console.log(`  ${s.file}: ${s.beforeBytes.toLocaleString()} → ${s.afterBytes.toLocaleString()} B (교체 ${s.replacedFrom} → ${s.replacedTo} B)`);
  }
  console.log(`  범위이탈 ${r.inBounds ? "0건" : "있음"} · header.xml ${r.headerUntouched ? "완전 동일" : "★변경"} · 기타 ${r.otherChanged.length ? r.otherChanged.join(",") : "무변경"}`);
  console.log(`  비워둠 ${res.unfilled.length} · 넘침 ${res.overflow.length}`);
  for (const o of res.overflow) console.log(`    넘침: ${o.label} ${o.chars}자 > ${o.capacity}자`);

  if (r.ok) {
    // 한글로 열어둔 파일은 잠겨 있어(EBUSY) 덮어쓸 수 없다. 그럴 땐 옆 이름으로 떨군다.
    let path = OUT;
    try {
      writeFileSync(path, res.file);
    } catch {
      path = OUT.replace(/\.hwpx$/, `-${Date.now().toString().slice(-6)}.hwpx`);
      writeFileSync(path, res.file);
      console.log("\n(기존 파일이 한글에서 열려 있어 새 이름으로 저장했습니다)");
    }
    console.log(`\n→ ${path}`);
  }
}

main().catch((e) => {
  console.error("\n실패:", e.message);
  process.exit(1);
});
