/**
 * 오프셋을 보존하는 최소 XML 파서.
 *
 * 일반 XML 라이브러리를 쓰지 않는 이유: 파싱 후 재직렬화하면 속성 순서, self-closing
 * 형태, 공백, 엔티티 표기가 원본과 달라진다. 우리는 "무엇을 건드리지 않았는지"를
 * 바이트로 증명해야 하므로, 읽기는 파싱하되 쓰기는 원본 문자열의 구간 교체로만 한다.
 * 그래서 모든 노드가 원본 문자열에서의 위치를 들고 있어야 한다.
 *
 * hwpx의 section XML은 기계 생성물이라 형태가 규칙적이다(속성은 항상 큰따옴표,
 * 주석·CDATA·DTD 없음). 그 전제 위에서 동작한다.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  /** 여는 태그의 '<' 위치 */
  start: number;
  /** 닫는 태그의 '>' 다음 위치 (self-closing이면 그 태그의 끝) */
  end: number;
  /** 여는 태그의 '>' 다음 위치 = 자식 영역의 시작 */
  innerStart: number;
  /** 닫는 태그의 '<' 위치 = 자식 영역의 끝 (self-closing이면 innerStart와 같음) */
  innerEnd: number;
  selfClosing: boolean;
  children: XmlNode[];
  parent: XmlNode | null;
}

const TAG =
  /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(raw))) out[m[1]] = m[2];
  return out;
}

/** XML 문서를 노드 트리로 파싱한다. 최상위 노드 배열을 돌려준다. */
export function parseXml(xml: string): XmlNode[] {
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = TAG.exec(xml))) {
    const [full, closing, name, rawAttrs, selfClose] = m;
    const start = m.index;
    const afterTag = start + full.length;

    if (closing) {
      // 닫는 태그: 스택에서 같은 이름을 찾아 닫는다 (형식이 깨진 경우 방어)
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          const node = stack[i];
          node.innerEnd = start;
          node.end = afterTag;
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const node: XmlNode = {
      name,
      attrs: parseAttrs(rawAttrs),
      start,
      end: afterTag,
      innerStart: afterTag,
      innerEnd: afterTag,
      selfClosing: selfClose === "/",
      children: [],
      parent: stack.length ? stack[stack.length - 1] : null,
    };

    if (node.parent) node.parent.children.push(node);
    else roots.push(node);

    if (!node.selfClosing) stack.push(node);
  }

  return roots;
}

/** 이름이 일치하는 후손을 전부 모은다 (자기 자신 제외). */
export function findAll(
  nodes: XmlNode[] | XmlNode,
  name: string,
  out: XmlNode[] = [],
): XmlNode[] {
  const list = Array.isArray(nodes) ? nodes : nodes.children;
  for (const n of list) {
    if (n.name === name) out.push(n);
    if (n.children.length) findAll(n, name, out);
  }
  return out;
}

/** 이름이 일치하는 직계 자식만 모은다. */
export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

/** 이름이 일치하는 첫 후손. */
export function findFirst(node: XmlNode, name: string): XmlNode | null {
  for (const c of node.children) {
    if (c.name === name) return c;
    const deep = findFirst(c, name);
    if (deep) return deep;
  }
  return null;
}

/**
 * 후손 중 name에 해당하는 노드를 찾되, stopAt에 속한 서브트리는 내려가지 않는다.
 * 중첩 표(hp:tbl 안의 hp:tbl)를 바깥 표의 내용으로 오인하지 않기 위해 필요하다.
 */
export function findAllExcluding(
  node: XmlNode,
  name: string,
  stopAt: string,
  out: XmlNode[] = [],
): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    if (c.name === stopAt) continue;
    if (c.children.length) findAllExcluding(c, name, stopAt, out);
  }
  return out;
}

export function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&"); // 반드시 마지막
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;") // 반드시 처음
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 노드 아래의 모든 <hp:t> 텍스트를 이어붙인다. */
export function textOf(xml: string, node: XmlNode, exclude?: string): string {
  const ts = exclude
    ? findAllExcluding(node, "hp:t", exclude)
    : findAll(node, "hp:t");
  return ts.map((t) => unescapeXml(xml.slice(t.innerStart, t.innerEnd))).join("");
}
