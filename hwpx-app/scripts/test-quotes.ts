import { quotesSource, dedupeColumn, zeroAttributed } from "../src/lib/ai/map";
import type { Slot } from "../src/lib/hwpx/types";
const src = "기본재산 1,850,000천원 / 보통재산 420,000천원\n집행액 96,000,000원 (800,000원 × 120명)\n법인세 환급액 0";
let f = 0;
const t = (name: string, got: boolean, want: boolean) => { console.log(`${got === want ? "PASS" : "FAIL"}  ${name}`); if (got !== want) f++; };
t("자료에 있는 숫자 통과", quotesSource("기본재산 1,850,000천원", src, "1,850,000"), true);
t("천원 환산(96,000)도 자료 96,000,000의 부분이라 통과", quotesSource("집행액 96,000,000원", src, "96,000"), true);
t("합산해 만든 2,240,000 차단 (인용은 진짜여도)", quotesSource("기본재산 1,850,000천원", src, "2,240,000"), false);
t("자료에 없는 5,000 차단", quotesSource("보통재산 420,000천원", src, "5,000"), false);
t("문자 값은 기존 규칙 그대로", quotesSource("보통재산 420,000천원", src, "하나은행"), true);
t("한 자리 수 '2'도 자료 토큰(감사 2명)이면 통과 — 근거를 바꿔 인용해도", quotesSource("정관상 임원 정수는 감사 2명", "정관상 임원 정수는 이사 11명, 감사 2명입니다.", "2"), true);
t("자료에 없는 한 자리 수 '7' 차단", quotesSource("정관상 임원 정수는 감사 2명", "정관상 임원 정수는 이사 11명, 감사 2명입니다.", "7"), false);
{
  const slot = (id: string, path: string[]): Slot => ({ id, kind: "text", label: path[path.length - 1], labelPath: path, confidence: "high", capacity: { chars: 8, lines: 1 } });
  const slots = [
    slot("s0.t26.r5c4", ["재산현황", "기본재산", "현 금", "평가액(원)"]),
    slot("s0.t26.r18c4", ["재산현황", "보통재산", "현 금", "평가액(원)"]),
    slot("s0.t26.r9c4", ["재산현황", "기본재산", "건 물", "평가액(원)"]),
    slot("s0.t26.r13c4", ["재산현황", "기본재산", "임야(林野)", "평가액(원)"]),
    slot("s0.t1.r15c4", ["출연금"]), slot("s0.t13.r15c4", ["출연금"]),
  ];
  const out = dedupeColumn([
    { id: "s0.t26.r5c4", value: "310,000", evidence: "예금 보통재산 중 310,000천원", note: "" },
    { id: "s0.t26.r18c4", value: "310,000", evidence: "예금 보통재산 중 310,000천원", note: "" },
    { id: "s0.t26.r9c4", value: "1,780,000", evidence: "부동산 성동구 왕십리로 222 건물 3층, 평가액 1,780,000천원", note: "" },
    { id: "s0.t26.r13c4", value: "1,780,000", evidence: "부동산 성동구 왕십리로 222 건물 3층, 평가액 1,780,000천원", note: "" },
    { id: "s0.t1.r15c4", value: "300,000", evidence: "출연금 300,000", note: "" },
    { id: "s0.t13.r15c4", value: "300,000", evidence: "출연금 300,000", note: "" },
  ], slots);
  const v = (id: string) => out.find((x) => x.id === id)?.value;
  t("예금 310,000: 근거가 「보통재산」이라 기본재산 현금은 비움", v("s0.t26.r5c4") === "", true);
  t("예금 310,000: 보통재산 현금은 유지", v("s0.t26.r18c4") === "310,000", true);
  t("건물 1,780,000: 근거에 「건물」 있어 건 물 행 유지", v("s0.t26.r9c4") === "1,780,000", true);
  t("건물 1,780,000: 임야 행은 비움", v("s0.t26.r13c4") === "", true);
  t("다른 표의 같은 값(예산 vs 실적 300,000)은 둘 다 유지", v("s0.t1.r15c4") === "300,000" && v("s0.t13.r15c4") === "300,000", true);
}
t("날짜 '2022. 6. 14.'는 숫자 규칙이 아니라 원문 대조로 통과", quotesSource("직전 변경은 2022. 6. 14.", "2025년 정관 변경 없음. 직전 변경은 2022. 6. 14. (목적사업 조항 신설).", "2022. 6. 14."), true);
{
  const slot = (id: string, path: string[]): Slot => ({ id, kind: "inline", label: path[path.length - 1], labelPath: path, confidence: "high", capacity: { chars: 4, lines: 1 } });
  t("0: 근거가 「법인세 환급액 0」이면 법인세 환급액 칸은 통과", zeroAttributed({ id: "a", value: "0", evidence: "법인세 환급액 0", note: "" }, slot("a", ["3. 예산현황", "⑥ 법인세 환급액"])), true);
  t("0: 근거가 「직원은 상근 7명」이면 (가입 0 명)은 차단", zeroAttributed({ id: "b", value: "0", evidence: "직원은 상근 7명 — 사무국장 1, 사업팀 4", note: "" }, slot("b", ["노동자 고용 현황", "가입"])), false);
  t("0: 단시간 언급 없는 근거로 단시간 0 명 차단", zeroAttributed({ id: "c", value: "0 명", evidence: "직원은 상근 7명. 기간제 2명 별도.", note: "" }, slot("c", ["노동자 고용 현황", "단시간"])), false);
  t("0 아닌 값은 검사 대상 아님", zeroAttributed({ id: "d", value: "7", evidence: "아무거나", note: "" }, slot("d", ["일반직"])), true);
}
process.exit(f);
