import { readFileSync } from "node:fs";
import { readContainer } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";
const { result } = dissect(readContainer(new Uint8Array(readFileSync(process.argv[2]))));
const s = result.slots;

// 자간 벌리기로 보이는 인라인 슬롯: 라벨 조각이 1글자
const spacing = s.filter((x) => x.kind === "inline" && /· .$/.test(x.label));
console.log(`자간 오인 의심 inline 슬롯 ${spacing.length}개`);
spacing.slice(0, 10).forEach((x) => console.log(`   ${x.id}  "${x.label}"  cap=${x.capacity.chars}`));

const ex = s.filter((x) => x.kind === "example_row");
console.log(`\nexample_row ${ex.length}개`);
ex.slice(0, 6).forEach((x) => console.log(`   ${x.id}  "${x.label}"  hint=${(x.hint ?? "").slice(0, 50)}`));

const tiny = s.filter((x) => x.capacity.chars <= 6);
console.log(`\ncapacity 6자 이하 슬롯 ${tiny.length}개 (전체 ${s.length})`);
tiny.slice(0, 8).forEach((x) => console.log(`   ${x.id}  "${x.label}"  cap=${x.capacity.chars}`));

const caps = s.map((x) => x.capacity.chars).sort((a, b) => a - b);
console.log(`\ncapacity 분포  최소 ${caps[0]}  중앙값 ${caps[caps.length >> 1]}  최대 ${caps[caps.length - 1]}`);
