/**
 * 주입기 — 원본 문자열의 앵커 구간만 갈아끼운다.
 *
 * 이 파일이 축 4(무손상)의 핵심이다. XML을 재직렬화하지 않고, 등록된 [start, end]
 * 구간만 교체한다. 그래서 나머지 바이트는 비트 단위로 동일하고, "무엇을 건드리지
 * 않았는지"가 증명 가능한 사실이 된다.
 */
import { escapeXml } from "./xml";
import type { Anchor } from "./types";

export interface Edit {
  anchor: Anchor;
  /** 앵커 구간을 대체할 최종 문자열 */
  replacement: string;
}

/** 앵커와 값으로 실제 교체 문자열을 만든다. */
export function buildEdit(a: Anchor, value: string): Edit {
  if (a.mode === "empty_run") {
    // <hp:run charPrIDRef="0"/>  →  <hp:run charPrIDRef="0"><hp:t>값</hp:t></hp:run>
    const ref = a.charPrIDRef ?? "0";
    return {
      anchor: a,
      replacement: `<hp:run charPrIDRef="${ref}"><hp:t>${renderText(value)}</hp:t></hp:run>`,
    };
  }

  if (a.mode === "text_node") {
    // <hp:t>기존</hp:t> 의 안쪽만 교체 (앵커가 이미 안쪽 구간을 가리킨다)
    return { anchor: a, replacement: renderText(value) };
  }

  if (a.mode === "append") {
    // 괄호 안내문 뒤에 이어 쓴다: "(이름)" → "(이름) 박서연"
    // 앵커는 길이 0인 지점이므로 원래 글자를 지우지 않는다.
    return { anchor: a, replacement: renderText(`${a.prefix ?? " "}${value}`) };
  }

  // fixed_width — 체크박스. 글자 수를 유지해야 표가 밀리지 않는다.
  const width = a.width ?? 0;
  let s = value;
  if (s.length > width) s = s.slice(0, width);
  // 가운데에 표식을 두고 나머지는 공백으로 채운다
  const pad = width - s.length;
  const left = Math.floor(pad / 2);
  return {
    anchor: a,
    replacement: escapeXml(" ".repeat(left) + s + " ".repeat(pad - left)),
  };
}

/**
 * 문단 내 줄바꿈은 <hp:lineBreak/>로 표현한다.
 * (문단 자체를 나누는 다문단 값은 MVP 범위 밖 — 문단 복제가 필요해 구조 변경이 된다.)
 */
function renderText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => escapeXml(line))
    .join("</hp:t><hp:lineBreak/><hp:t>");
}

/**
 * 여러 구간을 한 문자열에 적용한다.
 * 반드시 오프셋 내림차순으로 적용해야 앞쪽 구간의 오프셋이 밀리지 않는다.
 */
export function applyEdits(xml: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.anchor.start - a.anchor.start);

  // 구간이 겹치면 결과가 조용히 깨지므로 미리 막는다
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].anchor.end > sorted[i - 1].anchor.start) {
      throw new Error(
        `앵커 구간이 겹칩니다: [${sorted[i].anchor.start}, ${sorted[i].anchor.end}) 와 ` +
          `[${sorted[i - 1].anchor.start}, ${sorted[i - 1].anchor.end})`,
      );
    }
  }

  let out = xml;
  for (const e of sorted) {
    out = out.slice(0, e.anchor.start) + e.replacement + out.slice(e.anchor.end);
  }
  return out;
}

/**
 * 범위 이탈 검사 — 결과물에서 편집 구간만 원본 값으로 되돌렸을 때
 * 원본과 완전히 일치하면, 모든 변경이 앵커 내부에서만 일어났음이 증명된다.
 */
export function changesStayInBounds(
  original: string,
  result: string,
  edits: Edit[],
): boolean {
  const asc = [...edits].sort((a, b) => a.anchor.start - b.anchor.start);
  let rebuilt = "";
  let cursor = 0;
  let drift = 0;

  for (const e of asc) {
    const { start, end } = e.anchor;
    // 편집 사이의 무변경 구간은 결과물에서 그대로 가져온다
    rebuilt += result.slice(cursor + drift, start + drift);
    // 편집 구간은 원본 값으로 되돌린다
    rebuilt += original.slice(start, end);
    drift += e.replacement.length - (end - start);
    cursor = end;
  }
  rebuilt += result.slice(cursor + drift);

  return rebuilt === original;
}
