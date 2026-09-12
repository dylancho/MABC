# 재현성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 양식과 같은 자료로 두 번 실행하면 결과 hwpx의 SHA-256이 일치하게 만들고, 그 일치를 API 호출 없이 검증한다.

**Architecture:** 파이프라인에서 순수하지 않은 두 지점만 봉인한다. ZIP 압축 시각은 원본 중앙 디렉터리의 DOS 날짜를 되살려 결정적으로 만든다. 모델 호출은 프롬프트 해시를 키로 응답을 기록·재생하는 계층을 한 단계 끼워 봉인한다. 나머지 계층은 이미 순수 함수임이 확인됐으므로 손대지 않는다.

**Tech Stack:** TypeScript, Next.js 16 App Router, `ai` SDK 6, `zod` 4, `fflate` 0.8, `tsx` 실행, `node:crypto`

**Spec:** [docs/superpowers/specs/2026-09-12-reproducibility-design.md](../specs/2026-09-12-reproducibility-design.md)

## Global Constraints

- 작업 디렉터리는 `C:\MABC_본선\hwpx-app` 이다. 모든 상대 경로는 여기가 기준이다.
- 테스트는 새 프레임워크를 도입하지 않는다. 기존 관례를 따른다. `scripts/*.ts` 로 두고 `npx tsx scripts/<name>.ts` 로 실행하며, `t(이름, got, want)` 헬퍼로 PASS/FAIL 을 찍고 마지막에 `process.exit(f ? 1 : 0)` 한다. 참고할 기존 파일은 `scripts/test-sum.ts` 다.
- **최상위 `await` 를 쓸 수 없다.** `package.json` 에 `"type": "module"` 이 없어 tsx 가 CJS 로 변환하며, esbuild 가 `Top-level await is currently not supported with the "cjs" output format` 으로 거부한다. 실측으로 확인했다. 비동기 스크립트는 기존 관례를 따라 `async function main() { ... }` 로 감싸고 마지막에 `main().catch((e) => { console.error(e); process.exit(1); });` 를 둔다. 참고할 기존 파일은 `scripts/map-check.ts:27` 과 `:103` 이다.
- 테스트 픽스처는 저장소에 커밋된 것만 쓴다. 양식은 `../D1-test/core-(서식1) 비영리법인 현황 제출 양식.hwpx`, 자료는 `scripts/fixtures/법인자료.txt` 다. `C:\Users\dylan\Downloads` 를 참조하는 새 코드를 쓰지 않는다.
- 환경변수를 읽어야 하는 스크립트는 다른 import 보다 먼저 `import { config } from "dotenv"; config({ path: ".env.local" });` 를 둔다. `src/lib/ai/solar.ts` 주석이 설명하는 실제 버그 때문이다.
- `mimetype` 엔트리는 반드시 첫 번째이며 무압축이어야 한다. 이 규약을 깨는 변경은 금지한다.
- 고정 샘플링 값은 `temperature: 0`, `seed: 20260919` 이다. 이 두 값은 캐시 키에 들어가므로 바꾸면 기존 스냅샷이 전부 무효가 된다.
- 기본 `REPRO_MODE` 는 `prefer` 다. 값은 `strict`, `prefer`, `off` 셋뿐이다.
- 커밋 메시지는 한 줄 요약 + 필요시 본문이며, 아래 두 줄로 끝낸다.
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01B7VmrrDgRHjWT9SCqZB3BW
  ```

## 작업 순서와 일정

사양서 §9의 일정에 대응한다. Task 1~2 가 9/12 항목이고, 이것만으로 내용 일치율이 크게 오른다. Task 3~7 이 9/13 항목이다. Task 8 은 남는 시간에 한다. Task 3~7 이 밀리면 Task 1~2 결과로 발표한다.

---

## 배경 지식

구현 전에 알아야 하는 사실이다. 모두 코드로 확인된 것이다.

**ZIP 날짜는 DOS 형식 16비트 두 워드다.** 중앙 디렉터리 항목에서 시각은 오프셋 `+12`, 날짜는 `+14` 에 있다. 인코딩은 이렇다.

```
날짜 워드: (연도 - 1980) << 9 | 월 << 5 | 일        월은 1부터, 일은 1부터
시각 워드: 시 << 11 | 분 << 5 | (초 / 2)            초는 2초 해상도
```

**fflate 의 `mtime: 0` 은 쓸 수 없다.** `node_modules/fflate/lib/index.cjs:1889` 부근이 아래처럼 되어 있다. 1970년은 `y` 가 음수가 되어 예외를 던진다.

```js
var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
if (y < 0 || y > 119)
    err(10);
wbytes(d, b, (y << 25) | ((dt.getMonth() + 1) << 21) | (dt.getDate() << 16) | (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1)), b += 4;
```

**fflate 는 지역시각 접근자를 쓴다.** 위 코드가 `getFullYear`, `getMonth`, `getDate`, `getHours` 를 쓴다. 그래서 고정된 epoch 밀리초를 넘기면 시간대가 다른 기계에서 다른 바이트가 나온다. 한국 시간대인 개발 노트북과 UTC인 Vercel 이 갈린다.

**해법은 지역시각 생성자다.** DOS 워드를 `new Date(연, 월-1, 일, 시, 분, 초)` 로 되살리면, 생성과 읽기가 같은 지역시각을 쓰므로 상쇄된다. 어느 시간대의 어느 기계에서도 원래의 DOS 워드가 그대로 복원된다. 초는 DOS 가 2초 해상도이므로 `(초워드 & 0x1f) * 2` 로 짝수가 되고, fflate 가 `>> 1` 로 되돌려 정확히 왕복한다.

**현재 항등 검사는 전체 파일 바이트를 비교하지 않는다.** `src/lib/hwpx/fill.ts:226` 의 `identityCheck` 는 엔트리별 내용, 엔트리 순서, mimetype 규약만 본다. 그래서 압축 시각 문제가 지금까지 드러나지 않았다. 원본 파일과의 전체 바이트 일치는 애초에 불가능하다. 재압축 결과가 원본 압축기의 출력과 같을 이유가 없다. 우리가 얻으려는 것은 원본과의 일치가 아니라 **우리 출력끼리의 일치**다.

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `src/lib/hwpx/container.ts` | ZIP 해체·재포장. 엔트리 순서·압축 방식에 이어 **압축 시각**까지 보존한다. | 수정 |
| `src/lib/ai/solar.ts` | Solar 클라이언트. 모델명이 별칭인지 판별하는 책임을 더한다. | 수정 |
| `src/lib/ai/snapshot.ts` | 캐시 키 계산, 모드 판정, 재생 또는 실제 호출. ZIP·XML·슬롯을 모른다. | 신규 |
| `src/lib/ai/snapshots.generated.ts` | 키에서 응답으로 가는 맵. 기록 스크립트가 생성한다. 손으로 고치지 않는다. | 신규 (생성물) |
| `src/lib/ai/map.ts` | 슬롯 매핑. 모델을 직접 부르지 않고 `snapshot.ts` 를 거친다. | 수정 |
| `src/app/api/run/route.ts` | 한 번에 끝내는 경로. 응답 메타에 모드·재생 여부·출력 해시를 싣는다. | 수정 |
| `src/app/api/analyze/route.ts` | 두 단계 경로의 첫 단계. 같은 메타를 싣는다. | 수정 |
| `scripts/test-container-mtime.ts` | 압축 시각 보존과 재포장 결정성 검사. | 신규 |
| `scripts/test-snapshot.ts` | 키 계산과 모드별 동작 검사. | 신규 |
| `scripts/record.ts` | 로컬 전용 기록 명령. 스냅샷 모듈을 생성한다. | 신규 |
| `scripts/repro-check.ts` | 두 번 돌려 해시를 비교하고, 커밋된 기대 해시와도 맞추고, 다르면 갈린 칸을 출력한다. | 신규 |
| `scripts/fixtures/expected-hashes.json` | 양식·자료 조합별 기대 출력 해시. `--update` 가 갱신한다. | 신규 (생성물) |
| `package.json` | `test` 명령 추가. | 수정 |

`snapshot.ts` 와 `snapshots.generated.ts` 를 나눈 이유는 생성물과 손으로 쓴 코드를 섞지 않기 위해서다. 생성 파일은 기록할 때마다 통째로 덮어쓰므로, 사람이 쓴 로직이 거기 있으면 사라진다.

---

## Task 1: ZIP 압축 시각을 보존한다

**Files:**
- Modify: `src/lib/hwpx/container.ts` (`Entry` 인터페이스, `readDirectory`, `writeContainer`)
- Test: `scripts/test-container-mtime.ts` (신규)

**Interfaces:**
- Consumes: 없음. 첫 작업이다.
- Produces: `Entry` 에 `dosDate: number`, `dosTime: number` 두 필드가 추가된다. `writeContainer(c: Container): Uint8Array` 시그니처는 그대로다. `readContainer` 를 쓰는 모든 호출자는 변경 없이 동작한다.

이 작업이 사양서 §10 의 열린 문제 1을 닫는다. 결론은 **원본 시각 보존**이다. 고정 상수보다 나은 이유는 두 가지다. 출력 파일이 1980년으로 보이지 않고, 입력 파일이 고정이므로 재현성도 동시에 얻는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`scripts/test-container-mtime.ts` 를 만든다. 테스트는 `Entry` 의 새 필드를 참조하지 않는다. 중앙 디렉터리를 직접 읽어서 검사하므로, 구현 형태와 무관하게 성립한다.

```ts
/**
 * ZIP 압축 시각 보존 검사.
 *
 * 재포장한 파일의 DOS 날짜·시각이 원본과 같아야 한다. 다르면 같은 입력으로
 * 두 번 돌린 결과의 해시가 갈리고, 재현성을 해시로 증명할 수 없다.
 *
 * 실행: npx tsx scripts/test-container-mtime.ts
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { readContainer, writeContainer } from "../src/lib/hwpx/container";

const FORM = "../D1-test/core-(서식1) 비영리법인 현황 제출 양식.hwpx";

let f = 0;
const t = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  — got ${JSON.stringify(got)}`}`);
  if (!ok) f++;
};

/** 중앙 디렉터리에서 [이름, 날짜워드, 시각워드] 를 뽑는다. 구현과 독립된 검사용. */
function centralDates(buf: Uint8Array): Array<[string, number, number]> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("EOCD를 찾을 수 없습니다");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder("utf-8");
  const out: Array<[string, number, number]> = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const time = dv.getUint16(p + 12, true);
    const date = dv.getUint16(p + 14, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.push([name, date, time]);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const original = new Uint8Array(readFileSync(FORM));
const packed = writeContainer(readContainer(original));

// ① 원본 날짜가 보존되는가. 고치기 전에는 오늘 날짜가 박혀 실패한다.
const want = new Map(centralDates(original).map(([n, d, tm]) => [n, [d, tm]]));
const got = new Map(centralDates(packed).map(([n, d, tm]) => [n, [d, tm]]));
const mismatched = [...want.keys()].filter(
  (n) => JSON.stringify(want.get(n)) !== JSON.stringify(got.get(n)),
);
t("모든 엔트리의 DOS 날짜·시각이 원본과 같다", mismatched, []);

// ② 두 번 재포장하면 바이트가 같은가.
t("두 번 재포장한 결과의 해시가 같다", sha(packed) === sha(writeContainer(readContainer(original))), true);

// ③ mimetype 규약이 유지되는가.
const e0 = readContainer(packed).entries[0];
t("mimetype이 선두다", e0.name, "mimetype");
t("mimetype이 무압축이다", e0.method, 0);

// ④ 1980년 미만이 들어가면 fflate가 예외를 던진다는 사실을 문서화한다.
//    mtime: 0 을 쓰면 안 되는 이유가 이것이다.
let threw = false;
try {
  zipSync({ x: [new Uint8Array([1]), { level: 0, mtime: 0 }] });
} catch {
  threw = true;
}
t("mtime: 0 은 fflate가 거부한다", threw, true);

console.log(f ? `\n${f}건 실패` : "\n전부 통과");
process.exit(f ? 1 : 0);
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx scripts/test-container-mtime.ts`

Expected: 첫 번째 검사가 FAIL 이다. `mismatched` 에 모든 엔트리 이름이 들어 있다. 원본 날짜 대신 오늘 날짜가 박혔기 때문이다. 네 번째 검사는 PASS 한다. 그것은 라이브러리 동작을 고정하는 검사이므로 지금부터 통과하는 것이 정상이다.

- [ ] **Step 3: `Entry` 에 DOS 날짜를 담는다**

`src/lib/hwpx/container.ts` 의 `Entry` 를 고친다.

```ts
export interface Entry {
  name: string;
  /** ZIP 압축 방식 코드. 0 = STORE(무압축), 8 = DEFLATE */
  method: number;
  /** 원본 중앙 디렉터리의 DOS 날짜 워드. 재포장 때 그대로 되살린다. */
  dosDate: number;
  /** 원본 중앙 디렉터리의 DOS 시각 워드. */
  dosTime: number;
}
```

`readDirectory` 의 루프에서 두 워드를 읽어 넣는다. `method` 를 읽는 줄 바로 아래다.

```ts
    const method = dv.getUint16(p + 10, true);
    const dosTime = dv.getUint16(p + 12, true);
    const dosDate = dv.getUint16(p + 14, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, dosDate, dosTime });
```

- [ ] **Step 4: DOS 워드를 지역시각 Date 로 되살리는 함수를 더한다**

같은 파일에 넣는다. `writeContainer` 바로 위가 좋다.

```ts
/**
 * 1980년 1월 1일 0시. DOS 날짜가 비었거나 범위를 벗어날 때 쓰는 대체값이다.
 * fflate는 1980~2099년만 인코딩할 수 있고, 그 밖이면 예외를 던진다.
 */
const FALLBACK_MTIME = new Date(1980, 0, 1, 0, 0, 0);

/**
 * DOS 날짜·시각 워드를 Date 로 되살린다.
 *
 * **반드시 지역시각 생성자를 써야 한다.** fflate가 이 Date를 다시 인코딩할 때
 * getFullYear·getMonth·getDate·getHours 를 쓰기 때문이다. 고정된 epoch 값을
 * 넘기면 시간대가 다른 기계에서 다른 바이트가 나온다. 지역시각으로 만들고
 * 지역시각으로 읽으면 상쇄되어, 어느 기계에서도 원래 워드가 복원된다.
 */
export function dosToDate(dosDate: number, dosTime: number): Date {
  const year = ((dosDate >> 9) & 0x7f) + 1980;
  const month = (dosDate >> 5) & 0x0f;
  const day = dosDate & 0x1f;
  const hour = (dosTime >> 11) & 0x1f;
  const minute = (dosTime >> 5) & 0x3f;
  const second = (dosTime & 0x1f) * 2;
  if (month < 1 || month > 12 || day < 1 || day > 31) return FALLBACK_MTIME;
  if (year < 1980 || year > 2099 || hour > 23 || minute > 59) return FALLBACK_MTIME;
  return new Date(year, month - 1, day, hour, minute, second);
}
```

- [ ] **Step 5: `writeContainer` 가 시각을 넘기게 한다**

같은 파일의 `payload` 선언과 할당을 고친다. 타입에 `mtime` 을 더한다.

```ts
  const payload: Record<string, [Uint8Array, { level: 0 | 6; mtime: Date }]> = {};
  for (const e of ordered) {
    const data = c.files[e.name];
    if (!data) throw new Error(`엔트리 누락: ${e.name}`);
    // mimetype은 무조건 STORE. 나머지는 원본 압축 방식을 따른다.
    const level = e.name === "mimetype" || e.method === 0 ? 0 : 6;
    // 압축 시각을 넘기지 않으면 fflate가 실행 시각을 박아, 내용이 같아도
    // 파일 해시가 매번 달라진다. 원본 시각을 되살려 결정적으로 만든다.
    payload[e.name] = [data, { level: level as 0 | 6, mtime: dosToDate(e.dosDate, e.dosTime) }];
  }
```

- [ ] **Step 6: 테스트 통과를 확인한다**

Run: `npx tsx scripts/test-container-mtime.ts`

Expected: 다섯 검사 모두 PASS, 종료 코드 0.

- [ ] **Step 7: 기존 검증 하네스가 여전히 통과하는지 본다**

Run: `npx tsx scripts/check.ts`

Expected: 각 픽스처의 항등 검사가 이전과 같이 통과한다. `C:\Users\dylan\Downloads` 의 파일이 없으면 건너뜀 표시가 나는데, 그것은 정상이며 실패가 아니다. 표시된 픽스처에서 `① 항등 통과` 가 나와야 한다.

- [ ] **Step 8: 타입 검사와 린트**

Run: `npx tsc --noEmit` 그리고 `npm run lint`

Expected: 둘 다 오류 없음. `Entry` 를 만드는 다른 지점이 있으면 여기서 드러난다. 드러나면 그 지점에도 `dosDate`, `dosTime` 을 채운다.

- [ ] **Step 9: 커밋**

```bash
git add hwpx-app/src/lib/hwpx/container.ts hwpx-app/scripts/test-container-mtime.ts
git commit -m "fix: preserve original ZIP mtime so repacking is deterministic

fflate stamps Date.now() when no mtime is given, so identical content
produced a different file hash on every run. Carry the original DOS
date/time words through Entry and restore them with a local-time
constructor, which round-trips exactly regardless of the machine's
timezone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B7VmrrDgRHjWT9SCqZB3BW"
```

---

## Task 2: 샘플링 파라미터와 모델 버전을 고정한다

**Files:**
- Modify: `src/lib/ai/solar.ts` (별칭 판별 추가)
- Modify: `src/lib/ai/map.ts` (`SAMPLING` 적용, 프롬프트 조립 분리)
- Test: `scripts/test-snapshot.ts` 의 앞부분 — Task 3 에서 이어 쓴다

**Interfaces:**
- Consumes: 없음
- Produces:
  - `solar.ts` 가 `isPinnedModel(name?: string): boolean` 를 내보낸다. 인자를 생략하면 현재 `solarModelName()` 을 검사한다.
  - `map.ts` 가 `buildPrompt(chunk: Slot[], sourceText: string): string` 를 내보낸다. Task 3 의 키 계산과 Task 6 의 기록이 이 함수를 쓴다.
  - `map.ts` 가 `SYSTEM` 과 `FillSchema` 를 내보낸다. 이미 모듈 안에 있으면 `export` 만 붙인다.

- [ ] **Step 1: 별칭 판별을 더한다**

`src/lib/ai/solar.ts` 의 `solarModelName` 아래에 넣는다. 기본값은 바꾸지 않는다. 지금 기본값을 없애면 개발 흐름과 발표 직전 데모가 깨진다. 대신 별칭임을 드러내고, strict 모드에서 Task 5 가 이것을 근거로 막는다.

```ts
/**
 * 버전이 고정되지 않은 별칭 목록. 공급자가 뒤에서 가중치를 갱신할 수 있어,
 * 우리 저장소에 변경이 없는데도 출력이 바뀐다. 재현성을 주장하는 실행에서는
 * 별칭을 허용하지 않는다.
 */
const MODEL_ALIASES = new Set(["solar-pro2", "solar-pro", "solar-mini", "solar-1-mini"]);

/** 모델명이 별칭이 아니라 고정된 버전인가. */
export function isPinnedModel(name: string = solarModelName()): boolean {
  return !MODEL_ALIASES.has(name);
}
```

- [ ] **Step 2: 프롬프트 조립을 함수로 뺀다**

`src/lib/ai/map.ts` 의 모델 호출 안에 인라인으로 들어 있는 프롬프트 문자열을 함수로 옮긴다. 이유는 캐시 키가 프롬프트 전문을 필요로 하는데, 호출부 안에 묻혀 있으면 키 계산이 그 문자열을 다시 만들어야 하고 두 곳이 어긋날 수 있기 때문이다. 조립 지점을 하나로 만든다.

`mapContentToSlots` 정의 위에 넣는다.

```ts
/**
 * 청크 하나에 보낼 사용자 프롬프트를 만든다.
 *
 * 캐시 키가 이 문자열 전문을 해시하므로, 프롬프트 조립은 반드시 이 함수
 * 한 곳에서만 일어나야 한다. 두 곳에서 만들면 키와 실제 호출이 어긋난다.
 */
export function buildPrompt(c: Slot[], sourceText: string): string {
  return (
    `## 채워야 할 칸\n${renderSlots(c)}\n\n` +
    `## 가진 자료\n${sourceText.slice(0, 60000)}\n\n` +
    `위 칸들을 자료에 근거해서만 채우세요.`
  );
}
```

`SYSTEM` 과 `FillSchema` 선언에 `export` 가 없으면 붙인다.

- [ ] **Step 3: 호출부가 새 함수와 고정 파라미터를 쓰게 한다**

`src/lib/ai/map.ts:223` 부근의 `generateObject` 호출을 고친다. `SAMPLING` 은 Task 3 에서 `snapshot.ts` 로 옮기므로, 지금은 `map.ts` 상단에 임시로 둔다.

`map.ts` 상단 import 아래에 넣는다.

```ts
/**
 * 고정 샘플링 값. 두 값 모두 캐시 키에 들어가므로 바꾸면 기존 스냅샷이
 * 전부 무효가 된다. temperature 0 만으로 완전한 결정성은 얻지 못한다.
 * 재현성의 근거는 스냅샷 재생이고, 이 값들은 그 앞단의 흔들림을 줄인다.
 */
export const SAMPLING = { temperature: 0, seed: 20260919 } as const;
```

호출을 고친다.

```ts
      batch.map((c) =>
        generateObject({
          model,
          schema: FillSchema,
          system: SYSTEM,
          temperature: SAMPLING.temperature,
          seed: SAMPLING.seed,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(chunkTimeoutMs),
          prompt: buildPrompt(c, sourceText),
        }),
      ),
```

- [ ] **Step 4: 타입 검사**

Run: `npx tsc --noEmit`

Expected: 오류 없음. `temperature` 와 `seed` 는 이 SDK 버전의 정식 설정이며 `node_modules/ai/dist/index.d.ts` 394행과 437행에 있다.

- [ ] **Step 5: 실제 호출로 채움률 변화를 본다**

Run: `npx tsx scripts/map-check.ts`

Expected: 스크립트가 정상 종료한다. 출력의 채움 칸 수와 되묻기 수를 기록해 둔다. 사양서 §10 의 열린 문제 3이 이것이다. 온도를 내리면 인용 검증 가드의 통과율이 오를지 떨어질지 예측할 수 없다. 채움률이 눈에 띄게 떨어지면 발표 자료의 수치를 갱신해야 하므로, 이 숫자를 커밋 메시지 본문에 남긴다.

이 단계는 Upstage API 키가 필요하다. 키가 없으면 건너뛰고 Step 6 으로 가되, 건너뛴 사실을 기록한다.

- [ ] **Step 6: 커밋**

```bash
git add hwpx-app/src/lib/ai/solar.ts hwpx-app/src/lib/ai/map.ts
git commit -m "fix: pin sampling parameters and expose model alias check

The model call passed neither temperature nor seed, so the provider
default sampled differently on every run. Pin both, and extract prompt
assembly into buildPrompt so the cache key added next can hash the exact
string that gets sent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B7VmrrDgRHjWT9SCqZB3BW"
```

---

## Task 3: 캐시 키를 계산한다

**Files:**
- Create: `src/lib/ai/snapshot.ts`
- Create: `scripts/test-snapshot.ts`

**Interfaces:**
- Consumes: `map.ts` 의 `buildPrompt`, `SYSTEM`, `FillSchema` (Task 2)
- Produces:
  - `CallDescriptor` 인터페이스: `{ model: string; system: string; prompt: string; schema: unknown }`
  - `snapshotKey(d: CallDescriptor): string` — 64자 소문자 16진수
  - `SAMPLING` 상수가 여기로 이사한다. Task 2 가 `map.ts` 에 둔 것을 옮기고, `map.ts` 는 여기서 import 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`scripts/test-snapshot.ts` 를 만든다.

```ts
/**
 * 스냅샷 키와 모드 검사.
 *
 * 실행: npx tsx scripts/test-snapshot.ts
 */
import { snapshotKey, type CallDescriptor } from "../src/lib/ai/snapshot";

let f = 0;
const t = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  — got ${JSON.stringify(got)}`}`);
  if (!ok) f++;
};

const base: CallDescriptor = {
  model: "solar-pro2-250909",
  system: "너는 공문서 칸을 채운다",
  prompt: "## 채워야 할 칸\ns0.t1.r2c3 대표자\n\n## 가진 자료\n이사장은 김정한",
  schema: { type: "object", properties: { fills: { type: "array" } }, required: ["fills"] },
};

// 최상위 await 를 쓸 수 없으므로 처음부터 main 으로 감싼다. Task 4 가 여기에 덧붙인다.
async function main() {
  t("키는 64자 16진수다", /^[0-9a-f]{64}$/.test(snapshotKey(base)), true);
  t("같은 입력은 같은 키를 낸다", snapshotKey(base) === snapshotKey({ ...base }), true);
  t("자료가 한 글자 달라지면 키가 달라진다",
    snapshotKey(base) === snapshotKey({ ...base, prompt: base.prompt + "." }), false);
  t("모델이 달라지면 키가 달라진다",
    snapshotKey(base) === snapshotKey({ ...base, model: "solar-pro2" }), false);
  t("시스템 프롬프트가 달라지면 키가 달라진다",
    snapshotKey(base) === snapshotKey({ ...base, system: base.system + " " }), false);
  t("스키마가 달라지면 키가 달라진다",
    snapshotKey(base) === snapshotKey({ ...base, schema: { type: "string" } }), false);

  // 스키마 객체의 키 순서가 달라도 같은 키가 나와야 한다. 정규화가 없으면 깨진다.
  t("스키마 키 순서는 키에 영향을 주지 않는다",
    snapshotKey({ ...base, schema: { b: 1, a: 2 } }) === snapshotKey({ ...base, schema: { a: 2, b: 1 } }),
    true);

  // 자모 분리된 한글과 결합된 한글은 같은 자료로 취급해야 한다.
  t("유니코드 정규화가 적용된다",
    snapshotKey({ ...base, prompt: "가".normalize("NFD") }) ===
      snapshotKey({ ...base, prompt: "가".normalize("NFC") }),
    true);
}

main()
  .then(() => {
    console.log(f ? `\n${f}건 실패` : "\n전부 통과");
    process.exit(f ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx scripts/test-snapshot.ts`

Expected: 모듈을 찾을 수 없다는 오류로 실패한다. `Cannot find module '../src/lib/ai/snapshot'`.

- [ ] **Step 3: 키 계산을 구현한다**

`src/lib/ai/snapshot.ts` 를 만든다.

```ts
/**
 * 모델 응답의 기록·재생 계층.
 *
 * 이 모듈은 프롬프트와 응답만 안다. ZIP도 XML도 슬롯도 모른다.
 * 재현성의 근거가 여기 있다. temperature를 0으로 내려도 대규모 언어모델은
 * 완전히 결정적이지 않으므로, 통제할 수 없는 부분은 기록해서 우회한다.
 */
import { createHash } from "node:crypto";

/**
 * 고정 샘플링 값. 두 값 모두 캐시 키에 들어가므로 바꾸면 기존 스냅샷이
 * 전부 무효가 된다.
 */
export const SAMPLING = { temperature: 0, seed: 20260919 } as const;

export interface CallDescriptor {
  /** 별칭이 아닌, 해석된 실제 모델명 */
  model: string;
  system: string;
  prompt: string;
  /** 응답 스키마를 JSON Schema로 변환한 것 */
  schema: unknown;
}

/**
 * 객체를 키 순서에 무관한 문자열로 만든다.
 * JSON.stringify는 키 순서를 보존하므로, 같은 스키마가 다른 키를 내는 일이 생긴다.
 */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

/**
 * 호출 하나를 식별하는 SHA-256 키.
 *
 * 프롬프트 전문이 키에 들어가므로, 자료가 한 글자만 달라도 다른 키가 되어
 * 재생되지 않는다. "같은 내용 인풋"의 판정을 사람의 눈이 아니라 해시에 맡긴다.
 */
export function snapshotKey(d: CallDescriptor): string {
  const payload = canonical({
    model: d.model.normalize("NFC"),
    system: d.system.normalize("NFC"),
    prompt: d.prompt.normalize("NFC"),
    schema: d.schema,
    temperature: SAMPLING.temperature,
    seed: SAMPLING.seed,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx tsx scripts/test-snapshot.ts`

Expected: 여덟 검사 모두 PASS, 종료 코드 0.

- [ ] **Step 5: `SAMPLING` 중복을 없앤다**

Task 2 가 `map.ts` 에 둔 `SAMPLING` 선언을 지우고, `snapshot.ts` 에서 import 한다.

```ts
import { SAMPLING } from "./snapshot";
```

Run: `npx tsc --noEmit`

Expected: 오류 없음. 두 곳에 같은 이름이 남아 있으면 여기서 드러난다.

- [ ] **Step 6: 커밋**

```bash
git add hwpx-app/src/lib/ai/snapshot.ts hwpx-app/scripts/test-snapshot.ts hwpx-app/src/lib/ai/map.ts
git commit -m "feat: add content-addressed cache key for model calls

Key is the SHA-256 of a canonical, NFC-normalized JSON of model name,
both prompts, the response schema and the sampling settings. Object keys
are sorted so an equivalent schema never yields two different keys.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B7VmrrDgRHjWT9SCqZB3BW"
```

---

## Task 4: 모드를 판정하고 재생한다

**Files:**
- Modify: `src/lib/ai/snapshot.ts`
- Create: `src/lib/ai/snapshots.generated.ts`
- Modify: `scripts/test-snapshot.ts` (검사 추가)

**Interfaces:**
- Consumes: Task 3 의 `snapshotKey`, `CallDescriptor`
- Produces:
  - `type ReproMode = "strict" | "prefer" | "off"`
  - `reproMode(): ReproMode`
  - `runOrReplay<T>(d: CallDescriptor, live: () => Promise<T>, snapshots?: Record<string, unknown>): Promise<{ value: T; replayed: boolean; key: string }>`
  - `SNAPSHOTS: Record<string, unknown>` — `snapshots.generated.ts` 가 내보내고 `snapshot.ts` 가 기본값으로 쓴다

- [ ] **Step 1: 빈 스냅샷 모듈을 만든다**

`src/lib/ai/snapshots.generated.ts` 를 만든다. 기록 전이므로 비어 있다.

```ts
/**
 * 생성 파일 — 손으로 고치지 마세요.
 *
 * `npx tsx scripts/record.ts` 가 이 파일을 통째로 덮어씁니다.
 *
 * 키는 snapshotKey() 가 만든 SHA-256이고, 값은 모델이 돌려준 구조화 응답
 * 객체입니다. 이 파일이 번들에 포함되므로 배포본에서 파일 읽기 없이 재생됩니다.
 *
 * 기록 시각: (아직 기록되지 않음)
 * 항목 수: 0
 */
export const SNAPSHOTS: Record<string, unknown> = {};
```

- [ ] **Step 2: 실패하는 테스트를 더한다**

`scripts/test-snapshot.ts` 의 import 를 늘리고, `main` 함수 끝에 검사를 덧붙인다. 아래 코드는 `main` 안에 들어가므로 두 칸 들여쓴 상태다.

import 를 이렇게 바꾼다.

```ts
import { snapshotKey, reproMode, runOrReplay, type CallDescriptor } from "../src/lib/ai/snapshot";
```

`main` 안, 마지막 검사 뒤에 덧붙인다.

```ts
  // ── 모드 판정 ──
  process.env.REPRO_MODE = "";
  t("기본 모드는 prefer 다", reproMode(), "prefer");
  process.env.REPRO_MODE = "strict";
  t("strict 를 읽는다", reproMode(), "strict");
  process.env.REPRO_MODE = "STRICT";
  t("대소문자를 가리지 않는다", reproMode(), "strict");
  process.env.REPRO_MODE = "잘못된값";
  let badMode = false;
  try {
    reproMode();
  } catch {
    badMode = true;
  }
  t("모르는 값은 예외다", badMode, true);

  // ── 재생 ──
  const key = snapshotKey(base);
  const snaps = { [key]: { fills: [{ id: "s0.t1.r2c3", value: "김정한", evidence: "이사장은 김정한" }] } };

  process.env.REPRO_MODE = "prefer";
  let liveCalls = 0;
  const live = async () => {
    liveCalls++;
    return { fills: [] };
  };

  const hit = await runOrReplay(base, live, snaps);
  t("prefer + 적중이면 재생한다", hit.replayed, true);
  t("prefer + 적중이면 실제 호출을 하지 않는다", liveCalls, 0);
  t("재생된 값이 스냅샷과 같다", hit.value, snaps[key]);
  t("키를 함께 돌려준다", hit.key, key);

  const miss = await runOrReplay({ ...base, prompt: "다른 프롬프트" }, live, snaps);
  t("prefer + 미적중이면 실제 호출한다", miss.replayed, false);
  t("실제 호출이 한 번 일어났다", liveCalls, 1);

  process.env.REPRO_MODE = "off";
  const forced = await runOrReplay(base, live, snaps);
  t("off 는 적중해도 실제 호출한다", forced.replayed, false);

  process.env.REPRO_MODE = "strict";
  const strictHit = await runOrReplay(base, live, snaps);
  t("strict + 적중이면 재생한다", strictHit.replayed, true);

  let strictThrew = "";
  try {
    await runOrReplay({ ...base, prompt: "기록되지 않은 프롬프트" }, live, snaps);
  } catch (e) {
    strictThrew = (e as Error).message;
  }
  t("strict + 미적중이면 예외다", strictThrew.length > 0, true);
  t("예외 메시지에 키가 담긴다",
    strictThrew.includes(snapshotKey({ ...base, prompt: "기록되지 않은 프롬프트" })), true);
  t("strict 미적중에서 실제 호출은 일어나지 않는다", liveCalls, 1);

  delete process.env.REPRO_MODE;
```

`RECORDED` 는 Task 6 이 더하는 것이므로 지금은 검사하지 않는다.

- [ ] **Step 3: 실패를 확인한다**

Run: `npx tsx scripts/test-snapshot.ts`

Expected: `reproMode` 와 `runOrReplay` 가 없어 import 가 깨지거나 타입 오류가 난다.

- [ ] **Step 4: 모드와 재생을 구현한다**

`src/lib/ai/snapshot.ts` 에 덧붙인다. 파일 상단 import 에 생성 모듈을 더한다.

```ts
import { SNAPSHOTS } from "./snapshots.generated";
```

파일 끝에 넣는다.

```ts
export type ReproMode = "strict" | "prefer" | "off";

/**
 * 재현 모드.
 *
 * strict — 스냅샷이 없으면 실패한다. 실제 호출을 하지 않는다. 시연과 테스트용.
 * prefer — 있으면 재생, 없으면 실제 호출. 평소 운영 기본값.
 * off    — 항상 실제 호출. 새 양식 탐색과 기록용.
 */
export function reproMode(): ReproMode {
  const raw = (process.env.REPRO_MODE ?? "").trim().toLowerCase();
  if (!raw) return "prefer";
  if (raw === "strict" || raw === "prefer" || raw === "off") return raw;
  throw new Error(
    `REPRO_MODE 값이 잘못됐습니다: "${raw}". strict · prefer · off 중 하나여야 합니다.`,
  );
}

export interface ReplayOutcome<T> {
  value: T;
  /** 스냅샷에서 되살렸는가. false면 실제 호출이 일어났다. */
  replayed: boolean;
  key: string;
}

/**
 * 스냅샷이 있으면 재생하고, 없으면 모드에 따라 실제 호출하거나 실패한다.
 *
 * `snapshots` 를 인자로 받는 이유는 테스트가 생성 모듈에 의존하지 않게 하려는
 * 것이다. 실제 호출부는 인자를 생략하고 번들된 스냅샷을 쓴다.
 */
export async function runOrReplay<T>(
  d: CallDescriptor,
  live: () => Promise<T>,
  snapshots: Record<string, unknown> = SNAPSHOTS,
): Promise<ReplayOutcome<T>> {
  const key = snapshotKey(d);
  const mode = reproMode();
  const hit =
    mode !== "off" && Object.prototype.hasOwnProperty.call(snapshots, key)
      ? snapshots[key]
      : undefined;

  if (hit !== undefined) return { value: hit as T, replayed: true, key };

  if (mode === "strict") {
    throw new Error(
      `strict 모드인데 스냅샷이 없습니다.\n` +
        `  키: ${key}\n` +
        `  모델: ${d.model}\n` +
        `이 입력을 기록하려면: npx tsx scripts/record.ts <양식.hwpx> <자료파일>`,
    );
  }

  return { value: await live(), replayed: false, key };
}
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `npx tsx scripts/test-snapshot.ts`

Expected: 앞선 여덟 검사와 새 열네 검사가 모두 PASS, 종료 코드 0.

- [ ] **Step 6: 커밋**

```bash
git add hwpx-app/src/lib/ai/snapshot.ts hwpx-app/src/lib/ai/snapshots.generated.ts hwpx-app/scripts/test-snapshot.ts
git commit -m "feat: add record/replay modes for model calls

REPRO_MODE selects strict, prefer or off. Snapshots live in a generated
module so they are bundled at build time and replay works on Vercel,
where the runtime filesystem is ephemeral.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B7VmrrDgRHjWT9SCqZB3BW"
```

---

## Task 5: 매핑을 재생 경로로 돌리고 실패 정책을 고친다

**Files:**
- Modify: `src/lib/ai/map.ts`

**Interfaces:**
- Consumes: Task 3~4 의 `runOrReplay`, `reproMode`, `SAMPLING`; Task 2 의 `isPinnedModel`, `buildPrompt`
- Produces: `mapContentToSlots` 의 반환 타입에 네 필드가 추가된다. `replayed: number`, `liveCalls: number`, `mode: ReproMode`, `droppedIds: string[]`. Task 8 의 API 메타가 이 값을 읽는다.

- [ ] **Step 1: 스키마의 JSON Schema 를 한 번만 만든다**

`src/lib/ai/map.ts` 의 `FillSchema` 선언 아래에 넣는다. `z.toJSONSchema` 는 이 zod 버전에 있으며, 확인 결과 `$schema`, `type`, `properties`, `required`, `additionalProperties` 를 담은 객체를 돌려준다.

```ts
/**
 * 캐시 키에 넣을 스키마 표현. 모듈 로드 때 한 번만 만든다.
 * 스키마를 고치면 이 값이 바뀌어 낡은 스냅샷이 자동으로 무효가 된다.
 */
const SCHEMA_JSON = z.toJSONSchema(FillSchema);
```

`z` 가 import 되어 있지 않으면 `import { z } from "zod";` 를 더한다.

- [ ] **Step 2: strict 모드의 전제를 검사한다**

`mapContentToSlots` 안, `const model = getSolar();` 바로 위에 넣는다.

```ts
  const mode = reproMode();
  if (mode === "strict" && !isPinnedModel()) {
    throw new Error(
      `strict 모드는 고정된 모델 버전을 요구합니다. 현재 SOLAR_MODEL=${solarModelName()} 은 별칭이어서, ` +
        `공급자가 뒤에서 갱신하면 같은 코드가 다른 모델을 부릅니다. ` +
        `.env.local 에 날짜가 붙은 버전을 지정하세요.`,
    );
  }
```

import 를 늘린다.

```ts
import { getSolar, solarModelName, isPinnedModel } from "./solar";
import { runOrReplay, reproMode, SAMPLING, type ReproMode } from "./snapshot";
```

- [ ] **Step 3: 호출을 재생 경로로 바꾼다**

배치 루프의 `Promise.allSettled` 인자를 고친다. 반환 모양이 `generateObject` 의 결과에서 `ReplayOutcome` 으로 바뀌므로, 아래 소비 루프도 함께 고쳐야 한다.

```ts
  const modelName = solarModelName();
  let replayed = 0;
  let liveCalls = 0;
  // 실패로 비워둔 칸 목록. 개수만으로는 무엇이 빠졌는지 알 수 없다.
  const droppedIds: string[] = [];

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((c) => {
        const prompt = buildPrompt(c, sourceText);
        return runOrReplay({ model: modelName, system: SYSTEM, prompt, schema: SCHEMA_JSON }, async () => {
          const r = await generateObject({
            model,
            schema: FillSchema,
            system: SYSTEM,
            temperature: SAMPLING.temperature,
            seed: SAMPLING.seed,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(chunkTimeoutMs),
            prompt,
          });
          return r.object;
        });
      }),
    );
```

- [ ] **Step 4: 소비 루프를 고친다**

`r.value.object.fills` 가 `r.value.value.fills` 로 바뀌면 읽기 어렵다. 구조 분해로 풀어 쓴다. 실패 분기에는 strict 정책을 더한다.

```ts
    for (const r of results) {
      if (r.status !== "fulfilled") {
        // 실패를 삼키면 "채운 칸 0개"가 정상 결과처럼 보인다. 반드시 드러낸다.
        const err = r.reason as Error & { name?: string };
        const timedOut =
          err?.name === "TimeoutError" ||
          err?.name === "AbortError" ||
          /abort|timeout/i.test(err?.message ?? "");
        const failedChunk = batch[results.indexOf(r)] ?? [];
        for (const s of failedChunk) droppedIds.push(s.id);
        const message = timedOut
          ? `Solar 응답이 ${Math.round(chunkTimeoutMs / 1000)}초를 넘겨 칸 ${failedChunk.length}개를 비워둠`
          : (err?.message ?? String(r.reason));

        // 무엇이 비었는지가 네트워크 상태에 달려 있으면 출력이 재현되지 않는다.
        // strict 모드에서는 반쪽 문서를 재현 가능하다고 주장하지 않고 실패시킨다.
        if (mode === "strict") {
          throw new Error(`strict 모드에서 청크가 실패해 중단합니다: ${message}`);
        }
        errors.push(message);
        continue;
      }

      const { value: object, replayed: wasReplayed } = r.value;
      if (wasReplayed) replayed++;
      else liveCalls++;
```

여기까지가 새로 넣는 코드다. 그 아래 기존 본문은 딱 두 줄만 고친다.

| 고치기 전 | 고친 후 |
|---|---|
| `for (const f of r.value.object.fills) {` | `for (const f of object.fills) {` |
| `for (const q of r.value.object.questions) {` | `for (const q of object.questions) {` |

두 루프의 본문은 한 글자도 건드리지 않는다. 인용 검증 가드와 0 귀속 가드가 거기 있고, 둘 다 실측으로 도입된 것이므로 손대면 채움 품질이 되돌아간다.

- [ ] **Step 5: 반환 타입을 늘린다**

함수 시그니처와 반환문을 고친다.

```ts
export async function mapContentToSlots(
  slots: Slot[],
  sourceText: string,
  opts: MapOptions = {},
): Promise<
  MapResult & {
    skipped: number;
    replayed: number;
    liveCalls: number;
    mode: ReproMode;
    droppedIds: string[];
  }
> {
```

```ts
  const refined = refineQuestions(dedupeColumn(fills, use), questions, sourceText);
  return { ...refined, errors, skipped, replayed, liveCalls, mode, droppedIds };
```

- [ ] **Step 6: 타입 검사와 린트**

Run: `npx tsc --noEmit` 그리고 `npm run lint`

Expected: 오류 없음. `mapContentToSlots` 를 쓰는 세 지점이 새 필드를 무시해도 타입은 통과한다. `src/app/api/analyze/route.ts`, `src/app/api/run/route.ts`, `scripts/map-check.ts` 가 그 세 곳이다.

- [ ] **Step 7: strict 모드가 제대로 막는지 본다**

Run: `REPRO_MODE=strict npx tsx scripts/map-check.ts`

Expected: 스냅샷이 아직 없으므로 실패한다. 오류 메시지에 스냅샷 키가 들어 있어야 한다. 이 실패가 정상이며, Task 6 이 이것을 해결한다. Windows PowerShell 에서는 `$env:REPRO_MODE="strict"; npx tsx scripts/map-check.ts` 로 돌린다.

- [ ] **Step 8: 커밋**

```bash
git add hwpx-app/src/lib/ai/map.ts
git commit -m "feat: route model calls through replay layer, fail loudly in strict

Chunk failures used to silently blank those cells and still emit a file,
which let network latency leak into document content. In strict mode a
chunk failure now aborts instead of claiming a half-filled document is
reproducible.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B7VmrrDgRHjWT9SCqZB3BW"
```

---

## Task 6: 기록 명령

**Files:**
- Create: `scripts/record.ts`
- Modify: `src/lib/ai/snapshots.generated.ts` (실행 결과로 덮어써진다)

**Interfaces:**
- Consumes: Task 3~5 전부
- Produces: 실행 가능한 기록 명령. 다른 코드가 이 파일을 import 하지 않는다.

- [ ] **Step 1: 기록 스크립트를 쓴다**

`scripts/record.ts` 를 만든다. 기록은 사람이 명시적으로 돌리는 행위다. 실행 중 저절로 캐시가 채워지면 저장소 상태와 배포 상태가 갈라진다.

```ts
/**
 * 스냅샷 기록 — 로컬 전용.
 *
 * 실제 양식과 자료로 Solar를 한 번 호출하고, 응답을 src/lib/ai/snapshots.generated.ts
 * 에 써낸다. 배포본에는 이 경로가 존재하지 않는다.
 *
 * 실행: npx tsx scripts/record.ts "<양식.hwpx>" "<자료.txt>"
 * 인자를 생략하면 저장소에 커밋된 기본 픽스처를 쓴다.
 */
import { config } from "dotenv";
config({ path: ".env.local" }); // Next는 .env.local을 읽지만 dotenv 기본값은 .env 다
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { readContainer } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";
import { extract } from "../src/lib/extract";
import { mapContentToSlots } from "../src/lib/ai/map";
import { RECORDED } from "../src/lib/ai/snapshot";
import { SNAPSHOTS } from "../src/lib/ai/snapshots.generated";
import { solarModelName, isPinnedModel } from "../src/lib/ai/solar";

const DEFAULT_FORM = "../D1-test/core-(서식1) 비영리법인 현황 제출 양식.hwpx";
const DEFAULT_SOURCE = "scripts/fixtures/법인자료.txt";
const OUT = "src/lib/ai/snapshots.generated.ts";

const formPath = process.argv[2] ?? DEFAULT_FORM;
const sourcePath = process.argv[3] ?? DEFAULT_SOURCE;

// 기록은 항상 실제 호출이다. 재생된 응답을 다시 기록하면 아무 의미가 없다.
process.env.REPRO_MODE = "off";

const model = solarModelName();
if (!isPinnedModel(model)) {
  console.log(
    `\n경고: SOLAR_MODEL=${model} 은 별칭입니다. 공급자가 갱신하면 이 스냅샷이\n` +
      `어느 모델의 응답인지 알 수 없게 됩니다. .env.local 에 고정 버전을 지정하는 편이 좋습니다.\n`,
  );
}

console.log(`양식: ${basename(formPath)}`);
console.log(`자료: ${basename(sourcePath)}`);
console.log(`모델: ${model}\n`);

async function main() {
  const formBuf = new Uint8Array(readFileSync(formPath));
  const sourceBuf = new Uint8Array(readFileSync(sourcePath));
  const sourceText = extract(sourceBuf, basename(sourcePath)).text;

  const { result } = dissect(readContainer(formBuf));
  const mapped = await mapContentToSlots(result.slots, sourceText);

  console.log(`실제 호출 ${mapped.liveCalls}회 · 재생 ${mapped.replayed}회`);
  console.log(`채운 칸 ${mapped.fills.filter((f) => f.value).length}개 · 되묻기 ${mapped.questions.length}개`);
  if (mapped.errors.length) {
    console.log(`\n오류 ${mapped.errors.length}건 — 기록을 중단합니다:`);
    for (const e of mapped.errors) console.log(`  ${e}`);
    console.log(`\n일부만 성공한 응답을 기록하면 재생이 반쪽 문서를 되살립니다.`);
    process.exit(1);
  }
  // 파일로 써내는 부분은 Step 3 에서 이어 붙인다.
}
```

Step 2 가 `RECORDED` 를 더하기 전이므로, 이 시점에는 import 가 타입 오류를 낸다. Step 2 를 먼저 돌려도 되고, 이어서 진행해도 된다.

- [ ] **Step 2: 실제 호출로 얻은 응답을 담아두는 훅을 더한다**

`mapContentToSlots` 는 응답 원문을 돌려주지 않는다. 기록에는 원문이 필요하다.

기록 스크립트가 청크를 다시 만들어 키를 계산하는 방법도 있지만, 그러면 키 계산이 두 곳에서 일어나고 어긋날 수 있다. 실제로 보낸 것과 기록한 것이 다르면 재생이 영원히 미적중한다. 그래서 실제 호출이 일어난 지점에서 바로 담는다.

`src/lib/ai/snapshot.ts` 의 `runOrReplay` 마지막 줄을 고친다.

```ts
  const value = await live();
  RECORDED.set(key, value);
  return { value, replayed: false, key };
```

같은 파일 상단에 선언한다.

```ts
/**
 * 이번 프로세스에서 실제 호출로 얻은 응답. 기록 스크립트가 이것을 읽어 파일로 써낸다.
 * 서버 경로에서는 아무도 읽지 않으므로 부작용이 없다. 프로세스가 끝나면 사라진다.
 */
export const RECORDED = new Map<string, unknown>();
```

- [ ] **Step 3: 기록 스크립트가 파일을 써내게 한다**

`scripts/record.ts` 의 `main` 안에서 Step 1 이 남긴 주석 자리를 채운다. `RECORDED` 는 Step 1 의 import 에 이미 들어 있다.

```ts
  const merged: Record<string, unknown> = { ...SNAPSHOTS };
  for (const [k, v] of RECORDED) merged[k] = v;

  const body = Object.keys(merged)
    .sort()
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(merged[k], null, 2).split("\n").join("\n  ")},`)
    .join("\n");

  writeFileSync(
    OUT,
  `/**\n` +
    ` * 생성 파일 — 손으로 고치지 마세요.\n` +
    ` *\n` +
    ` * \`npx tsx scripts/record.ts\` 가 이 파일을 통째로 덮어씁니다.\n` +
    ` *\n` +
    ` * 키는 snapshotKey() 가 만든 SHA-256이고, 값은 모델이 돌려준 구조화 응답\n` +
    ` * 객체입니다. 이 파일이 번들에 포함되므로 배포본에서 파일 읽기 없이 재생됩니다.\n` +
    ` *\n` +
    ` * 기록 시각: ${new Date().toISOString()}\n` +
    ` * 모델: ${model}\n` +
    ` * 항목 수: ${Object.keys(merged).length}\n` +
    ` */\n` +
      `export const SNAPSHOTS: Record<string, unknown> = {\n${body}\n};\n`,
    "utf8",
  );

  console.log(`\n새로 기록 ${RECORDED.size}개 · 전체 ${Object.keys(merged).length}개`);
  console.log(`${OUT} 를 갱신했습니다. 커밋해야 배포본에 반영됩니다.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

들여쓰기를 주의한다. 위 코드는 `main` 안이므로 두 칸 들여쓴 상태이고, `writeFileSync` 의 인자들은 그보다 두 칸 더 들어간다.

키를 사전순으로 정렬하는 이유는 기록을 두 번 돌렸을 때 파일 diff 가 요동치지 않게 하려는 것이다.

- [ ] **Step 4: 기록을 돌린다**

Run: `npx tsx scripts/record.ts`

Expected: 실제 호출이 일어나고 `src/lib/ai/snapshots.generated.ts` 가 갱신된다. 출력에 새로 기록한 개수가 나온다. Upstage API 키가 필요하다.

- [ ] **Step 5: strict 모드가 이제 통과하는지 확인한다**

Run: `$env:REPRO_MODE="strict"; npx tsx scripts/map-check.ts`

Expected: Task 5 Step 7 에서 실패했던 것이 이제 통과한다. 실제 호출 0회, 재생 횟수가 청크 수와 같아야 한다.

- [ ] **Step 6: 타입 검사와 커밋**

Run: `npx tsc --noEmit`

```bash
git add hwpx-app/scripts/record.ts hwpx-app/src/lib/ai/snapshot.ts hwpx-app/src/lib/ai/snapshots.generated.ts
git commit -m "feat: add local-only snapshot recording command

Recording is an explicit human action, never a side effect of serving a
request, so the repository and the deployment never drift apart. Keys are
written sorted so re-recording produces a stable diff.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B7VmrrDgRHjWT9SCqZB3BW"
```

---

## Task 7: 재현 검사와 `npm test`

**Files:**
- Create: `scripts/repro-check.ts`
- Create: `scripts/fixtures/expected-hashes.json` (`--update` 실행이 만든다)
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1~6 전부
- Produces: `npm test` 명령. CI 와 발표 준비가 이것을 쓴다.

- [ ] **Step 1: 재현 검사 스크립트를 쓴다**

`scripts/repro-check.ts` 를 만든다. 진단 방식은 실제로 문제를 드러낸 검증된 방법이다. 두 hwpx 의 본문 텍스트 노드를 뽑아 한쪽에만 있는 값을 나열한다.

```ts
/**
 * 재현성 검사 — 같은 입력으로 두 번 돌려 결과 해시를 비교한다.
 *
 * strict 모드로 돌아가므로 네트워크도 API 키도 필요 없다.
 * 해시가 다르면 어느 칸이 갈렸는지 출력한다.
 *
 * 실행: npx tsx scripts/repro-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { readContainer } from "../src/lib/hwpx/container";
import { dissect } from "../src/lib/hwpx/dissect";
import { extract } from "../src/lib/extract";
import { mapContentToSlots } from "../src/lib/ai/map";
import { fill } from "../src/lib/hwpx/fill";
import { computeSubtotals } from "../src/lib/sum";

// 플래그를 경로로 오인하지 않도록 걸러낸다.
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FORM = args[0] ?? "../D1-test/core-(서식1) 비영리법인 현황 제출 양식.hwpx";
const SOURCE = args[1] ?? "scripts/fixtures/법인자료.txt";
/** 커밋되는 기대 해시. 양식과 자료 조합마다 한 줄이다. */
const GOLDEN = "scripts/fixtures/expected-hashes.json";

// 재현 검사는 언제나 strict 다. 실제 호출이 섞이면 무엇을 검사하는지 알 수 없다.
process.env.REPRO_MODE = "strict";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** 본문 section XML의 텍스트 노드를 순서대로 뽑는다. */
function texts(file: Uint8Array): string[] {
  const z = unzipSync(file) as Record<string, Uint8Array>;
  const names = Object.keys(z)
    .filter((n) => /section\d+\.xml$/.test(n))
    .sort();
  const xml = names.map((n) => new TextDecoder().decode(z[n])).join("");
  return [...xml.matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map((m) => m[1]).filter((s) => s.trim());
}

async function once(formBuf: Uint8Array, sourceText: string): Promise<Uint8Array> {
  const { result, slots } = dissect(readContainer(formBuf));
  const mapped = await mapContentToSlots(result.slots, sourceText);
  const values: Record<string, string> = {};
  for (const f of mapped.fills) if (f.value) values[f.id] = f.value;
  for (const c of computeSubtotals(result.slots, values)) values[c.id] = c.value;
  const res = fill(formBuf, slots, { values });
  if (!res.report.ok) {
    throw new Error(`무손상 검증 실패: ${res.report.problems.join(" · ")}`);
  }
  return res.file;
}

/** 두 실행 사이의 차이를 사람이 읽을 수 있게 출력한다. */
function explain(a: Uint8Array, b: Uint8Array): void {
  const ta = texts(a);
  const tb = texts(b);
  const sa = new Set(ta);
  const sb = new Set(tb);
  console.log(`\n텍스트 조각 ${ta.length} vs ${tb.length}`);
  const onlyA = [...sa].filter((x) => !sb.has(x));
  const onlyB = [...sb].filter((x) => !sa.has(x));
  if (onlyA.length || onlyB.length) {
    for (const x of onlyA.slice(0, 20)) console.log(`  1회차에만: ${x}`);
    for (const x of onlyB.slice(0, 20)) console.log(`  2회차에만: ${x}`);
  } else {
    console.log(`  본문 텍스트는 같습니다. 차이는 컨테이너 계층에 있습니다.`);
    console.log(`  npx tsx scripts/test-container-mtime.ts 를 돌려보세요.`);
  }
}

async function main() {
  const formBuf = new Uint8Array(readFileSync(FORM));
  const sourceText = extract(new Uint8Array(readFileSync(SOURCE)), basename(SOURCE)).text;

  console.log(`양식: ${basename(FORM)}`);
  console.log(`자료: ${basename(SOURCE)}\n`);

  const a = await once(formBuf, sourceText);
  const b = await once(formBuf, sourceText);

  console.log(`1회차  ${sha(a)}  ${a.length} 바이트`);
  console.log(`2회차  ${sha(b)}  ${b.length} 바이트`);

  if (sha(a) !== sha(b)) {
    console.log(`\n재현 실패 — 두 실행의 해시가 다릅니다. 갈린 내용을 찾습니다.`);
    explain(a, b);
    process.exit(1);
  }
  console.log(`\n두 실행의 해시가 같습니다.`);

  // ── 골든 해시 ──
  // 두 실행이 서로 같은 것만으로는 어제와 오늘이 같음을 보이지 못한다.
  // 저장소에 커밋된 기대 해시와도 맞아야 한다.
  const key = `${basename(FORM)} + ${basename(SOURCE)}`;
  const golden: Record<string, string> = existsSync(GOLDEN)
    ? JSON.parse(readFileSync(GOLDEN, "utf8"))
    : {};

  if (process.argv.includes("--update")) {
    golden[key] = sha(a);
    writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 2)}\n`, "utf8");
    console.log(`골든 해시를 갱신했습니다: ${GOLDEN}`);
    console.log(`커밋해야 다음 실행부터 비교됩니다.`);
    process.exit(0);
  }

  const want = golden[key];
  if (!want) {
    console.log(`\n골든 해시가 없습니다: ${key}`);
    console.log(`npx tsx scripts/repro-check.ts -- --update 로 기록하세요.`);
    process.exit(1);
  }
  if (want !== sha(a)) {
    console.log(`\n골든 해시 불일치`);
    console.log(`  기대  ${want}`);
    console.log(`  실제  ${sha(a)}`);
    console.log(`\n스냅샷이나 파이프라인이 바뀌었습니다. 의도한 변경이면 --update 로 갱신하세요.`);
    process.exit(1);
  }

  console.log(`\n재현됨 — 두 실행이 서로 같고, 커밋된 골든 해시와도 같습니다.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 두 실행이 서로 같은지 먼저 본다**

Run: `npx tsx scripts/repro-check.ts`

Expected: 두 해시가 같다는 줄이 나오고, 골든 해시가 없다는 안내와 함께 종료 코드 1 로 끝난다. 두 해시가 다르면 갈린 값 목록이 나오는데 그 자체로 진단이 된다. 본문 텍스트는 같은데 해시가 다르다면 Task 1 이 덜 된 것이다.

- [ ] **Step 3: 골든 해시를 기록한다**

Run: `npx tsx scripts/repro-check.ts --update`

Expected: `scripts/fixtures/expected-hashes.json` 이 생기고 양식과 자료 조합 한 줄이 들어간다. 이 파일이 사양서 §7.2 가 말하는 기대 출력 해시다. 두 실행이 서로 같은 것만으로는 어제와 오늘이 같음을 보이지 못하므로, 저장소에 기준값을 둔다.

- [ ] **Step 4: 골든 비교가 도는지 확인한다**

Run: `npx tsx scripts/repro-check.ts`

Expected: `재현됨 — 두 실행이 서로 같고, 커밋된 골든 해시와도 같습니다.` 가 출력되고 종료 코드 0.

- [ ] **Step 5: `npm test` 를 더한다**

`package.json` 의 `scripts` 를 고친다.

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "tsx scripts/test-container-mtime.ts && tsx scripts/test-snapshot.ts && tsx scripts/test-sum.ts && tsx scripts/repro-check.ts"
  },
```

`repro-check` 를 마지막에 두는 이유는 가장 느리고, 앞선 검사가 실패하면 어차피 의미가 없기 때문이다.

- [ ] **Step 6: 전체 테스트를 돌린다**

Run: `npm test`

Expected: 네 스크립트가 순서대로 돌고 모두 종료 코드 0. API 호출은 일어나지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add hwpx-app/scripts/repro-check.ts hwpx-app/scripts/fixtures/expected-hashes.json hwpx-app/package.json
git commit -m "test: add reproducibility check and npm test entry point

repro-check runs the full pipeline twice in strict mode and compares
output hashes, so the claim is verified by running code rather than
asserted. Needs no API key.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B7VmrrDgRHjWT9SCqZB3BW"
```

---

## Task 8: API 응답에 재현 메타를 싣는다

**Files:**
- Modify: `src/app/api/run/route.ts`
- Modify: `src/app/api/analyze/route.ts`

**Interfaces:**
- Consumes: Task 5 의 `mapContentToSlots` 반환 필드 `replayed`, `liveCalls`, `mode`
- Produces: 없음. 마지막 작업이다.

- [ ] **Step 1: `run` 경로에 메타를 더한다**

`src/app/api/run/route.ts` 의 `X-Run-Summary` 조립을 고친다. `res.file` 의 해시를 계산해 넣는다. import 에 `createHash` 를 더한다.

```ts
import { createHash } from "node:crypto";
```

요약 객체를 고친다.

```ts
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
            // 재현 메타 — 같은 입력으로 다시 돌렸을 때 이 해시가 같아야 한다.
            mode: mapped.mode,
            replayed: mapped.replayed,
            liveCalls: mapped.liveCalls,
            // 실패로 비워둔 칸. 개수만 있으면 무엇이 빠졌는지 사용자가 알 수 없다.
            droppedIds: mapped.droppedIds,
            outputSha256: createHash("sha256").update(new Uint8Array(res.file)).digest("hex"),
          }),
        ),
```

- [ ] **Step 2: `analyze` 경로에 메타를 더한다**

`src/app/api/analyze/route.ts` 의 두 응답 객체에 같은 세 필드를 더한다. 소요 시간 필드는 남기되, 재현 비교 대상이 아님을 주석으로 밝힌다.

```ts
      // dissectMs·mapMs 는 측정값이므로 실행마다 다르다. 재현성 비교에서 제외한다.
      mode: mapped.mode,
      replayed: mapped.replayed,
      liveCalls: mapped.liveCalls,
      droppedIds: mapped.droppedIds,
```

`mapped` 가 없는 첫 응답에는 `mode: reproMode()` 만 넣고, import 를 더한다.

```ts
import { reproMode } from "@/lib/ai/snapshot";
```

- [ ] **Step 3: 빌드가 통과하는지 본다**

Run: `npm run build`

Expected: 빌드 성공. `node:crypto` 는 Node 런타임에서 동작하며 두 경로 모두 `maxDuration` 을 선언한 Node 함수다.

- [ ] **Step 4: 배포본에서 strict 모드를 확인한다**

Vercel 프로젝트 환경변수에 `REPRO_MODE=strict` 를 넣고 배포한 뒤, 기록된 양식과 자료로 한 번 돌린다. 응답 헤더의 `replayed` 가 청크 수와 같고 `liveCalls` 가 0이어야 한다. 같은 입력으로 두 번 돌려 `outputSha256` 이 같은지 확인한다.

이것이 발표 장면의 실제 리허설이다. 사양서 §7.3 이 이 장면을 설명한다.

- [ ] **Step 5: 커밋**

```bash
git add hwpx-app/src/app/api/run/route.ts hwpx-app/src/app/api/analyze/route.ts
git commit -m "feat: report repro mode, replay counts and output hash in API metadata

Lets the demo show two runs producing the same hash without opening the
files, and makes an accidental live call in strict mode visible.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B7VmrrDgRHjWT9SCqZB3BW"
```

---

## 완료 판정

전부 끝났다면 아래가 성립한다.

- `npm test` 가 종료 코드 0 으로 끝난다. API 호출은 일어나지 않는다.
- `npx tsx scripts/repro-check.ts` 가 두 실행의 일치와 커밋된 골든 해시와의 일치를 함께 출력한다.
- `scripts/fixtures/expected-hashes.json` 이 커밋돼 있고, 발표에 쓰는 양식·자료 조합이 그 안에 있다.
- `prefer` 모드에서 청크가 실패하면 응답 메타의 `droppedIds` 에 비워둔 칸이 나열된다.
- `REPRO_MODE=strict` 에서 기록되지 않은 입력을 넣으면 스냅샷 키가 담긴 오류가 난다.
- `REPRO_MODE=strict` 에서 별칭 모델명을 쓰면 매핑이 시작 전에 막힌다.
- `npx tsx scripts/check.ts` 의 항등 검사가 이전과 같이 통과한다.
- 배포본에서 같은 입력을 두 번 넣어 얻은 `outputSha256` 이 같다.

## 사양서에서 다루지 않은 채 남는 것

사양서 §10 의 열린 문제 중 둘은 이 계획이 닫지 않는다. 의도한 것이다.

- **열린 문제 2, Upstage 가 `seed` 를 존중하는가.** Task 2 가 seed 를 보내지만 존중 여부는 확인하지 않는다. 재현성을 여기에 걸지 않았으므로 막히는 일이 없다. 확인하려면 `REPRO_MODE=off` 로 같은 입력을 두 번 호출해 응답을 비교하면 된다. 시간이 남을 때 한다.
- **열린 문제 4, 어느 양식까지 기록할지.** Task 6 이 기본 픽스처 한 쌍을 기록한다. 발표에 쓰는 양식과 자료가 그것과 다르면 인자를 주고 한 번 더 돌려야 한다. 발표 전 반드시 확인할 항목이다.
