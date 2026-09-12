/**
 * 글자 폭 계산.
 *
 * capacity를 글자 "수"로 재면 틀린다. 한글은 정사각형이라 글자 폭이 글꼴 크기와
 * 같지만, 영문·숫자는 대략 절반이다. 그래서 "https://mirae-nanum.or.kr"(25자)이
 * 한글 18자 칸을 넘친다고 잘못 판정됐다. 실제로는 한글 12~13자 폭이라 들어간다.
 *
 * 단위는 "한글 한 글자 폭"이다.
 */

/** 전각(한 글자 폭 1.0)으로 볼 문자인가. */
function isFullWidth(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // 한글 자모
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK 부수·기호
    (cp >= 0x3041 && cp <= 0x33ff) || // 가나·호환자모·CJK 기호
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 확장 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 통합한자
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || // 한글 음절
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 호환한자
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // 전각 영숫자
    (cp >= 0xffe0 && cp <= 0xffe6)
  );
}

/**
 * 문자열이 차지하는 폭을 한글 글자 수 기준으로 잰다.
 * 전각 1.0, 반각 0.5. 줄바꿈은 줄을 나누므로 가장 긴 줄을 기준으로 한다.
 */
export function textWidth(s: string): number {
  let max = 0;
  for (const line of s.split(/\r?\n/)) {
    let w = 0;
    for (const ch of line) {
      const cp = ch.codePointAt(0)!;
      w += isFullWidth(cp) ? 1 : 0.5;
    }
    max = Math.max(max, w);
  }
  return max;
}

/** 여러 줄에 걸쳐 실제로 필요한 총 폭 (칸 전체 수용량과 비교할 때 쓴다). */
export function totalWidth(s: string): number {
  let w = 0;
  for (const ch of s.replace(/\r?\n/g, "")) {
    const cp = ch.codePointAt(0)!;
    w += isFullWidth(cp) ? 1 : 0.5;
  }
  return w;
}
