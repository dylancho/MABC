/**
 * 확정된 값으로 hwpx를 생성한다.
 *
 * 여기에는 LLM이 없다. 순수 함수만 돈다.
 * 검증에 실패하면 파일을 만들지 않고 사유를 돌려준다 (설계 문서 §8 항목 5).
 */
import { NextResponse } from "next/server";
import { readContainer } from "@/lib/hwpx/container";
import { dissect } from "@/lib/hwpx/dissect";
import { fill } from "@/lib/hwpx/fill";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const formFile = form.get("form");
    const valuesRaw = String(form.get("values") ?? "{}");

    if (!(formFile instanceof File)) {
      return NextResponse.json({ error: "양식 파일(A)을 올려주세요." }, { status: 400 });
    }

    const values = JSON.parse(valuesRaw) as Record<string, string>;
    const buf = new Uint8Array(await formFile.arrayBuffer());

    // 해부는 결정론적이므로 /api/analyze 때와 같은 슬롯 id가 나온다
    const container = readContainer(buf);
    const { slots } = dissect(container);

    const res = fill(buf, slots, { values });

    if (!res.report.ok) {
      return NextResponse.json(
        {
          error: "무손상 검증에 실패해 파일을 만들지 않았습니다.",
          problems: res.report.problems,
          report: res.report,
        },
        { status: 422 },
      );
    }

    const name = formFile.name.replace(/\.hwpx$/i, "");
    return new NextResponse(new Uint8Array(res.file), {
      headers: {
        "Content-Type": "application/hwp+zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}_작성완료.hwpx`)}`,
        "X-Fill-Report": encodeURIComponent(
          JSON.stringify({
            report: res.report,
            unfilled: res.unfilled,
            overflow: res.overflow,
          }),
        ),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
