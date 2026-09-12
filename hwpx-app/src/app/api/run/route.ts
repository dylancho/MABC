/**
 * 한 번에 끝낸다 — A(양식) + B(자료)를 받아 채워진 hwpx 파일 하나만 돌려준다.
 *
 * /api/analyze + /api/fill 을 서버에서 이어 붙인 것이다. 두 단계로 나눈 쪽은
 * 사용자가 값을 확인·수정하는 흐름을 위한 것이고, 이쪽은 확인 없이 바로 받는 흐름이다.
 * (에이전트 연동은 계속 두 단계 API를 쓴다.)
 *
 * 검증에 실패하면 파일을 만들지 않고 사유만 JSON으로 돌려준다 — 깨진 hwpx는 내보내지 않는다.
 */
import { NextResponse } from "next/server";
import { readContainer } from "@/lib/hwpx/container";
import { dissect } from "@/lib/hwpx/dissect";
import { extract } from "@/lib/extract";
import { mapContentToSlots } from "@/lib/ai/map";
import { assertSolarConfigured } from "@/lib/ai/solar";
import { fill } from "@/lib/hwpx/fill";
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

    let source = sourceText.trim();
    if (sourceFile instanceof File && sourceFile.size > 0) {
      const buf = new Uint8Array(await sourceFile.arrayBuffer());
      const ex = extract(buf, sourceFile.name);
      source = source ? `${source}\n\n${ex.text}` : ex.text;
    }
    if (!source) {
      return NextResponse.json(
        { error: "채울 자료(B)를 올리거나 붙여넣어 주세요." },
        { status: 400 },
      );
    }

    assertSolarConfigured();

    const buf = new Uint8Array(await formFile.arrayBuffer());
    const { result, slots } = dissect(readContainer(buf));

    const mapped = await mapContentToSlots(result.slots, source);
    const values: Record<string, string> = {};
    for (const f of mapped.fills) if (f.value) values[f.id] = f.value;
    // 소계·합계는 모델이 아니라 코드가 더한다
    const computed = computeSubtotals(result.slots, values);
    for (const c of computed) values[c.id] = c.value;

    const res = fill(buf, slots, { values });
    if (!res.report.ok) {
      return NextResponse.json(
        {
          error: "무손상 검증에 실패해 파일을 만들지 않았습니다.",
          problems: res.report.problems,
        },
        { status: 422 },
      );
    }

    const name = formFile.name.replace(/\.hwpx$/i, "");
    return new NextResponse(new Uint8Array(res.file), {
      headers: {
        "Content-Type": "application/hwp+zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}_작성완료.hwpx`)}`,
        // 화면에 한 줄로 띄울 요약. 본문은 파일 하나뿐이다.
        "X-Run-Summary": encodeURIComponent(
          JSON.stringify({
            slots: result.slots.length,
            filled: Object.keys(values).length,
            computed: computed.length,
            unfilled: res.unfilled.length,
            overflow: res.overflow.length,
            questions: mapped.questions.length,
            errors: mapped.errors,
            changedRatio: res.report.changedRatio,
          }),
        ),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
