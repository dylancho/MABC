/**
 * 근거 검증 가드의 결정론적 테스트.
 *
 * 이 가드가 제품의 핵심 약속("지어내지 않는다")을 지탱한다.
 * LLM 실행은 확률적이라 "이번엔 안 지어냈다"가 "막았다"의 증거가 못 된다.
 * 그래서 가드 자체를 고정 입력으로 검사한다.
 *
 * 아래 차단 케이스는 전부 solar-pro2가 실제로 만들어낸 출력이다.
 *
 * 실행: npx tsx scripts/guard-test.ts
 */
import { quotesSource, refineQuestions } from "../src/lib/ai/map";
import type { MappedFill, MappedQuestion } from "../src/lib/ai/map";

const SOURCE = `우리 재단 정식 명칭은 '재단법인 미래나눔'입니다.
2015년 3월 12일에 설립허가를 받았고 허가번호는 제2015-041호입니다.
주 업무 담당자는 사무국 박서연 과장이고 직급은 과장, 전화 02-2220-1240
직원은 일반직 6명, 기간제 2명, 단시간 1명입니다.
주요사업은 1) 청소년 장학지원사업 2) 저소득층 의료비 지원 3) 지역아동센터 후원 입니다.
수익사업은 하지 않습니다.
※ 사원수는 저희가 재단법인이라 해당사항 없습니다.`;

interface Case {
  desc: string;
  evidence: string;
  value: string;
  expect: boolean;
}

const CASES: Case[] = [
  // ── 통과해야 하는 것: 자료에 실제로 있는 근거
  { desc: "원문 그대로 인용", evidence: "허가번호는 제2015-041호입니다.", value: "제2015-041호", expect: true },
  { desc: "구두점만 다른 인용", evidence: "2015년 3월 12일에 설립허가를 받았고", value: "2015.03.12", expect: true },
  { desc: "짧지만 실재하는 인용", evidence: "직급은 과장", value: "과장", expect: true },
  { desc: "짧은 인용 + 숫자값", evidence: "기간제 2명", value: "2", expect: true },
  // 값이 짧으면(4자 미만) 우연 일치 위험이 커서 값 대조를 인정하지 않는다.
  // 이런 칸은 모델이 제대로 된 인용을 대야 채워진다.
  { desc: "인용이 자료에 없고 값도 짧으면 차단", evidence: "법인 명칭 관련 기술", value: "재단", expect: false },

  // ── 차단해야 하는 것: solar-pro2가 실제로 낸 환각
  {
    desc: "근거란에 '자료 없음'이라 쓰고 값은 채움 ①",
    evidence: "공익법인 여부와 직접적으로 명시된 자료는 없으나 '사단법인이 아님'이 근거",
    value: "비해당",
    expect: false,
  },
  {
    desc: "근거란에 '자료 없음'이라 쓰고 값은 채움 ②",
    evidence: "비영리민간단체 여부와 관련된 자료가 없음",
    value: "비해당",
    expect: false,
  },
  {
    desc: "근거란에 '자료 없음'이라 쓰고 값은 채움 ③",
    evidence: "지정기부금 단체 여부와 관련된 자료가 없음",
    value: "당",
    expect: false,
  },
  {
    desc: "원문을 재구성한 가짜 인용",
    evidence: "주요사업은 2) 저소득층 의료비 지원",
    value: "저소득층 의료비 지원",
    // 값 자체는 자료에 그대로 있으므로 통과가 맞다 (인용만 다듬어진 경우)
    expect: true,
  },
  { desc: "인용도 값도 자료에 없음", evidence: "일반적으로 그렇습니다", value: "해당", expect: false },
  { desc: "인용 없음", evidence: "", value: "임의값", expect: false },
  { desc: "빈 인용 + 자료에 없는 값", evidence: "", value: "2026년", expect: false },
];

let pass = 0;
let fail = 0;

console.log("근거 검증 가드 테스트\n" + "=".repeat(70));
for (const c of CASES) {
  const got = quotesSource(c.evidence, SOURCE, c.value);
  const ok = got === c.expect;
  ok ? pass++ : fail++;
  const mark = ok ? "  통과" : "★ 실패";
  const verdict = got ? "허용" : "차단";
  console.log(`${mark}  [${verdict}] ${c.desc}`);
  if (!ok) {
    console.log(`         기대=${c.expect ? "허용" : "차단"} 실제=${verdict}`);
    console.log(`         근거="${c.evidence}" 값="${c.value}"`);
  }
}

console.log("=".repeat(70));
console.log(`${pass}/${CASES.length} 통과${fail ? ` · ${fail}건 실패` : ""}`);

// ────────────────────────────────────────────────────────────────────
// 되묻기 정리 테스트
//
// 모델이 "확인차" 질문을 남발하는 문제(실측 27건)를 후보 개수로 거른다.
// ────────────────────────────────────────────────────────────────────

let pass2 = 0;
let fail2 = 0;

function check(desc: string, cond: boolean, detail = "") {
  cond ? pass2++ : fail2++;
  console.log(`${cond ? "  통과" : "★ 실패"}  ${desc}`);
  if (!cond && detail) console.log(`         ${detail}`);
}

const F = (id: string, value: string): MappedFill => ({ id, value, evidence: value, note: "" });
const Q = (id: string, candidates: string[]): MappedQuestion => ({
  id,
  question: `${id} 확인`,
  candidates,
});

console.log("\n되묻기 정리 테스트\n" + "=".repeat(70));

{
  // 후보 2개 — 진짜 모호함. 질문으로 남기고 칸은 비운다.
  const r = refineQuestions([F("a", "02-2220-1230")], [Q("a", ["02-2220-1230", "010-4412-7788"])], SOURCE);
  check("후보 2개 → 질문 유지", r.questions.length === 1);
  check("후보 2개 → 해당 칸은 비움 (우리가 고르지 않음)", r.fills.find((f) => f.id === "a")?.value === "");
}

{
  // 후보 1개 — 확인 요청일 뿐. 질문을 버리고 채운다.
  const r = refineQuestions([], [Q("b", ["재단법인 미래나눔"])], SOURCE);
  check("후보 1개 → 질문 없어짐", r.questions.length === 0);
  check("후보 1개 → 그 값으로 채움", r.fills.find((f) => f.id === "b")?.value === "재단법인 미래나눔");
}

{
  // 후보 1개인데 자료에 없는 값 — 근거 검증에 걸려 채우지 않는다.
  const r = refineQuestions([], [Q("c", ["비해당"])], SOURCE);
  check("후보 1개라도 자료에 없으면 안 채움", !r.fills.find((f) => f.id === "c")?.value);
}

{
  // 후보 1개인데 이미 채워져 있으면 기존 값을 유지한다.
  const r = refineQuestions([F("d", "제2015-041호")], [Q("d", ["제2015-041호"])], SOURCE);
  check("후보 1개 + 기존 값 있음 → 기존 값 유지", r.fills.find((f) => f.id === "d")?.value === "제2015-041호");
}

{
  // 후보 0개 — 자료에 없다는 뜻. 질문이 아니라 비워둠이다.
  const r = refineQuestions([], [Q("e", [])], SOURCE);
  check("후보 0개 → 질문 없어짐", r.questions.length === 0);
  check("후보 0개 → 비워둠으로 기록", r.fills.find((f) => f.id === "e")?.note === "자료에 해당 정보 없음");
}

{
  // 같은 칸을 여러 번 묻는 경우 한 번만 남긴다.
  const r = refineQuestions([], [Q("f", ["x1", "x2"]), Q("f", ["x1", "x3"])], SOURCE);
  check("같은 칸 중복 질문 → 1건만", r.questions.length === 1);
}

{
  // 중복 후보는 하나로 접어 "후보 2개"로 오인하지 않는다.
  const r = refineQuestions([], [Q("g", ["과장", "과장 "])], SOURCE);
  check("중복 후보는 접힘 → 질문 아님", r.questions.length === 0);
}

console.log("=".repeat(70));
console.log(`${pass2}/${pass2 + fail2} 통과${fail2 ? ` · ${fail2}건 실패` : ""}`);

process.exit(fail + fail2 ? 1 : 0);
