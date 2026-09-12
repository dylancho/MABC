/**
 * A(양식)를 해부하고, B(자료)를 Solar로 매핑해 제안값을 돌려준다.
 *
 * 서버에 파일을 저장하지 않는다. 해부는 결정론적이라 같은 A를 다시 올리면 슬롯 id가
 * 그대로 나오므로, 생성 단계(/api/fill)에서 A를 한 번 더 받아도 id가 맞는다.
 */
import { NextResponse } from "next/server";
import { readContainer } from "@/lib/hwpx/container";
import { dissect } from "@/lib/hwpx/dissect";
import { extract } from "@/lib/extract";
import { mapContentToSlots } from "@/lib/ai/map";
import { assertSolarConfigured, solarModelName } from "@/lib/ai/solar";
import { computeSubtotals } from "@/lib/sum";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const formFile = form.get("form");
    const sourceFile = form.get("source");
    const sourceText = String(form.get("sourceText") ?? "");

    if (!(formFile instanceof File)) {
      return NextResponse.json({ error: "양식 파일(A)을 올려주세요." }, { status: 400 });
    }

    // ---- A 해부 (LLM 없음, 결정론적)
    const formBuf = new Uint8Array(await formFile.arrayBuffer());
    const container = readContainer(formBuf);
    const t0 = Date.now();
    const { result } = dissect(container);
    const dissectMs = Date.now() - t0;

    // ---- B 추출
    let source = sourceText.trim();
    let sourceKind = source ? "붙여넣은 텍스트" : "";
    if (sourceFile instanceof File && sourceFile.size > 0) {
      const buf = new Uint8Array(await sourceFile.arrayBuffer());
      const ex = extract(buf, sourceFile.name);
      source = source ? `${source}\n\n${ex.text}` : ex.text;
      sourceKind = sourceKind ? `${sourceKind} + ${sourceFile.name}` : sourceFile.name;
    }

    if (!source) {
      // 자료 없이 해부 결과만 보고 싶은 경우도 있다
      return NextResponse.json({
        slots: result.slots,
        unsupported: result.unsupported,
        formNotes: result.formNotes,
        stats: result.stats,
        dissectMs,
        fills: [],
        questions: [],
        skipped: 0,
        sourceKind: "(자료 없음 — 해부 결과만)",
        model: solarModelName(),
      });
    }

    // ---- 매핑 (여기에만 LLM)
    assertSolarConfigured();
    const t1 = Date.now();
    const mapped = await mapContentToSlots(result.slots, source);
    const mapMs = Date.now() - t1;

    // 소계·합계는 모델이 아니라 코드가 더한다. 매핑 결과에 계산 항목으로 덧붙인다.
    const values: Record<string, string> = {};
    for (const f of mapped.fills) if (f.value) values[f.id] = f.value;
    const computed = computeSubtotals(result.slots, values);
    const fills = [
      ...mapped.fills.filter((f) => !computed.some((c) => c.id === f.id)),
      ...computed.map((c) => ({
        id: c.id,
        value: c.value,
        evidence: `코드 계산: ${c.from.length}개 칸의 합`,
        note: "소계·합계는 모델이 아니라 코드가 더했습니다",
      })),
    ];

    return NextResponse.json({
      slots: result.slots,
      unsupported: result.unsupported,
      formNotes: result.formNotes,
      stats: result.stats,
      dissectMs,
      mapMs,
      fills,
      computed: computed.length,
      questions: mapped.questions,
      skipped: mapped.skipped,
      sourceKind,
      sourceChars: source.length,
      model: solarModelName(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
