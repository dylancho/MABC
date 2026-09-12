/** 슬롯 IR — 해부기의 출력이자 주입기의 입력. */

export type SlotKind =
  | "text" // 빈 셀 하나에 값 하나
  | "choice" // 【 】/□ 체크박스, 택1
  | "inline" // 한 셀 안에 여러 필드 (예: "(이름) (전화번호)")
  | "append" // 괄호 안내문 뒤에 이어 쓰는 자리 (예: "(이름)" → "(이름) 박서연")
  | "example_row" // (예약) "(예) ..." 예시 칸 — 지금은 건드리지 않고 아래 칸의 힌트로만 쓴다
  | "readonly_note"; // ※/* 안내문 — 건드리지 않는다

/** 원본 문자열에서 실제로 교체할 구간. 클라이언트/LLM에는 절대 노출하지 않는다. */
export interface Anchor {
  /** 이 슬롯이 속한 section 파일 이름 */
  file: string;
  start: number;
  end: number;
  /** 교체 방식 — 주입기가 어떤 문자열을 만들지 결정한다 */
  mode: "empty_run" | "text_node" | "fixed_width" | "append";
  /** empty_run일 때 유지해야 할 charPrIDRef */
  charPrIDRef?: string;
  /** fixed_width(체크박스)일 때 원래 구간의 길이 — 글자 수를 바꾸면 안 된다 */
  width?: number;
  /** append일 때 값 앞에 붙일 구분자 (보통 공백 한 칸) */
  prefix?: string;
  /**
   * 이 앵커가 속한 문단의 <hp:linesegarray> 구간.
   *
   * linesegarray는 한글이 저장할 때 기록해 둔 줄 렌더링 캐시(줄 폭·글자 위치·baseline)다.
   * 텍스트 길이를 바꾸면 이 캐시가 실제와 어긋나고, 한글은 캐시의 줄 폭을 신뢰해
   * 자간을 밀어붙인다 — 그래서 표는 멀쩡한데 글자끼리 겹친다.
   * 값을 넣은 문단은 이 캐시를 지워서 한글이 다시 계산하게 한다.
   */
  paraLineSeg?: { start: number; end: number };
}

export interface Slot {
  id: string;
  kind: SlotKind;
  label: string;
  /** 상위 헤더 체인. 예: ["재산 현황", "기본재산", "2024년"] */
  labelPath: string[];
  confidence: "high" | "medium" | "low";
  choices?: string[];
  /** 「작성요령」에서 끌어온 지시문 */
  hint?: string;
  unit?: string;
  /** 셀 크기와 글꼴 크기로 추정한 수용량 */
  capacity: { chars: number; lines: number };
}

/** 슬롯 + 앵커. 서버 내부에서만 사용한다. */
export interface InternalSlot extends Slot {
  /** text / inline / example_row 슬롯의 교체 구간 */
  anchor?: Anchor;
  /**
   * choice 슬롯의 선택지별 구간. 한 셀 안의 "사단【 】 재단【 】"이 하나의 슬롯이 되고,
   * 선택된 항목의 앵커에만 표식을 넣고 나머지는 공백으로 되돌린다.
   */
  options?: { label: string; anchor: Anchor }[];
}

export interface DissectResult {
  slots: Slot[];
  /** 검출은 됐지만 MVP 범위 밖이라 건드리지 않는 영역 */
  unsupported: { id: string; reason: string; preview: string }[];
  /** 문서에 있던 「작성요령」·「유의사항」 원문 블록 */
  formNotes: string[];
  stats: {
    sections: number;
    tables: number;
    cells: number;
    mergedCells: number;
  };
}

export interface VerifyReport {
  ok: boolean;
  filledSlots: number;
  /** section 파일별 변화 */
  sections: {
    file: string;
    beforeBytes: number;
    afterBytes: number;
    replacedFrom: number;
    replacedTo: number;
  }[];
  /** 모든 변경이 등록된 앵커 안에서만 일어났는가 */
  inBounds: boolean;
  /** 스타일 정의(header.xml)가 그대로인가 */
  headerUntouched: boolean;
  /** section 외에 변경된 엔트리 */
  otherChanged: string[];
  mimetypeFirstStored: boolean;
  /** 다시 계산되도록 제거한 문단 렌더링 캐시(linesegarray) 수 */
  lineSegsDropped: number;
  totalBytes: number;
  changedRatio: number;
  problems: string[];
}

export interface FillResult {
  file: Uint8Array;
  report: VerifyReport;
  /** 값이 주어지지 않아 비워둔 슬롯 */
  unfilled: { id: string; label: string }[];
  /** capacity를 넘긴 값 — 자르지 않고 알리기만 한다 */
  overflow: { id: string; label: string; chars: number; capacity: number }[];
}
