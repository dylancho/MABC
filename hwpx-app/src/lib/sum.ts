/**
 * 소계·합계·총계를 코드가 더한다.
 *
 * 모델에게 맡기면 틀린 합을 두 개 내놓고 되묻는다(실측: 339,700 vs 347,500). 더하기는
 * 판단이 아니라 산수이므로 여기서 결정론적으로 한다. 규칙은 표 구조에서 나온다:
 *
 *   소계        = 같은 열에서 직전 소계·합계·총계 이후에 채워진 값들의 합
 *   합계·계     = 같은 열에서 직전 합계·총계 이후에 채워진 값들의 합
 *   총계        = 같은 열 전체
 *
 * 소계는 더하지 않고 그 밑의 값(leaf)만 더한다 — 소계는 이미 그 값들의 합이라 둘 다 더하면
 * 이중 계산이다. 더할 값이 하나도 없으면 비워 둔다. 지어내지 않는다.
 */
import type { Slot } from "./hwpx/types";

type Level = 0 | 1 | 2 | 3; // 0 leaf, 1 소계, 2 합계/계, 3 총계

export function sumLevel(label: string): Level {
  const l = label.replace(/[\s【】]/g, "");
  if (/총계$/.test(l)) return 3;
  if (/소계$/.test(l)) return 1;
  if (/합계$/.test(l) || /^계$/.test(l)) return 2;
  return 0;
}

/** "1,850,000천원" → 1850000. 숫자 하나가 아니면 null. */
export function parseAmount(v: string): number | null {
  // 명·주·㎡ 같은 개수 단위가 붙은 값은 금액이 아니다
  const m = v.trim().match(/^(△|-)?\s*(\d[\d,]*)(?:\.\d+)?\s*(천원|만원|원)?$/);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return m[1] ? -n : n;
}

/**
 * 이 칸이 속한 번호 그룹(①~⑳). 수입|지출이 한 행을 나눠 쓰는 표에서는 경로에 양쪽 그룹이
 * 다 들어오는데, 자기 쪽 그룹은 항상 경로의 **마지막** 번호 항목이다.
 * 번호가 없으면 ""(그룹 없음) — 이때는 "직전 소계 이후" 규칙으로 돌아간다.
 */
export function groupOf(slot: Slot): string {
  const heads = slot.labelPath.filter((p) => /^[①-⑳]|^\(?\d{1,2}[.)]/.test(p.trim()));
  return heads.length ? heads[heads.length - 1] : "";
}

/** 수량·면적·인원 열은 더하지 않는다 — 5,000주 + 1대 = 5,001 같은 무의미한 합이 나온다. */
export function isCountColumn(slot: Slot): boolean {
  return slot.labelPath.some((p) => /수\s*량|면\s*적|인\s*원|수혜|참여/.test(p));
}

export function formatAmount(n: number): string {
  const s = Math.abs(n).toLocaleString("en-US");
  return n < 0 ? `△${s}` : s;
}

export interface Computed {
  id: string;
  label: string;
  value: string;
  /** 더한 칸의 id — 사용자가 검산할 수 있게 */
  from: string[];
}

/**
 * values(슬롯 id → 값)를 보고 소계·합계 슬롯의 값을 계산해 돌려준다.
 * 이미 값이 있는 소계 슬롯은 건드리지 않는다.
 */
export function computeSubtotals(slots: Slot[], values: Record<string, string>): Computed[] {
  // 표·열 단위로 묶고 행 순서로 정렬한다. id 형태: s0.t3.r12c4[.x]
  const cols = new Map<string, { slot: Slot; row: number }[]>();
  for (const s of slots) {
    if (s.kind !== "text") continue;
    const m = s.id.match(/^(s\d+\.t\d+)\.r(\d+)c(\d+)$/);
    if (!m) continue;
    const key = `${m[1]}.c${m[3]}`;
    cols.set(key, [...(cols.get(key) ?? []), { slot: s, row: Number(m[2]) }]);
  }

  const out: Computed[] = [];
  for (const list of cols.values()) {
    list.sort((a, b) => a.row - b.row);
    if (list.some(({ slot }) => isCountColumn(slot))) continue;
    // 합계·총계용 누적, 그리고 소계용은 그룹별로 따로 쌓는다
    const total = { sum: 0, from: [] as string[] }; // 합계(직전 합계·총계 이후)
    const grand = { sum: 0, from: [] as string[] }; // 총계(열 전체)
    const groups = new Map<string, { sum: number; from: string[] }>(); // 소계용, 그룹별
    for (const { slot } of list) {
      const level = sumLevel(slot.label);
      if (level === 0) {
        const n = parseAmount(values[slot.id] ?? "");
        if (n === null) continue;
        const g = groupOf(slot);
        const acc = groups.get(g) ?? { sum: 0, from: [] };
        acc.sum += n;
        acc.from.push(slot.id);
        groups.set(g, acc);
        total.sum += n;
        total.from.push(slot.id);
        grand.sum += n;
        grand.from.push(slot.id);
        continue;
      }
      // 소계 칸의 그룹: 경로에서 「소 계」 앞의 마지막 번호 항목. 없으면 ""(번호 없는 표).
      const g = level === 1 ? groupOf(slot) : "";
      const src = level === 1 ? (groups.get(g) ?? { sum: 0, from: [] }) : level === 2 ? total : grand;
      if (!values[slot.id] && src.from.length) {
        out.push({ id: slot.id, label: slot.label, value: formatAmount(src.sum), from: [...src.from] });
      }
      // 소계는 자기 그룹만 비운다. 번호 없는 표에서는 "" 그룹이 곧 직전 소계 이후 전부다.
      if (level === 1) groups.delete(g);
      if (level >= 2) {
        groups.clear();
        total.sum = 0;
        total.from = [];
      }
    }
  }
  return out;
}
