/**
 * 자료(B) 추출기.
 *
 * B는 슬롯 구조를 갖지 않으므로 hwpx-core의 해부 파이프라인을 타지 않는다.
 * 본문 텍스트만 뽑아 매핑 계층에 넘긴다.
 *
 * MVP는 hwpx와 평문만 지원한다. 엑셀·워드·PDF는 v2 — 그때도 이 파일만 늘리면 되도록
 * 어댑터로 분리해 둔다.
 */
import { readContainer, sectionNames } from "./hwpx/container";
import { findAll, parseXml, textOf } from "./hwpx/xml";

export interface Extracted {
  text: string;
  kind: "hwpx" | "text";
  chars: number;
}

/** hwpx 본문을 문단 단위 평문으로 편다. 표는 셀을 ` | `로 잇는다. */
export function extractFromHwpx(buf: Uint8Array): string {
  const c = readContainer(buf);
  const dec = new TextDecoder("utf-8");
  const lines: string[] = [];

  for (const file of sectionNames(c)) {
    const xml = dec.decode(c.files[file]);
    const roots = parseXml(xml);

    // 표는 행 단위로, 그 외 문단은 한 줄씩
    for (const tbl of findAll(roots, "hp:tbl")) {
      for (const tr of tbl.children.filter((n) => n.name === "hp:tr")) {
        const cells = tr.children
          .filter((n) => n.name === "hp:tc")
          .map((tc) => textOf(xml, tc, "hp:tbl").replace(/\s+/g, " ").trim());
        const row = cells.filter(Boolean).join(" | ");
        if (row) lines.push(row);
      }
    }

    for (const p of findAll(roots, "hp:p")) {
      // 표 안의 문단은 위에서 이미 처리했다
      let inTable = false;
      for (let n = p.parent; n; n = n.parent) {
        if (n.name === "hp:tbl") {
          inTable = true;
          break;
        }
      }
      if (inTable) continue;
      const t = textOf(xml, p, "hp:tbl").replace(/\s+/g, " ").trim();
      if (t) lines.push(t);
    }
  }

  return lines.join("\n");
}

export function extract(buf: Uint8Array, filename: string): Extracted {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".hwpx")) {
    const text = extractFromHwpx(buf);
    return { text, kind: "hwpx", chars: text.length };
  }

  if (lower.endsWith(".hwp")) {
    throw new Error(
      "구버전 한글 문서(.hwp)는 아직 지원하지 않습니다. " +
        "한글에서 [다른 이름으로 저장] → 'HWPX 문서'로 저장한 뒤 올려주세요.",
    );
  }

  if (/\.(txt|md|csv|json)$/.test(lower)) {
    const text = new TextDecoder("utf-8").decode(buf);
    return { text, kind: "text", chars: text.length };
  }

  throw new Error(
    `아직 지원하지 않는 형식입니다: ${filename}\n` +
      "지금은 hwpx 문서와 평문(txt·md·csv)만 읽을 수 있습니다. " +
      "내용을 직접 붙여넣어도 됩니다.",
  );
}
