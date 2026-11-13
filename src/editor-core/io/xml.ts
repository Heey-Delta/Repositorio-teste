// XML: escapar na escrita e um leitor pequeno e tolerante (para os arquivos do Office e HTML simples).

export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; text: string }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };
export const unesc = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g: string) => g[0] === '#' ? String.fromCodePoint(g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)) : ENT[g.toLowerCase()] ?? m);

const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'col', 'area', 'base', 'source', 'wbr']);

/** Lê XML (ou HTML simples, com html: true) numa árvore. Texto vai em nós "#text". */
export function parseXml(src: string, html = false): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!(?:DOCTYPE|doctype)[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  const skip = html ? new Set(['script', 'style', 'head']) : new Set<string>();
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push({ name: '#text', attrs: {}, children: [], text: m[1] });
    else if (m[2]) {
      const name = html ? m[2].toLowerCase() : m[2];
      const i = stack.map((x) => x.name).lastIndexOf(name);
      if (i > 0) stack.length = i;
    } else if (m[3]) {
      const name = html ? m[3].toLowerCase() : m[3];
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(/([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[html ? a[1].toLowerCase() : a[1]] = unesc(a[3] ?? a[4] ?? a[5] ?? '');
      const node: XNode = { name, attrs, children: [], text: '' };
      if (skip.has(name)) { const close = src.toLowerCase().indexOf(`</${name}`, re.lastIndex); re.lastIndex = close < 0 ? src.length : src.indexOf('>', close) + 1; continue; }
      top.children.push(node);
      if (!m[5] && !(html && VOID.has(name))) stack.push(node);
    } else if (m[6] !== undefined) top.children.push({ name: '#text', attrs: {}, children: [], text: unesc(m[6]) });
  }
  return root;
}

const local = (n: string) => n.slice(n.indexOf(':') + 1);
/** Filhos diretos com o nome (ignora o prefixo do espaço de nomes: "w:p" casa com "p"). */
export const kids = (n: XNode | undefined, name?: string) => (n?.children ?? []).filter((c) => c.name !== '#text' && (!name || local(c.name) === name));
export const kid = (n: XNode | undefined, name: string) => kids(n, name)[0];
/** Todos os descendentes com o nome, em ordem. */
export function all(n: XNode | undefined, name: string, out: XNode[] = []): XNode[] { for (const c of n?.children ?? []) { if (local(c.name) === name) out.push(c); all(c, name, out); } return out; }
export const attr = (n: XNode | undefined, name: string) => { if (!n) return undefined; for (const [k, v] of Object.entries(n.attrs)) if (local(k) === name) return v; return undefined; };
/** Texto de todo o nó (concatenado). */
export const textContent = (n: XNode): string => n.name === '#text' ? n.text : n.children.map(textContent).join('');
