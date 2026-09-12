/**
 * 해부기 — 양식(A)을 읽어 "빈 칸이 몇 개이고 각각 무엇을 요구하는가"를 알아낸다.
 * 축 1이 여기 있다.
 *
 * 전 과정이 규칙 기반이고 LLM을 호출하지 않는다. 그래서 결정론적이고, 오프라인
 * 테스트가 되고, 비용과 지연이 0이다. "이 칸엔 사업명이 들어갈 것 같다"는 추측은
 * 하지 않는다 — 관측된 사실만 내보내고, 판단은 상위 계층(Solar)이 한다.
 *
 * 실측으로 확인된 설계 근거 (서식1/서식2 해체):
 *  - borderFillIDRef는 라벨/입력 판별의 주 신호가 못 된다 (한 양식에 98종).
 *  - 빈 칸 "찾기"는 쉽다 (빈 run이 널려 있다). 어려운 건 "라벨 귀속"이다.
 *  - 병합 셀이 최대 53%다. 그리드 복원이 전제 조건이다.
 */
import {
  children,
  findAll,
  findAllExcluding,
  findFirst,
  parseXml,
  textOf,
  unescapeXml,
  type XmlNode,
} from "./xml";
import type { Anchor, DissectResult, InternalSlot, SlotKind } from "./types";
import { sectionNames, type Container } from "./container";

/** HWPUNIT = 1/7200 inch. 글꼴 height도 같은 단위(1000 = 10pt). */
const HWPUNIT_PER_PT = 100;

interface Cell {
  node: XmlNode;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  /** 중첩 표의 내용은 제외한 이 셀 고유의 텍스트 */
  text: string;
  width: number;
  height: number;
  marginX: number;
  /**
   * 윗 테두리가 없어서 바로 위 칸과 한 칸처럼 보이는가.
   *
   * hwpx 양식은 세로로 긴 입력 영역을 병합 대신 "칸 여러 개 + 가운데 가로선 지우기"로
   * 만든다. 그래서 XML에는 칸이 3개인데 한글 화면에는 하나로 보인다. 이 여백 칸들은
   * 값을 이어 쓰는 자리가 아니라 그냥 비워 두는 자리다.
   */
  mergedWithAbove: boolean;
}

/** 「작성요령」·「기재요령」·「유의사항」 블록 표제 */
const NOTE_HEADING = /(작성|기재|기입|작성상)\s*(요령|방법)|유의\s*사항|참고\s*사항/;
/** 안내문 문단 (건드리면 안 되는 것) */
const NOTE_LINE = /^\s*[※*·○□▪-]/;

export function dissect(c: Container): {
  result: DissectResult;
  slots: InternalSlot[];
} {
  const charHeights = readCharHeights(c);
  const topBorders = readTopBorders(c);
  const files = sectionNames(c);
  const dec = new TextDecoder("utf-8");

  const slots: InternalSlot[] = [];
  const unsupported: DissectResult["unsupported"] = [];
  const formNotes: string[] = [];
  let tables = 0;
  let cells = 0;
  let mergedCells = 0;

  files.forEach((file, si) => {
    const xml = dec.decode(c.files[file]);
    const roots = parseXml(xml);

    // 「작성요령」 블록 — 양식이 스스로 채우는 법을 설명한 부분
    formNotes.push(...collectFormNotes(xml, roots));

    const tbls = findAll(roots, "hp:tbl");
    tbls.forEach((tbl, ti) => {
      tables++;
      const grid = buildGrid(xml, tbl, topBorders);
      cells += grid.list.length;
      mergedCells += grid.list.filter((x) => x.rowSpan > 1 || x.colSpan > 1).length;

      const caption = tableCaption(xml, roots, tbl);

      const tableSlots: { slot: InternalSlot; row: number; col: number }[] = [];
      const examples: { row: number; col: number; colSpan: number; text: string }[] = [];
      for (const cell of grid.list) {
        const idBase = `s${si}.t${ti}.r${cell.row}c${cell.col}`;
        const found = analyzeCell(
          xml,
          file,
          idBase,
          cell,
          grid,
          caption,
          charHeights,
        );
        for (const s of found.slots) {
          slots.push(s);
          tableSlots.push({ slot: s, row: cell.row, col: cell.col });
        }
        for (const u of found.unsupported) unsupported.push(u);
        if (found.example) examples.push(found.example);
      }
      // 예시가 있는 행은 머리글 행이다. 그 행의 다른 빈 칸(예시가 없는 열)도 입력칸이 아니다.
      // (실측: 2024년도 열의 빈 칸이 슬롯이 돼 실제 값이 머리글 행에 들어갔다.)
      const exampleRows = new Set(examples.map((e) => e.row));
      if (exampleRows.size) {
        for (const t of tableSlots) {
          if (exampleRows.has(t.row)) slots.splice(slots.indexOf(t.slot), 1);
        }
      }
      // 예시 칸 아래 같은 열의 입력칸에 「같은 형식으로」 힌트를 단다.
      // 예시 내용이 자료와 우연히 비슷하면 모델이 이름으로 열을 고른다 — 라벨을 따르라고 못박는다.
      for (const ex of examples) {
        for (const { slot, row, col } of tableSlots) {
          if (row <= ex.row || col < ex.col || col >= ex.col + ex.colSpan || slot.hint) continue;
          const sample = ex.text.replace(/^\s*\(예\s*\d*\)\s*|^\s*\(예시\)\s*/, "");
          slot.hint = `형식 예시: "${sample}". 형식만 참고하고, 어느 연도·항목의 값인지는 이 칸의 라벨을 따르세요. 예시 자체를 옮겨 적지 마세요.`;
        }
      }
    });
  });

  // 「작성요령」에서 라벨과 일치하는 지시문을 슬롯에 붙인다
  attachHints(slots, formNotes);

  const publicSlots = slots.map(({ anchor, options, ...rest }) => {
    void anchor;
    void options;
    return rest;
  });

  return {
    slots,
    result: {
      slots: publicSlots,
      unsupported,
      formNotes,
      stats: { sections: files.length, tables, cells, mergedCells },
    },
  };
}

// ---------------------------------------------------------------- 그리드 복원

interface Grid {
  list: Cell[];
  at: Map<string, Cell>;
  rows: number;
  cols: number;
}

/**
 * colSpan/rowSpan을 펼쳐 논리 격자를 만든다.
 * hwpx는 cellAddr에 논리 좌표를 명시하므로 그것을 신뢰하고, span으로 점유만 채운다.
 * 중첩 표(hp:tc 안의 hp:tbl)의 셀은 바깥 표의 격자에 넣지 않는다.
 */
function buildGrid(
  xml: string,
  tbl: XmlNode,
  topBorders: Record<string, string>,
): Grid {
  const list: Cell[] = [];
  const at = new Map<string, Cell>();
  let rows = 0;
  let cols = 0;

  for (const tr of children(tbl, "hp:tr")) {
    for (const tc of children(tr, "hp:tc")) {
      const addr = findFirst(tc, "hp:cellAddr");
      const span = findFirst(tc, "hp:cellSpan");
      const sz = findFirst(tc, "hp:cellSz");
      const mg = findFirst(tc, "hp:cellMargin");

      const row = num(addr?.attrs.rowAddr, 0);
      const col = num(addr?.attrs.colAddr, 0);
      const rowSpan = Math.max(1, num(span?.attrs.rowSpan, 1));
      const colSpan = Math.max(1, num(span?.attrs.colSpan, 1));

      const cell: Cell = {
        node: tc,
        row,
        col,
        rowSpan,
        colSpan,
        text: textOf(xml, tc, "hp:tbl").trim(),
        width: num(sz?.attrs.width, 0),
        height: num(sz?.attrs.height, 0),
        marginX: num(mg?.attrs.left, 0) + num(mg?.attrs.right, 0),
        // 0행이라도 윗선이 없으면 여백이다 — 「붙임1 | (빈칸) | 제목」 띠의 가운데 칸
        mergedWithAbove: topBorders[tc.attrs.borderFillIDRef ?? ""] === "NONE",
      };

      list.push(cell);
      for (let r = row; r < row + rowSpan; r++) {
        for (let cc = col; cc < col + colSpan; cc++) {
          if (!at.has(`${r},${cc}`)) at.set(`${r},${cc}`, cell);
        }
      }
      rows = Math.max(rows, row + rowSpan);
      cols = Math.max(cols, col + colSpan);
    }
  }
  return { list, at, rows, cols };
}

// ---------------------------------------------------------------- 라벨 귀속

/**
 * 빈 칸의 라벨을 찾는다.
 * 같은 행 왼쪽 → 같은 열 위쪽 → 표 제목 순서로 탐색한다.
 * 실패하면 confidence를 low로 표시하고 그대로 내보낸다 — 조용히 추측하지 않는다.
 */
function attributeLabel(
  cell: Cell,
  grid: Grid,
  caption: string,
): {
  label: string;
  path: string[];
  confidence: "high" | "medium" | "low";
  /** 위 칸의 세로 연속 영역이라 독립 입력칸이 아님 — 슬롯을 만들지 않는다 */
  skip?: boolean;
} {
  const path: string[] = [];
  if (caption) path.push(caption);

  // 0) 윗 테두리가 없다 = 한글 화면에서 위 칸과 한 칸이다. 값을 이어 쓰는 자리가 아니라
  // 세로로 긴 칸을 만들려고 둔 여백이므로 비워 둔다. 라벨 아래든 값 아래든 마찬가지다.
  // (자기 입력 표식을 들고 있으면 예외 — 그건 진짜 입력칸이다.)
  if (cell.mergedWithAbove && !hasOwnMarkers(cell.text)) {
    return { label: "", path, confidence: "low", skip: true };
  }
  // 왼쪽에 라벨이 있어도 마찬가지다 — 「붙임1 | (빈칸) | 제목」 띠의 가운데 칸.

  // 1) 같은 행에서 왼쪽으로 — 글자 칸을 전부 모은다(바깥→안쪽). 「기본재산 › 건 물」처럼
  //    구분과 행 이름이 둘 다 있어야 모델이 기본재산 건물과 보통재산 건물을 가른다.
  //    「계좌」「주」「㎡」 같은 단위 칸은 라벨이 아니므로 건너뛴다 (실측: 이걸 라벨로 잡아
  //    재산현황 전체가 「㎡」라는 이름표를 달았다).
  let left = "";
  let leftCell: Cell | undefined;
  const rowHeads: string[] = [];
  for (let c = cell.col - 1; c >= 0; c--) {
    const n = grid.at.get(`${cell.row},${c}`);
    if (!n || n === cell || !n.text || isPlaceholder(n.text) || isUnitText(n.text)) continue;
    if (rowHeads.includes(clean(n.text))) continue;
    rowHeads.unshift(clean(n.text));
    if (!leftCell) {
      left = n.text;
      leftCell = n;
    }
  }

  // 2) 같은 열에서 위쪽으로 — 글자 칸을 전부 모은다(바깥→안쪽). 「2021년도 › 사업명」처럼
  //    연도 머리글이 위에 하나 더 있을 때 그것까지 경로에 넣어야 모델이 열을 가른다.
  //    (실측: 2024년 수령분이 2021년도 열에 들어갔다 — 경로에 연도가 없었다.)
  //    단, 가장 가까운 글자 칸에서 시작해 **빈 칸 없이 이어진 것만** 취한다. 빈 칸을 넘어
  //    계속 올라가면 위 섹션의 머리글(「변경허가일자」「제출【 】」)까지 끌려온다.
  let upCell: Cell | undefined;
  const colHeads: string[] = [];
  for (let r = cell.row - 1; r >= 0; r--) {
    const n = grid.at.get(`${r},${cell.col}`);
    if (!n || n === cell) continue;
    if (!n.text) {
      if (upCell) break; // 머리글 덩어리가 끝났다
      continue; // 아직 가장 가까운 글자 칸을 못 찾았다
    }
    if (!upCell) upCell = n;
    if (n.colSpan >= grid.cols) break; // 행 전체를 덮는 제목 띠는 열 머리글이 아니다
    if (isPlaceholder(n.text) || isUnitText(n.text)) continue;
    if (!colHeads.includes(clean(n.text))) colHeads.unshift(clean(n.text));
  }

  // 왼쪽 라벨이 있으면 그게 이 칸의 라벨이다. 경로는 구분 › 행 › 열 순서.
  if (left) {
    path.push(...rowHeads);
    for (const h of colHeads) if (h !== clean(left) && !path.includes(h)) path.push(h);
    // 라벨 칸이 여러 줄에 걸쳐 병합돼 있고 이 칸이 그 첫 줄이 아니면, 「④기타수입」 아래
    // 항목을 여러 건 적는 줄이다. 같은 이름표를 단 칸이 셋이 되면 모델이 같은 값을
    // 세 줄에 뿌린다(실측). 첫 줄만 확실한 칸으로 치고 나머지는 medium으로 내린다.
    const firstRow = !leftCell || leftCell.row === cell.row;
    return { label: clean(left), path, confidence: firstRow ? "high" : "medium" };
  }

  // 왼쪽에 라벨이 없다 = 위 칸에서 세로로 이어지는 영역이다.
  //
  //   주사무소 소재지 | (우        ) | 전화번호
  //   [빈]          | [빈]         | 팩스번호     ← 이 왼쪽 두 칸
  //
  // 이런 칸은 위 칸이 무엇이냐에 따라 성격이 다르다.
  //   위가 라벨 칸이면  → 라벨 영역의 연속. 입력칸이 아니다.
  //   위가 값 칸이면    → 그 값의 이어쓰기 영역. 위 칸의 라벨을 물려받는다.
  if (upCell) {

    // 위 칸에 글자가 있으면 그게 이 열의 머리글이다. 「변경허가일자」 아래 세 줄은
    // 그 필드를 여러 건 적는 자리이지, 위 값을 이어 쓰는 자리가 아니다.
    if (upCell.text && !isPlaceholder(upCell.text)) {
      const head = clean(upCell.text);
      return { label: head, path: [...path, head], confidence: "medium" };
    }

    const inherited = attributeLabel(upCell, grid, caption);
    if (inherited.label) {
      return { label: inherited.label, path: inherited.path, confidence: "medium" };
    }
  }

  return { label: caption || "(라벨 미상)", path, confidence: "low" };
}

/**
 * 라벨이 아니라 칸 안내문인 텍스트.
 * "(우      )", "(직급)", "(이름)" 같은 것들은 그 칸에 무엇을 쓰라는 표시지
 * 옆 칸의 이름이 아니다. 라벨로 쓰면 값이 엉뚱한 칸에 배정된다.
 */
function isPlaceholder(text: string): boolean {
  const t = text.trim();
  return /^\(.*\)$/.test(t) || /^[\s()【】□·.\-_]*$/.test(t);
}

/** 라벨 칸인가 — 텍스트가 있고, 바로 오른쪽이 입력 영역인 칸. */
function isLabelCell(cell: Cell, grid: Grid): boolean {
  if (!cell.text || isPlaceholder(cell.text)) return false;
  const right = grid.at.get(`${cell.row},${cell.col + cell.colSpan}`);
  if (!right) return false;
  return isInputArea(right.text);
}

/**
 * 값이 들어갈 자리로 보이는 텍스트인가.
 *
 * 빈 칸과 【 】·□·공백구간뿐 아니라 「(이름)」「(직급)」 같은 괄호 안내문도 포함한다.
 * 안내문을 입력 영역으로 세지 않으면 그 왼쪽 칸("주 업무 담당자")이 라벨 칸으로
 * 인정되지 않고, 라벨 아래의 세로 연속 칸이 "(라벨 미상)" 입력칸으로 새어 나간다.
 * 실측에서 담당자 이름이 그 유령 칸으로 들어갔다.
 */
function isInputArea(text: string): boolean {
  return !text || hasBlankMarkers(text) || isPlaceholder(text);
}

/** 「세    입」「부   채   및   자   본」 — 토큰이 전부 한 글자면 자간을 벌린 머리글이다. */
function isLetterSpaced(text: string): boolean {
  const toks = text.trim().split(/\s+/);
  return toks.length >= 2 && toks.length <= 8 && toks.every((t) => t.length === 1);
}

/** 「계좌」「주」「㎡」처럼 값 옆에 붙는 단위 표기. 라벨로 쓰면 안 된다. */
function isUnitText(text: string): boolean {
  return /^(㎡|㎥|주|계좌|명|원|개|대|건|회|%|천원|만원|억원)$/.test(text.replace(/\s+/g, ""));
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 60);
}

/** 표 바로 앞 문단의 텍스트를 표 제목으로 본다. */
function tableCaption(xml: string, roots: XmlNode[], tbl: XmlNode): string {
  const paras = findAll(roots, "hp:p");
  let best = "";
  for (const p of paras) {
    if (p.end > tbl.start) break;
    const t = textOf(xml, p, "hp:tbl").trim();
    if (t && t.length <= 60 && !NOTE_LINE.test(t)) best = t;
  }
  return clean(best);
}

// ---------------------------------------------------------------- 셀 분석

function analyzeCell(
  xml: string,
  file: string,
  idBase: string,
  cell: Cell,
  grid: Grid,
  caption: string,
  charHeights: Record<string, number>,
): {
  slots: InternalSlot[];
  unsupported: DissectResult["unsupported"];
  /** 「(예) …」 안내 칸 — 값을 넣지 않고 같은 열 아래 입력칸의 힌트로 넘긴다 */
  example?: { row: number; col: number; colSpan: number; text: string };
} {
  const slots: InternalSlot[] = [];
  const unsupported: DissectResult["unsupported"] = [];

  // 중첩 표를 품은 셀은 자기 자신을 슬롯으로 만들지 않는다 (안쪽 표가 따로 처리된다)
  if (findFirst(cell.node, "hp:tbl")) return { slots, unsupported };

  const attrib = attributeLabel(cell, grid, caption);
  // 라벨 칸의 세로 연속 영역 — 입력칸이 아니므로 슬롯을 만들지 않는다
  if (attrib.skip) return { slots, unsupported };
  const cap = capacityOf(cell, charHeights);

  // --- 텍스트가 없는 셀: 순수 빈 칸
  if (!cell.text) {
    const run = findEmptyRun(cell.node);
    if (!run) {
      unsupported.push({
        id: idBase,
        reason: "빈 칸이지만 텍스트를 넣을 run을 찾지 못했습니다",
        preview: attrib.label,
      });
      return { slots, unsupported };
    }
    slots.push({
      id: idBase,
      kind: "text",
      label: attrib.label,
      labelPath: attrib.path,
      confidence: attrib.confidence,
      capacity: cap,
      unit: unitOf(cell, grid),
      anchor: {
        file,
        start: run.start,
        end: run.end,
        mode: "empty_run",
        charPrIDRef: run.attrs.charPrIDRef ?? "0",
        paraLineSeg: lineSegOf(run),
      },
    });
    return { slots, unsupported };
  }

  // --- 안내문: 건드리지 않는다
  if (NOTE_LINE.test(cell.text) && !hasBlankMarkers(cell.text)) {
    return { slots, unsupported };
  }

  // --- 「(예) 노인일자리사업 270,000,000원 보건복지부」: 머리글 행에 붙은 예시다.
  // 처음엔 "지우고 채우는 칸"으로 다뤘는데, 실측에서 실제 값이 예시 칸(2023년도 열)에
  // 들어가고 진짜 입력행은 비었다. 예시는 건드리지 않고, 같은 열 아래 칸의 힌트가 된다.
  if (/^\s*\(예\s*\d*\)|^\s*\(예시\)/.test(cell.text)) {
    return {
      slots,
      unsupported,
      example: { row: cell.row, col: cell.col, colSpan: cell.colSpan, text: clean(cell.text) },
    };
  }

  // --- 텍스트가 있는 셀 안의 표식들
  const tNodes = findAllExcluding(cell.node, "hp:t", "hp:tbl");
  const choiceOptions: { label: string; anchor: Anchor }[] = [];
  let inlineIdx = 0;

  /**
   * 셀 텍스트가 괄호 안내문으로만 이루어졌는가 — "(이름)", "(직급)", "(우      )",
   * "(이름) (전화번호)".
   *
   * 이런 칸은 안내문을 지우고 값을 넣는 게 아니라 안내문 뒤에 이어 쓴다. 지금까지는
   * 이 형태가 어떤 표식에도 안 걸려 슬롯이 0개였고, 그래서 값이 갈 곳을 잃었다.
   *
   * 단, 오른쪽이 입력 영역이면 이 칸 자체가 라벨이다 — "(4대 사회보험 가입 현황)"의
   * 오른쪽은 "(가입      명)"이므로 왼쪽은 값을 받는 칸이 아니다.
   */
  const rightOf = grid.at.get(`${cell.row},${cell.col + cell.colSpan}`);
  const isPromptCell =
    cell.text.replace(/\([^()]*\)/g, "").trim() === "" &&
    !(rightOf && isInputArea(rightOf.text));
  let appendIdx = 0;

  for (const t of tNodes) {
    const raw = xml.slice(t.innerStart, t.innerEnd);

    // 체크박스 【   】 — 안쪽 공백 구간이 앵커. 글자 수를 유지한다.
    for (const m of raw.matchAll(/【(\s+)】/g)) {
      const before = raw.slice(0, m.index!);
      const optLabel = clean(unescapeXml(before).split(/[\s,]+/).filter(Boolean).pop() ?? "");
      choiceOptions.push({
        label: optLabel || `선택${choiceOptions.length + 1}`,
        anchor: {
          file,
          start: t.innerStart + m.index! + 1,
          end: t.innerStart + m.index! + 1 + m[1].length,
          mode: "fixed_width",
          width: m[1].length,
          // 체크박스는 글자 수를 유지하므로 줄 폭이 안 변한다 → 캐시를 지울 필요가 없다
        },
      });
    }

    // 체크박스 □ — 한 글자를 ■로 바꾼다
    for (const m of raw.matchAll(/□/g)) {
      const after = raw.slice(m.index! + 1);
      const optLabel = clean(unescapeXml(after).split(/[\s,(]+/).filter(Boolean)[0] ?? "");
      choiceOptions.push({
        label: optLabel || `선택${choiceOptions.length + 1}`,
        anchor: {
          file,
          start: t.innerStart + m.index!,
          end: t.innerStart + m.index! + 1,
          mode: "fixed_width",
          width: 1,
        },
      });
    }

    // 인라인 빈칸 — 텍스트 사이의 공백 (예: "이사    명(상근   명)")
    // 「부   채   및   자   본」처럼 글자마다 벌려 쓴 머리글은 통째로 제외한다.
    if (!/【|□/.test(raw) && !isLetterSpaced(cell.text)) {
      // 「(상근   명)」처럼 3칸짜리도 있다. 자간 벌리기는 아래 한 글자 가드가 거른다.
      for (const m of raw.matchAll(/\s{3,}/g)) {
        const before = clean(unescapeXml(raw.slice(0, m.index!)));
        const after = clean(unescapeXml(raw.slice(m.index! + m[0].length)));
        if (!before && !after) continue;
        // 자간 벌리기 — 「세    입」「합    계」「상    근 임직원수」. 글자 한 개 뒤의 공백이
        // 단위(명·원·회…)로 이어지지 않으면 빈칸이 아니라 벌려 쓴 머리글이다.
        // 실측에서 이 오인으로 "세 입" 헤더 한가운데에 법인명이 박혔다.
        if (before.length <= 1 && !/^[명원회개건%천만억)]/.test(after)) continue;
        // 라벨로 쓸 조각에서 여는 괄호를 떼어낸다 — "(우" 보다 "우"가 읽힌다
        const piece = (before || after).replace(/^\(+/, "");
        slots.push({
          id: `${idBase}.i${inlineIdx++}`,
          kind: "inline",
          label: clean(`${attrib.label} · ${piece}`),
          labelPath: [...attrib.path, piece],
          confidence: before ? "high" : "medium",
          capacity: { chars: m[0].length, lines: 1 },
          unit: after.slice(0, 4) || undefined,
          anchor: {
            file,
            start: t.innerStart + m.index!,
            end: t.innerStart + m.index! + m[0].length,
            mode: "fixed_width",
            width: m[0].length,
            // 인라인 빈칸은 공백 구간을 같은 길이로 덮어쓰므로 줄 폭이 유지된다
          },
        });
      }
    }

    // 괄호 안내문 뒤 — "(이름)" → "(이름) 박서연"
    if (isPromptCell) {
      for (const m of raw.matchAll(/\(([^()]*)\)/g)) {
        const inner = unescapeXml(m[1]);
        // "(가입      명)"처럼 괄호 안쪽 공백이 값 자리면 위 인라인 슬롯이 맡는다
        if (/\s{4,}\S/.test(inner)) continue;
        // "(우        )"의 안쪽 공백은 우편번호 자리다. 괄호 뒤에 오는 건 주소 본문이므로
        // 셀 라벨을 그대로 쓴다. 그 외("(이름)")는 안내문 자체가 필드 이름이다.
        const trailingBlank = /\s{4,}$/.test(inner);
        const prompt = clean(inner);
        // 괄호 안에 있다고 다 입력 자리는 아니다. "(단위 : 천원)", "( * 필수항목)",
        // "(20◌◌. 12. 31현재)"는 표에 붙은 주석이고, 여기에 값을 쓰면 양식이 망가진다.
        // 값을 받는 안내문은 짧은 한글 필드명이다 — 이름·직급·전화번호·우(편번호).
        // 놓친 칸은 빈칸으로 남지만 잘못 만든 칸은 문서를 더럽히므로 좁게 잡는다.
        if (!/^[가-힣][가-힣\s]{0,7}$/.test(prompt)) continue;
        const at = t.innerStart + m.index! + m[0].length;
        slots.push({
          id: `${idBase}.a${appendIdx++}`,
          kind: "append",
          label: trailingBlank ? attrib.label : clean(`${attrib.label} · ${prompt}`),
          labelPath: trailingBlank ? attrib.path : [...attrib.path, prompt],
          confidence: attrib.confidence,
          capacity: {
            chars: Math.max(1, cap.chars - cell.text.length),
            lines: cap.lines,
          },
          anchor: {
            file,
            start: at,
            end: at,
            mode: "append",
            prefix: " ",
            paraLineSeg: lineSegOf(t),
          },
        });
      }
    }

  }

  if (choiceOptions.length) {
    slots.push({
      id: `${idBase}.ch`,
      kind: "choice",
      label: attrib.label,
      labelPath: attrib.path,
      confidence: attrib.confidence,
      choices: choiceOptions.map((o) => o.label),
      capacity: { chars: 1, lines: 1 },
      options: choiceOptions,
    });
  }

  return { slots, unsupported };
}

function hasBlankMarkers(text: string): boolean {
  return /【\s+】|□|\s{4,}/.test(text);
}

/**
 * 이 칸이 스스로 입력 표식을 들고 있는가.
 *
 * 라벨 칸 바로 아래라도 이 신호가 있으면 독립 입력칸으로 살린다.
 * 맨공백(`\s{4,}`)은 일부러 뺐다 — 「주    식」「합    계」처럼 자간을 벌린 행 머리글과
 * 구분이 안 되기 때문이다. 실측에서 그 여섯 칸이 입력칸으로 잘못 잡혔다.
 */
function hasOwnMarkers(text: string): boolean {
  if (/【\s+】|□/.test(text)) return true;
  // "(가입      명)" — 괄호 안에 값 자리가 있다
  if (/\([^()]*\s{4,}[^()]*\)/.test(text)) return true;
  // "(이름)" — 괄호 안내문만으로 이루어진 칸
  return text.trim() !== "" && text.replace(/\([^()]*\)/g, "").trim() === "";
}

/**
 * 노드가 속한 문단의 <hp:linesegarray> 구간을 찾는다.
 *
 * 이 캐시가 남아 있으면 텍스트를 길게 바꿨을 때 한글이 옛 줄 폭을 신뢰해
 * 글자를 겹쳐 그린다. 값을 넣는 문단은 이 구간을 지워야 한다.
 */
function lineSegOf(node: XmlNode): { start: number; end: number } | undefined {
  let p: XmlNode | null = node;
  while (p && p.name !== "hp:p") p = p.parent;
  if (!p) return undefined;
  const seg = p.children.find((c) => c.name === "hp:linesegarray");
  return seg ? { start: seg.start, end: seg.end } : undefined;
}

/** 셀 안에서 텍스트를 넣을 수 있는 빈 run을 찾는다. */
function findEmptyRun(tc: XmlNode): XmlNode | null {
  const runs = findAllExcluding(tc, "hp:run", "hp:tbl");
  for (const r of runs) {
    if (r.selfClosing || r.innerEnd === r.innerStart) return r;
  }
  return null;
}

/** 단위 표기("명", "천원")를 옆 칸이나 표 제목에서 주워온다. */
function unitOf(cell: Cell, grid: Grid): string | undefined {
  const right = grid.at.get(`${cell.row},${cell.col + cell.colSpan}`);
  const t = right?.text?.trim();
  if (t && t.length <= 4 && /^[가-힣%]+$/.test(t)) return t;
  return undefined;
}

// ---------------------------------------------------------------- 수용량 추정

/**
 * 셀 크기와 글꼴 크기로 들어갈 수 있는 글자 수를 추정한다.
 * 칸 넘침으로 표 레이아웃이 밀리는 것이 공문서 자동화의 가장 흔한 실패다.
 * (한글은 정사각형에 가까우므로 글자 폭 ≈ 글꼴 높이로 잡는다. 근사치다.)
 */
function capacityOf(cell: Cell, charHeights: Record<string, number>): {
  chars: number;
  lines: number;
} {
  // 셀이 실제로 쓰는 글꼴 크기를 본다. 첫 run의 charPrIDRef가 그 셀의 서식이다.
  const run = findAllExcluding(cell.node, "hp:run", "hp:tbl")[0];
  const ref = run?.attrs.charPrIDRef ?? "0";
  const size = charHeights[ref] ?? charHeights["0"] ?? 1000; // 1000 HWPUNIT = 10pt

  const usable = Math.max(0, cell.width - cell.marginX);
  const perLine = Math.max(1, Math.floor(usable / size));

  // 줄 높이는 글꼴 크기에 줄간격을 더한 값. hwpx 기본 줄간격은 대략 1.6배다.
  const lineHeight = size * 1.6;
  const lines = Math.max(1, Math.floor(cell.height / lineHeight));

  return { chars: perLine * lines, lines };
}

/**
 * borderFill id → 윗 테두리 종류(SOLID/NONE/…).
 * 「이 칸이 위 칸과 붙어 보이는가」를 추측이 아니라 문서가 적어 둔 사실로 판정한다.
 */
function readTopBorders(c: Container): Record<string, string> {
  const buf = c.files["Contents/header.xml"];
  if (!buf) return {};
  const xml = new TextDecoder("utf-8").decode(buf);
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<hh:borderFill id="(\d+)"[\s\S]*?<\/hh:borderFill>/g)) {
    const t = m[0].match(/<hh:topBorder[^>]*type="(\w+)"/);
    if (t) out[m[1]] = t[1];
  }
  return out;
}

function readCharHeights(c: Container): Record<string, number> {
  const buf = c.files["Contents/header.xml"];
  if (!buf) return {};
  const xml = new TextDecoder("utf-8").decode(buf);
  const out: Record<string, number> = {};
  for (const m of xml.matchAll(/<hh:charPr\b[^>]*\bid="(\d+)"[^>]*\bheight="(\d+)"/g)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

// ---------------------------------------------------------------- 작성요령

/**
 * 「작성요령」 블록을 수집한다.
 * 공문서 양식은 각 칸을 어떻게 채우라고 문서 안에 적어두는 경우가 많다.
 * 이건 우리가 지어낸 규칙이 아니라 발급기관이 직접 쓴 지시문이라, 매핑 근거가 된다.
 */
function collectFormNotes(xml: string, roots: XmlNode[]): string[] {
  const paras = findAll(roots, "hp:p");
  const notes: string[] = [];
  let capturing = false;

  for (const p of paras) {
    const t = textOf(xml, p, "hp:tbl").trim();
    if (!t) continue;
    if (NOTE_HEADING.test(t)) {
      capturing = true;
      notes.push(t);
      continue;
    }
    if (capturing) {
      if (t.length > 200) {
        capturing = false;
        continue;
      }
      notes.push(t);
    }
  }
  return notes;
}

/** 「작성요령」의 "○ 임원정수 : 정관상 임원의 정수 기재" 같은 줄을 라벨로 매칭한다. */
function attachHints(slots: InternalSlot[], notes: string[]): void {
  const dict = new Map<string, string>();
  for (const line of notes) {
    const m = line.match(/^[\s※*·○□▪①-⑮\-]*([^:：]{2,30})[:：]\s*(.+)$/);
    if (m) dict.set(m[1].replace(/\s+/g, ""), m[2].trim());
  }
  if (!dict.size) return;

  for (const s of slots) {
    if (s.hint) continue;
    const key = s.label.replace(/\s+/g, "");
    const hit = dict.get(key);
    if (hit) s.hint = hit;
  }
}

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export type { SlotKind };
