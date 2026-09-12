/**
 * hwpx 컨테이너 계층 — ZIP 해체/재포장.
 *
 * hwpx는 OCF 규약을 따르므로 `mimetype` 엔트리가 반드시 첫 번째이며 무압축(STORE)
 * 이어야 한다. 일반 ZIP 라이브러리로 무심코 재압축하면 한글이 파일을 열지 못한다.
 * 그 규약을 여기서 강제한다.
 *
 * fflate의 unzipSync는 엔트리 순서와 압축 방식을 알려주지 않으므로, 중앙 디렉터리를
 * 직접 훑어서 원본의 순서·압축 방식을 그대로 복원한다.
 */
import { unzipSync, zipSync } from "fflate";

export interface Entry {
  name: string;
  /** ZIP 압축 방식 코드. 0 = STORE(무압축), 8 = DEFLATE */
  method: number;
}

export interface Container {
  /** 원본에서의 엔트리 순서와 압축 방식 */
  entries: Entry[];
  files: Record<string, Uint8Array>;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

/** 중앙 디렉터리를 읽어 엔트리 순서와 압축 방식을 뽑는다. */
function readDirectory(buf: Uint8Array): Entry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // EOCD를 뒤에서부터 찾는다 (주석 최대 65535 + 헤더 22)
  let eocd = -1;
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP 중앙 디렉터리를 찾을 수 없습니다 (hwpx 파일이 아닌 것 같습니다)");

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder("utf-8");
  const out: Entry[] = [];

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== CEN_SIG) break;
    const method = dv.getUint16(p + 10, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** hwpx인지 검사한다. `.hwp`(구버전 바이너리)를 올린 경우를 여기서 잡는다. */
export function assertHwpx(buf: Uint8Array): void {
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error(
      "hwpx 파일이 아닙니다. 구버전 한글 문서(.hwp)로 보입니다. " +
        "한글에서 [다른 이름으로 저장] → 파일 형식을 'HWPX 문서'로 선택해 저장한 뒤 다시 올려주세요.",
    );
  }
}

export function readContainer(buf: Uint8Array): Container {
  assertHwpx(buf);
  const entries = readDirectory(buf);
  const files = unzipSync(buf) as Record<string, Uint8Array>;

  const mimetype = files["mimetype"];
  if (!mimetype) throw new Error("mimetype 엔트리가 없습니다 — hwpx 컨테이너가 아닙니다.");

  return { entries, files };
}

/**
 * 원본의 엔트리 순서와 압축 방식을 그대로 유지하여 재포장한다.
 * mimetype이 선두·무압축인지 마지막으로 한 번 더 확인한다.
 */
export function writeContainer(c: Container): Uint8Array {
  const ordered = [...c.entries];
  const mi = ordered.findIndex((e) => e.name === "mimetype");
  if (mi < 0) throw new Error("mimetype 엔트리가 없습니다.");
  if (mi !== 0) {
    // 원본이 규약을 어겼더라도 우리가 내보내는 파일은 규약을 지킨다
    const [m] = ordered.splice(mi, 1);
    ordered.unshift(m);
  }

  const payload: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const e of ordered) {
    const data = c.files[e.name];
    if (!data) throw new Error(`엔트리 누락: ${e.name}`);
    // mimetype은 무조건 STORE. 나머지는 원본 압축 방식을 따른다.
    const level = e.name === "mimetype" || e.method === 0 ? 0 : 6;
    payload[e.name] = [data, { level: level as 0 | 6 }];
  }

  return zipSync(payload);
}

/** `content.hpf` 매니페스트에서 본문 section 파일 목록을 순서대로 뽑는다. */
export function sectionNames(c: Container): string[] {
  const hpf = c.files["Contents/content.hpf"];
  if (hpf) {
    const text = new TextDecoder("utf-8").decode(hpf);
    const found: string[] = [];
    const re = /href="([^"]*section\d+\.xml)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const name = m[1].replace(/^\.\//, "");
      const full = name.includes("/") ? name : `Contents/${name}`;
      if (c.files[full] && !found.includes(full)) found.push(full);
    }
    if (found.length) return found;
  }
  // 매니페스트를 못 읽으면 이름 규칙으로 대체
  return Object.keys(c.files)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)/)![1]);
      const nb = Number(b.match(/(\d+)/)![1]);
      return na - nb;
    });
}
