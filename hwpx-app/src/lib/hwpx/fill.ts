/**
 * 주입 + 검증 오케스트레이션.
 *
 * 관통 원칙: 확신이 없으면 파일을 내보내지 않는다.
 * 검증에 실패하면 결과를 버리고 실패 사유를 돌려준다. 깨진 hwpx는 절대 내보내지 않는다.
 */
import { readContainer, writeContainer, sectionNames, type Container } from "./container";
import { applyEdits, buildEdit, changesStayInBounds, type Edit } from "./inject";
import type { Anchor, FillResult, InternalSlot, VerifyReport } from "./types";
import { totalWidth } from "./width";

export interface FillOptions {
  /** slot.id → 넣을 값 */
  values: Record<string, string>;
  /**
   * 값을 넣은 문단의 <hp:linesegarray>(줄 렌더링 캐시)를 지울지.
   *
   * 지우지 않으면 한글이 옛 줄 폭을 신뢰해 자간을 밀어붙이고, 표는 멀쩡한데
   * 글자끼리 겹쳐 보인다. 기본값은 지우는 쪽이다.
   * (비교 검증용으로만 false를 쓴다.)
   */
  dropLineSegs?: boolean;
}

export function fill(
  original: Uint8Array,
  slots: InternalSlot[],
  opts: FillOptions,
): FillResult {
  const src = readContainer(original);
  const dec = new TextDecoder("utf-8");
  const enc = new TextEncoder();

  const dropLineSegs = opts.dropLineSegs !== false;
  const byId = new Map(slots.map((s) => [s.id, s]));
  const editsByFile = new Map<string, Edit[]>();
  // 값을 넣은 문단들의 linesegarray 구간. 한 문단에 슬롯이 여럿이면 중복되므로 모아서 접는다.
  const staleSegs = new Map<string, Map<number, { start: number; end: number }>>();

  const markStale = (a: Anchor) => {
    if (!dropLineSegs || !a.paraLineSeg) return;
    let m = staleSegs.get(a.file);
    if (!m) staleSegs.set(a.file, (m = new Map()));
    m.set(a.paraLineSeg.start, a.paraLineSeg);
  };
  const unfilled: FillResult["unfilled"] = [];
  const overflow: FillResult["overflow"] = [];

  for (const slot of slots) {
    const raw = opts.values[slot.id];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (!value) {
      // 값이 없으면 비워둔다. 추측해서 채우지 않는다.
      if (slot.kind !== "readonly_note") {
        unfilled.push({ id: slot.id, label: slot.label });
      }
      continue;
    }

    if (slot.kind === "choice" && slot.options) {
      const picked = slot.options.find((o) => o.label === value);
      if (!picked) {
        unfilled.push({ id: slot.id, label: `${slot.label} (선택지에 없는 값: "${value}")` });
        continue;
      }
      for (const opt of slot.options) {
        const mark = (opt.anchor.width ?? 1) === 1 ? "■" : "V";
        push(
          editsByFile,
          opt.anchor.file,
          buildEdit(opt.anchor, opt === picked ? mark : ""),
        );
        markStale(opt.anchor);
      }
      continue;
    }

    if (!slot.anchor) continue;

    // 글자 수가 아니라 폭으로 잰다. 영문·숫자는 한글의 절반 폭이다.
    const width = totalWidth(value);
    if (width > slot.capacity.chars) {
      // 자르지 않는다. 알리기만 하고 넣는다 — 자를지 줄일지는 사람이 정한다.
      overflow.push({
        id: slot.id,
        label: slot.label,
        chars: Math.ceil(width),
        capacity: slot.capacity.chars,
      });
    }

    push(editsByFile, slot.anchor.file, buildEdit(slot.anchor, value));
    markStale(slot.anchor);
  }

  void byId;

  // ------- 적용
  const files: Record<string, Uint8Array> = { ...src.files };
  const report: VerifyReport = {
    ok: true,
    filledSlots: 0,
    sections: [],
    inBounds: true,
    headerUntouched: true,
    otherChanged: [],
    mimetypeFirstStored: true,
    lineSegsDropped: 0,
    totalBytes: 0,
    changedRatio: 0,
    problems: [],
  };

  let replacedFromTotal = 0;
  let replacedToTotal = 0;
  let originalTotal = 0;

  for (const file of sectionNames(src)) {
    const before = dec.decode(src.files[file]);
    originalTotal += before.length;
    const edits = editsByFile.get(file) ?? [];
    if (!edits.length) continue;
    const valueEdits = edits.length; // 캐시 제거분을 섞기 전의 실제 값 주입 수

    // 값을 넣은 문단의 줄 렌더링 캐시를 지운다 → 한글이 열 때 다시 계산한다.
    // linesegarray는 run들 뒤에 오는 형제 노드라 값 앵커와 구간이 겹치지 않는다.
    for (const seg of staleSegs.get(file)?.values() ?? []) {
      edits.push({
        anchor: { file, start: seg.start, end: seg.end, mode: "text_node" },
        replacement: "",
      });
    }

    let after: string;
    try {
      after = applyEdits(before, edits);
    } catch (e) {
      report.problems.push(`${file}: ${(e as Error).message}`);
      report.ok = false;
      continue;
    }

    if (!changesStayInBounds(before, after, edits)) {
      report.inBounds = false;
      report.ok = false;
      report.problems.push(`${file}: 등록된 슬롯 바깥에서 변경이 발생했습니다`);
      continue;
    }

    const from = edits.reduce((n, e) => n + (e.anchor.end - e.anchor.start), 0);
    const to = edits.reduce((n, e) => n + e.replacement.length, 0);
    replacedFromTotal += from;
    replacedToTotal += to;

    report.filledSlots += valueEdits;
    report.lineSegsDropped += edits.length - valueEdits;
    report.sections.push({
      file,
      beforeBytes: enc.encode(before).length,
      afterBytes: enc.encode(after).length,
      replacedFrom: from,
      replacedTo: to,
    });
    files[file] = enc.encode(after);
  }

  // ------- 검증
  const headerKey = "Contents/header.xml";
  if (src.files[headerKey]) {
    report.headerUntouched = files[headerKey] === src.files[headerKey];
    if (!report.headerUntouched) {
      report.ok = false;
      report.problems.push("header.xml이 변경되었습니다 — 서식 정의는 절대 건드리면 안 됩니다");
    }
  }

  const sections = new Set(sectionNames(src));
  for (const name of Object.keys(src.files)) {
    if (sections.has(name)) continue;
    if (files[name] !== src.files[name]) report.otherChanged.push(name);
  }
  if (report.otherChanged.length) {
    report.ok = false;
    report.problems.push(`section 외 엔트리가 변경되었습니다: ${report.otherChanged.join(", ")}`);
  }

  report.totalBytes = originalTotal;
  report.changedRatio = originalTotal ? replacedToTotal / originalTotal : 0;
  void replacedFromTotal;

  if (!report.ok) {
    // 검증 실패 → 원본을 그대로 돌려준다. 깨진 파일은 내보내지 않는다.
    return { file: original, report, unfilled, overflow };
  }

  const out: Container = { entries: src.entries, files };
  const packed = writeContainer(out);

  // 재포장 결과가 다시 읽히는지, mimetype 규약이 지켜졌는지 확인
  try {
    const back = readContainer(packed);
    report.mimetypeFirstStored =
      back.entries[0]?.name === "mimetype" && back.entries[0]?.method === 0;
    if (!report.mimetypeFirstStored) {
      report.ok = false;
      report.problems.push("mimetype이 첫 엔트리·무압축이 아닙니다 — 한글이 열지 못합니다");
      return { file: original, report, unfilled, overflow };
    }
  } catch (e) {
    report.ok = false;
    report.problems.push(`재포장 결과를 다시 읽지 못했습니다: ${(e as Error).message}`);
    return { file: original, report, unfilled, overflow };
  }

  return { file: packed, report, unfilled, overflow };
}

function push(map: Map<string, Edit[]>, file: string, edit: Edit): void {
  const arr = map.get(file);
  if (arr) arr.push(edit);
  else map.set(file, [edit]);
}

/** 항등 검사: 값 없이 왕복했을 때 모든 엔트리가 바이트 단위로 같은가. */
export function identityCheck(original: Uint8Array): {
  ok: boolean;
  sameContent: boolean;
  sameOrder: boolean;
  mimetypeOk: boolean;
} {
  const a = readContainer(original);
  const packed = writeContainer(a);
  const b = readContainer(packed);

  const sameContent = Object.keys(a.files).every((k) => {
    const x = a.files[k];
    const y = b.files[k];
    if (!y || x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  });
  const sameOrder =
    a.entries.length === b.entries.length &&
    a.entries.every((e, i) => e.name === b.entries[i].name);
  const mimetypeOk = b.entries[0]?.name === "mimetype" && b.entries[0]?.method === 0;

  return { ok: sameContent && sameOrder && mimetypeOk, sameContent, sameOrder, mimetypeOk };
}
