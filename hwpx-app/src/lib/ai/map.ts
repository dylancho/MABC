/**
 * 매핑 — 자료(B)의 내용을 슬롯에 배정한다.
 *
 * 이 계층에만 LLM이 있다. hwpx-core는 이 파일을 모른다.
 *
 * 관통 원칙(설계 문서 §8): 조용히 틀리느니 시끄럽게 묻는다.
 *   - 근거가 없으면 채우지 않는다. `value`를 비우고 이유를 남긴다.
 *   - 채운 값에는 반드시 B 원문 인용(`evidence`)을 붙인다. 인용을 못 대면 추측이다.
 *   - 자료에 후보가 둘 이상이면 고르지 말고 `question`으로 올린다.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { getSolar } from "./solar";
import type { Slot } from "../hwpx/types";

const FillSchema = z.object({
  fills: z.array(
    z.object({
      id: z.string().describe("슬롯 id. 주어진 목록에 있는 것만."),
      value: z.string().describe("칸에 넣을 값. 근거가 없으면 빈 문자열."),
      evidence: z
        .string()
        .describe("자료에서 그대로 가져온 인용. 값이 비어 있으면 빈 문자열."),
      note: z.string().describe("비워둔 이유 또는 주의사항. 없으면 빈 문자열."),
    }),
  ),
  questions: z.array(
    z.object({
      id: z.string().describe("어느 슬롯에 대한 질문인지"),
      question: z.string().describe("사용자에게 물어볼 한 문장"),
      candidates: z.array(z.string()).describe("자료에서 찾은 후보들"),
    }),
  ),
});

export interface MappedFill {
  id: string;
  value: string;
  evidence: string;
  note: string;
}

export interface MappedQuestion {
  id: string;
  question: string;
  candidates: string[];
}

export interface MapResult {
  fills: MappedFill[];
  questions: MappedQuestion[];
  /** 실패한 청크의 오류 메시지. 비어 있지 않으면 결과가 불완전하다는 뜻이다. */
  errors: string[];
}

const SYSTEM = `당신은 대한민국 공문서 작성을 돕는 전문가입니다.
빈 칸 목록과 자료가 주어집니다. 자료에 근거가 있는 칸만 채우세요.

절대 규칙:
1. 자료에 없는 내용을 지어내지 마십시오. 공문서 허위기재는 심각한 문제입니다.
   근거가 없으면 value를 빈 문자열("")로 두고 note에 이유를 쓰세요.
2. 채운 값에는 반드시 evidence에 자료 원문을 그대로 인용하세요.
   인용을 댈 수 없으면 그것은 추측이므로 채우지 마십시오.
3. questions는 **자료 안에 서로 다른 후보가 2개 이상 있어서 무엇을 고를지
   판단할 수 없을 때만** 올리고, candidates에 그 후보들을 모두 담으세요.
   - 자료에 답이 하나뿐이면 질문하지 말고 그냥 채우세요. 확인차 되묻지 마십시오.
   - 자료에 답이 아예 없으면 질문하지 말고 value를 비우고 note에 이유를 쓰세요.
4. 칸 크기는 참고치입니다. 글이 넘치면 줄이 바뀌고 행 높이가 늘어날 뿐이니 조금 넘는 것은
   괜찮습니다. 크게 넘칠 때만 공문서 문체로 압축하되, 의미를 잘라먹지는 마십시오
   ("청소년 장학금 지원"을 "청소년"으로 줄이면 안 됩니다).
   글자수는 한글 기준이며 영문·숫자는 0.5자로 셉니다 (URL 24자 = 한글 12자).
5. hint가 있으면 그것은 양식 발급기관이 쓴 작성 지시문입니다. 반드시 따르세요.
6. choices가 있으면 그 중 하나를 정확히 그대로 골라 value에 쓰세요.
7. 문체는 공문서체(개조식, 명사형 종결)로 씁니다.
8. 라벨의 행 이름(임야, 채권, 기타 …)에 해당하는 항목이 자료에 없으면 그 칸은 비우세요.
   다른 행의 값을 옮겨 넣지 마십시오. 자료가 "보통재산"이라고 말한 항목은 "기본재산" 행에
   넣지 마십시오. 하나의 사실은 한 칸에만 들어갑니다.

주어진 목록에 없는 id는 만들지 마십시오.`;

/**
 * 근거 검증 — 모델이 낸 인용이 자료에 실제로 존재하는 문장인지 대조한다.
 *
 * 이게 이 제품의 마지막 방어선이다. 프롬프트로 "지어내지 마세요"라고 부탁하는 것과
 * 인용을 원문과 대조하는 것은 보장의 성격이 다르다. 전자는 부탁이고 후자는 검사다.
 *
 * 공백/문장부호 차이는 허용하고, 인용이 너무 짧으면(자료 어디에나 있을 법한 단편)
 * 근거로 인정하지 않는다.
 */
export function quotesSource(evidence: string, source: string, value = ""): boolean {
  const norm = (s: string) => s.replace(/[\s.,'"''""()\[\]{}·:;\-—~]/g, "");
  const src = norm(source);

  // ⓪ 숫자 값은 그 숫자가 자료에 그대로 있어야 한다.
  //    진짜 문장을 인용하면서 숫자만 합산해 넣은 사례가 있었다("2,240,000" — 자료 어디에도
  //    없는 수). 인용이 맞다고 값이 맞는 게 아니다. 계산한 값은 받지 않는다.
  //    숫자열 부분일치로 하면 "5,000"이 "1,850,000" 안에서 걸린다. 자료의 숫자를 토큰으로
  //    끊어 같은 수이거나 천원 단위로 환산한 수(96,000 ↔ 96,000,000)일 때만 인정한다.
  //    "2022. 6. 14." 같은 날짜는 수가 아니다 — 수 하나(천단위 쉼표, 소수점 허용)만 본다.
  const numeric = value.trim().match(/^\d[\d,]*(\.\d+)?\s*(천원|만원|원|명|주|㎡|%|개|회|건)?$/);
  if (numeric) {
    const d = value.replace(/\D/g, "");
    // 한 자리 수도 대조한다 — 모델이 "감사 2명"의 근거를 바꿔 인용해서 2가 막힌 사례.
    if (d.length >= 1) {
      const tokens = new Set([...source.matchAll(/\d[\d,]*/g)].map((m) => m[0].replace(/,/g, "")));
      return tokens.has(d) || tokens.has(d + "000") || tokens.has(d + "0000");
    }
  }

  // ① 제시한 인용이 자료에 실제로 있는가
  const e = norm(evidence);
  if (e.length >= 4 && src.includes(e)) return true;

  // ② 인용이 다듬어졌더라도 넣으려는 값 자체가 자료에 그대로 있으면 근거로 인정한다.
  //    단, 짧은 값은 우연히 걸린다. 실제로 "해당"이 자료의 "해당사항 없습니다"에
  //    포함돼 환각이 통과한 사례가 있었다. 그래서 4자 이상만 인정한다.
  //    ("저소득층 의료비 지원"은 통과, "비해당"·"해당"·"당"은 차단.)
  const v = norm(value);
  if (v.length >= 4 && src.includes(v)) return true;

  return false;
}

function renderSlots(slots: Slot[]): string {
  return slots
    .map((s) => {
      const parts = [`[${s.id}]`, `라벨: ${s.labelPath.join(" › ") || s.label}`];
      if (s.kind === "choice" && s.choices?.length) {
        parts.push(`선택지(이 중 하나를 정확히): ${s.choices.join(" | ")}`);
      } else {
        parts.push(`칸 크기 약 ${s.capacity.chars}자 (한글 기준, 영문·숫자는 0.5자)`);
      }
      if (s.unit) parts.push(`단위: ${s.unit}`);
      if (s.hint) parts.push(`작성요령: ${s.hint}`);
      if (s.confidence === "low") parts.push("※ 이 칸이 무엇을 요구하는지 불확실함");
      return parts.join(" · ");
    })
    .join("\n");
}

/** 슬롯이 많으면 한 프롬프트에 못 넣는다. 표 단위로 묶어 청크로 나눈다. */
function chunk(slots: Slot[], size: number): Slot[][] {
  const groups = new Map<string, Slot[]>();
  for (const s of slots) {
    // id 형태: s0.t3.r2c1[.x] — 표 단위로 묶는다
    const key = s.id.split(".").slice(0, 2).join(".");
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }

  const out: Slot[][] = [];
  let cur: Slot[] = [];
  for (const g of groups.values()) {
    for (const s of g) {
      cur.push(s);
      if (cur.length >= size) {
        out.push(cur);
        cur = [];
      }
    }
    if (cur.length >= size * 0.6) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

export interface MapOptions {
  /** 한 요청에 넣을 슬롯 수 */
  chunkSize?: number;
  /** 동시에 보낼 요청 수 */
  concurrency?: number;
  /** 처리할 슬롯 상한 — 초과분은 비워둔 채로 남긴다 */
  maxSlots?: number;
  /** 청크 하나에 허용하는 시간(ms). 넘기면 그 청크만 버리고 나머지로 진행한다 */
  chunkTimeoutMs?: number;
}

export async function mapContentToSlots(
  slots: Slot[],
  sourceText: string,
  opts: MapOptions = {},
): Promise<MapResult & { skipped: number }> {
  // 청크 상한 90초 × 최대 2배치 = 180초 < 함수 상한 300초. Solar가 한 번 늦어도 파일은 나온다.
  // (실측: 재시도 기본값 2회가 겹쳐 청크 하나가 300초를 넘겨 504가 두 번 났다.)
  const { chunkSize = 40, concurrency = 4, maxSlots = 400, chunkTimeoutMs = 90_000 } = opts;

  // 값을 넣을 수 있는 슬롯만 대상으로 한다
  const fillable = slots.filter((s) => s.kind !== "readonly_note");
  // 라벨을 위에서 물려받은 빈 칸은 보내지 않는다.
  //
  // 대차대조표처럼 머리글 아래 빈 줄이 20개씩 있는 표에서는 칸 40개가 전부 「계정과목」
  // 이라는 같은 이름표를 달게 된다. 모델이 어느 줄인지 구분할 수 없어 같은 숫자를 다섯 칸에
  // 뿌린 것이 실측됐다. 그런 칸은 비워서 내보내고 사람이 채운다 — 도배보다 빈칸이 낫다.
  // (양식에 표식이 적힌 inline·append·choice는 라벨 신뢰도와 무관하게 보낸다.)
  const targets = fillable.filter(
    (s) =>
      (s.kind !== "text" || s.confidence === "high") &&
      // 소계·합계·총계는 계산 칸이다. 모델이 합산하려다 틀린 수를 두 개 내놓고 되묻는
      // 사례가 질문 10건 중 5건이었다. 계산값은 받지 않기로 했으니 보내지 않는다.
      !/(소|합|총)\s*계/.test(s.label) &&
      !/^계$/.test(s.label.replace(/\s+/g, "")),
  );
  const use = targets.slice(0, maxSlots);
  const skipped = fillable.length - use.length;

  const byId = new Map(use.map((s) => [s.id, s]));
  const model = getSolar();
  const chunks = chunk(use, chunkSize);
  const fills: MappedFill[] = [];
  const questions: MappedQuestion[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const valid = new Set(use.map((s) => s.id));

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((c) =>
        generateObject({
          model,
          schema: FillSchema,
          system: SYSTEM,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(chunkTimeoutMs),
          prompt:
            `## 채워야 할 칸\n${renderSlots(c)}\n\n` +
            `## 가진 자료\n${sourceText.slice(0, 60000)}\n\n` +
            `위 칸들을 자료에 근거해서만 채우세요.`,
        }),
      ),
    );

    for (const r of results) {
      if (r.status !== "fulfilled") {
        // 실패를 삼키면 "채운 칸 0개"가 정상 결과처럼 보인다. 반드시 드러낸다.
        const err = r.reason as Error & { name?: string };
        const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError" || /abort|timeout/i.test(err?.message ?? "");
        errors.push(
          timedOut
            ? `Solar 응답이 ${Math.round(chunkTimeoutMs / 1000)}초를 넘겨 칸 ${batch[results.indexOf(r)]?.length ?? "?"}개를 비워둠`
            : (err?.message ?? String(r.reason)),
        );
        continue;
      }
      for (const f of r.value.object.fills) {
        if (!valid.has(f.id)) continue; // 없는 id를 만들어낸 경우 버린다
        if (seen.has(f.id)) continue; // 같은 칸을 두 번 채우려는 경우 첫 것만 쓴다
        seen.add(f.id);

        const slot = byId.get(f.id);
        if (f.value && slot && !zeroAttributed(f, slot)) {
          // "없으면 0"은 추론이지 근거가 아니다. 단시간 근로자 언급이 없는 자료로
          // 「단시간 0 명」을 만든 사례. 0은 그 칸 얘기를 하는 근거가 있을 때만 받는다.
          fills.push({
            id: f.id,
            value: "",
            evidence: "",
            note: "자료가 이 항목을 0이라고 말하지 않아 비워둠 (없다고 0으로 쓰지 않음)",
          });
          continue;
        }
        if (f.value && !quotesSource(f.evidence, sourceText, f.value)) {
          // 인용이 없거나, 인용이라고 낸 문장이 자료에 실제로 존재하지 않으면 추측이다.
          // 실제로 모델이 근거란에 "자료가 없음"이라고 쓰고서 값을 채우는 사례를 확인했다.
          // 프롬프트로 부탁할 문제가 아니라 기계적으로 막는다.
          fills.push({
            id: f.id,
            value: "",
            evidence: "",
            note: f.evidence
              ? `자료에 없는 내용을 근거로 들어 비워둠 (제시된 근거: "${f.evidence.slice(0, 40)}")`
              : "근거 인용이 없어 비워둠",
          });
          continue;
        }
        fills.push(f);
      }
      for (const q of r.value.object.questions) {
        if (valid.has(q.id)) questions.push(q);
      }
    }
  }

  const refined = refineQuestions(dedupeColumn(fills, use), questions, sourceText);
  return { ...refined, errors, skipped };
}

/**
 * 값이 0이면 근거 인용이 이 칸의 라벨을 언급해야 한다.
 * "법인세 환급액 0"을 근거로 든 법인세 환급액 칸은 통과, "직원은 상근 7명"을 근거로 든
 * 「(가입 0 명)」은 차단. 0이 아닌 값은 이 검사와 무관하다(true).
 */
export function zeroAttributed(f: MappedFill, slot: Slot): boolean {
  if (!/^0\s*(천원|만원|원|명|주|㎡|%|개|회|건)?$/.test(f.value.trim())) return true;
  const norm = (s: string) => s.replace(/[\s,.()【】·:;\-]/g, "");
  const ev = norm(f.evidence);
  const words = [...slot.labelPath, slot.label]
    .flatMap((p) => p.split(/[\s·›]+/))
    .map(norm)
    .filter((w) => w.length >= 2);
  return words.some((w) => ev.includes(w));
}

/**
 * 같은 표·같은 열에 같은 값이 여러 칸 배정되면 하나만 남긴다.
 *
 * 실측: 재산현황에서 건물 평가액 1,780,000이 「건 물」 행과 「임야」 행에 같이 들어갔고,
 * 예금 310,000이 「기본재산 현 금」과 「보통재산 현 금」에 같이 들어갔다. 하나의 사실은
 * 한 칸에만 들어간다. 어느 칸을 남길지는 라벨 경로의 단어가 근거 인용에 나오는 쪽으로
 * 정한다 — "보통재산 중 310,000"이라는 근거는 「보통재산」 경로를 가리킨다.
 * 다섯 자리 이상 숫자만 본다(0, 2 같은 값은 여러 칸에 정당하게 반복된다).
 */
export function dedupeColumn(fills: MappedFill[], slots: Slot[]): MappedFill[] {
  const byId = new Map(slots.map((s) => [s.id, s]));
  const norm = (s: string) => s.replace(/[\s,.()]/g, "");
  const groups = new Map<string, MappedFill[]>();
  for (const f of fills) {
    const d = f.value.replace(/\D/g, "");
    if (!f.value || d.length < 5 || !/^[\d,.\s]+(천원|만원|원)?$/.test(f.value.trim())) continue;
    const m = f.id.match(/^(s\d+\.t\d+)\.r\d+c(\d+)/);
    if (!m) continue;
    const key = `${m[1]}.c${m[2]}:${d}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const drop = new Set<string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const score = (f: MappedFill) => {
      const ev = norm(f.evidence);
      return (byId.get(f.id)?.labelPath ?? []).filter((p) => ev.includes(norm(p))).length;
    };
    const keep = g.reduce((a, b) => (score(b) > score(a) ? b : a));
    for (const f of g) if (f !== keep) drop.add(f.id);
  }
  return fills.map((f) =>
    drop.has(f.id)
      ? { id: f.id, value: "", evidence: "", note: "같은 값이 다른 칸에 이미 배정돼 비워둠" }
      : f,
  );
}

/**
 * 되묻기 정리 — 모델은 "확인차" 질문을 남발한다.
 *
 * 실측: 서식1에서 질문 27건이 나왔는데 대부분이 "주소는 '서울특별시 …'로 작성해도
 * 될까요?" 같은, 자료에 답이 하나뿐인 확인 요청이었다. 무대에서 27개를 띄우면
 * 데모가 죽고, 실사용에서는 사용자가 질문을 안 읽게 된다.
 *
 * 후보 개수로 기계적으로 가른다.
 *   2개 이상 → 진짜 모호함. 질문으로 남기고, 그 칸은 비워서 사용자가 고르게 한다.
 *   1개      → 확인 요청일 뿐. 질문을 버리고 그 값으로 채운다(근거 검증은 그대로).
 *   0개      → 자료에 없다는 뜻. 질문을 버리고 비워둔다(비워둔 칸 목록에 나타난다).
 */
export function refineQuestions(
  rawFills: MappedFill[],
  rawQuestions: MappedQuestion[],
  sourceText: string,
): { fills: MappedFill[]; questions: MappedQuestion[] } {
  const fills = new Map(rawFills.map((f) => [f.id, { ...f }]));
  const questions: MappedQuestion[] = [];
  const asked = new Set<string>();

  for (const q of rawQuestions) {
    if (asked.has(q.id)) continue; // 같은 칸을 여러 번 묻지 않는다
    // 「성동구 왕십리로 222」와 「서울시 성동구 왕십리로 222」는 같은 사실이다.
    // 한쪽이 다른 쪽에 포함되면 긴 쪽 하나로 접는다. 「빈칸 유지」 같은 비후보도 뺀다.
    const raw = [...new Set(q.candidates.map((c) => c.trim()).filter(Boolean))].filter(
      (c) => !/^(빈칸|공란|비워|없음)/.test(c),
    );
    const key = (c: string) => c.replace(/[\s,.\-()]/g, "");
    const candidates = raw.filter((a) => !raw.some((b) => b !== a && key(b).includes(key(a))));

    if (candidates.length >= 2) {
      asked.add(q.id);
      questions.push({ ...q, candidates });
      // 진짜 모호하면 우리가 고르지 않는다. 사용자가 고르도록 비운다.
      fills.set(q.id, {
        id: q.id,
        value: "",
        evidence: "",
        note: `자료에 후보가 ${candidates.length}개 있어 비워둠 — 선택 필요`,
      });
      continue;
    }

    if (candidates.length === 1) {
      // 확인 요청. 이미 채워져 있으면 그대로 두고, 비어 있으면 그 후보로 채운다.
      const existing = fills.get(q.id);
      if (existing?.value) continue;
      const value = candidates[0];
      if (quotesSource("", sourceText, value)) {
        fills.set(q.id, { id: q.id, value, evidence: value, note: "" });
      }
      continue;
    }

    // 후보 0개 — 자료에 없다는 뜻이다. 질문할 게 아니라 비워두면 된다.
    if (!fills.get(q.id)?.value) {
      fills.set(q.id, { id: q.id, value: "", evidence: "", note: "자료에 해당 정보 없음" });
    }
  }

  return { fills: [...fills.values()], questions };
}
