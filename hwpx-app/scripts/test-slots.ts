/**
 * 괄호 안내문 칸(`(이름)`, `(직급)`, `(우      )`)이 입력칸으로 잡히는지 검사한다.
 * D1 실측에서 이름·주소가 라벨 칸 아래의 "(라벨 미상)" 빈칸으로 새어 나갔다.
 */
import { readFileSync } from "node:fs";
import { readContainer } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";

const FORM = "C:/MABC_본선/D1-test/01-identity.hwpx";
const { result } = dissect(readContainer(new Uint8Array(readFileSync(FORM))));
const ids = new Set(result.slots.map((s) => s.id));
const by = (p: string) => result.slots.filter((s) => s.id.startsWith(p));

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

// 있어야 하는 것: 괄호 안내문 뒤에 값을 넣을 자리
check("r4c1 (이름)/(전화번호) 대표자 칸에 슬롯 2개", by("s0.t0.r4c1").length === 2,
  by("s0.t0.r4c1").map((s) => s.label).join(" / ") || "없음");
check("r5c1 (우 ) 칸에 우편번호+주소 슬롯 2개", by("s0.t0.r5c1").length === 2,
  by("s0.t0.r5c1").map((s) => `${s.label}[${s.capacity.chars}자]`).join(" / ") || "없음");
check("r8c1 (이름) 담당자 이름 슬롯", by("s0.t0.r8c1").length === 1,
  by("s0.t0.r8c1").map((s) => s.label).join(" / ") || "없음");
check("r9c1 (직급) 담당자 직급 슬롯", by("s0.t0.r9c1").length === 1,
  by("s0.t0.r9c1").map((s) => s.label).join(" / ") || "없음");
check("r15c1 (가입 명) 4대보험 슬롯", by("s0.t0.r15c1").length === 1,
  by("s0.t0.r15c1").map((s) => s.label).join(" / ") || "없음");

// 없어야 하는 것: 라벨 칸의 세로 연속 영역
check("r9c0 유령 슬롯 없음 (주 업무 담당자 라벨 아래)", !ids.has("s0.t0.r9c0"));
check("r10c0 유령 슬롯 없음", !ids.has("s0.t0.r10c0"));

// 투명 테두리로 위 칸과 붙어 있는 여백 칸 — 슬롯이 있으면 안 된다
for (const id of ["s0.t0.r6c0", "s0.t0.r6c1", "s0.t0.r7c0", "s0.t0.r7c1", "s0.t0.r9c0", "s0.t0.r10c0"]) {
  check(`${id} 여백 칸에 슬롯 없음 (윗 테두리 NONE)`, !ids.has(id));
}
// 윗 테두리가 있는 별개 행 — 슬롯이 살아 있어야 한다
for (const id of ["s0.t0.r22c1", "s0.t0.r23c1", "s0.t0.r24c1", "s0.t0.r27c1", "s0.t0.r10c1"]) {
  check(`${id} 별개 입력행 슬롯 유지 (윗 테두리 SOLID)`, ids.has(id));
}

// 서식2 — 자간 벌리기 머리글과 제목의 (예시)는 슬롯이 아니다
{
  const F2 = "C:/Users/dylan/Downloads/(서식2) 사업실적 및 사업계획 제출 양식 (1).hwpx";
  const r2 = dissect(readContainer(new Uint8Array(readFileSync(F2)))).result;
  const ids2 = new Set(r2.slots.map((s) => s.id));
  check("서식2 t3.r4c0 「세    입」 머리글에 inline 슬롯 없음", !ids2.has("s0.t3.r4c0.i0"));
  check("서식2 t1.r34c0 「합    계」 머리글에 inline 슬롯 없음", !ids2.has("s0.t1.r34c0.i0"));
  check("서식2 t0.r0c2 「…총괄표(예시)」 제목에 example_row 없음", !ids2.has("s0.t0.r0c2.ex"));
  check("서식2 t1.r7c12 「임 원 |    명」 숫자 자리는 유지", ids2.has("s0.t1.r7c12.i0"));
  // 라벨 조각이 한 글자인 inline 중 단위(명·원…)가 아닌 것 = 자간 벌리기 오인
  const spacing = r2.slots.filter((s) => s.kind === "inline" && /· [^명원회개건%]$/.test(s.label));
  check(`서식2 자간 오인 inline 슬롯 0개 (지금 ${spacing.length})`, spacing.length === 0,
    spacing.slice(0, 5).map((s) => s.label).join(" / "));
}
check("서식1 r11c1 「총    명」 사원수 자리는 유지", ids.has("s0.t0.r11c1.i0"));
check("서식1 r26c6 「(예) …」 예시 칸은 슬롯 아님", !ids.has("s0.t0.r26c6.ex") && !ids.has("s0.t0.r26c6"));
{
  const g = (id: string) => result.slots.find((s) => s.id === id);
  check("서식1 r27c6 (2023년도 입력행)에 예시 힌트", /노인일자리사업/.test(g("s0.t0.r27c6")?.hint ?? ""), (g("s0.t0.r27c6")?.hint ?? "").slice(0, 60));
  check("서식1 r27c2 (2022년도 입력행)에 예시 힌트", /청년취업아카데미/.test(g("s0.t0.r27c2")?.hint ?? ""));
  check("서식1 r27c9 (2024년도)는 예시 없는 열 — 힌트 없음", !g("s0.t0.r27c9")?.hint);
  check("서식1 r26c9 (예시 행의 빈 칸)은 슬롯 아님", !ids.has("s0.t0.r26c9"));
  check("서식1 r26c0 (예시 행 왼쪽 빈 칸)도 슬롯 아님", !ids.has("s0.t0.r26c0"));
  check("서식1 r27c9 라벨 경로에 2024년도", (g("s0.t0.r27c9")?.labelPath ?? []).includes("2024년도"));
}

{
  const F2 = "C:/Users/dylan/Downloads/(서식2) 사업실적 및 사업계획 제출 양식 (1).hwpx";
  const r2 = dissect(readContainer(new Uint8Array(readFileSync(F2)))).result;
  const ids2 = new Set(r2.slots.map((s) => s.id));
  for (const t of [0, 2, 4, 17]) check(`서식2 「붙임」 띠 가운데 칸(t${t}.r0c1)에 슬롯 없음`, !ids2.has(`s0.t${t}.r0c1`));
  const g = (id: string) => r2.slots.find((s) => s.id === id);
  check("서식2 재산현황 건물 소재지 라벨 = 「건 물」(단위 ㎡ 아님)", g("s0.t26.r9c3")?.label === "건 물", g("s0.t26.r9c3")?.label);
  check("서식2 재산현황 경로에 「기본재산」 포함", (g("s0.t26.r9c3")?.labelPath ?? []).includes("기본재산"), (g("s0.t26.r9c3")?.labelPath ?? []).join(" › "));
  check("서식2 보통재산 현금 경로에 「보통재산」 포함", (g("s0.t26.r18c3")?.labelPath ?? []).includes("보통재산"), (g("s0.t26.r18c3")?.labelPath ?? []).join(" › "));
}

check("서식1 r13c1 「(상근   명)」 3칸 공백도 슬롯", ids.has("s0.t0.r13c1.i1"));
{
  const g = (id: string) => result.slots.find((s) => s.id === id);
  check("서식1 r27c1 정부지원금 경로에 「2021년도」", (g("s0.t0.r27c1")?.labelPath ?? []).includes("2021년도"), (g("s0.t0.r27c1")?.labelPath ?? []).join(" › "));
  check("서식1 r27c9 정부지원금 경로에 「2024년도」", (g("s0.t0.r27c9")?.labelPath ?? []).includes("2024년도"), (g("s0.t0.r27c9")?.labelPath ?? []).join(" › "));
}

{
  const g = (id: string) => result.slots.find((s) => s.id === id);
  check("서식1 r27c1 경로가 위 섹션까지 안 올라감", (g("s0.t0.r27c1")?.labelPath ?? []).join(" › ") === "정부지원금 수령 내역 › 2021년도 › 사업명지원금액중앙부처명", (g("s0.t0.r27c1")?.labelPath ?? []).join(" › "));
  const F2 = "C:/Users/dylan/Downloads/(서식2) 사업실적 및 사업계획 제출 양식 (1).hwpx";
  const r2 = dissect(readContainer(new Uint8Array(readFileSync(F2)))).result;
  const bad = r2.slots.filter((s) => s.kind === "inline" && /자 산 ·|부 채/.test(s.label));
  check(`서식2 「부 채 및 자 본」 3칸 자간에 inline 없음 (지금 ${bad.length})`, bad.length === 0);
  check("서식2 설립일 「(   .   .   )」 자리는 유지", r2.slots.some((s) => s.kind === "inline" && /설립일/.test(s.label)));
}

const unknown = result.slots.filter((s) => s.label === "(라벨 미상)");
console.log(`\n(라벨 미상) 슬롯 ${unknown.length}개: ${unknown.map((s) => s.id).join(", ")}`);
console.log(`전체 슬롯 ${result.slots.length}개`);
console.log(failed ? `\n${failed}건 실패` : "\n전부 통과");
process.exit(failed ? 1 : 0);
