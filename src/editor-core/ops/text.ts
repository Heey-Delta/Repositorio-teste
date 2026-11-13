// Texto (categoria 01/02/12): o parágrafo é UM elemento TEXT; os trechos com formatação diferente são "runs".
//   data.runs = [{ id, text: 'Meu primeiro ', format: {} }, { id, text: 'documento', format: { bold: true } }]
// Operações por posição de caractere: TEXT_SET · TEXT_INSERT · TEXT_DELETE · TEXT_FORMAT · CHANGE_CASE.
// Em todo o documento: FIND · REPLACE · TEXT_STATS (contagem de palavras e caracteres).
import type { EditorNode } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { validateProps } from './format.ts';
import { clone, equal, fail, merge } from '../util.ts';
import { shiftAnchors } from '../anchors.ts';

export interface Run { id: string; text: string; format: Record<string, unknown> }

export const textOf = (n: EditorNode) => ((n.data.runs ?? []) as Run[]).map((r) => r.text).join('');

/** Junta trechos vizinhos com a mesma formatação e tira os vazios (fica sempre pelo menos um). */
function normalize(e: Engine, runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text && runs.length > 1) continue;
    const prev = out.at(-1);
    if (prev && equal(prev.format, r.format)) prev.text += r.text;
    else out.push({ ...r, format: { ...r.format } });
  }
  return out.length ? out : [{ id: e.newId('RUN'), text: '', format: { ...(runs[0]?.format ?? {}) } }];
}

/** Corta os trechos para que `pos` caia exatamente numa fronteira; devolve o índice do trecho que começa em `pos`. */
function splitAt(e: Engine, runs: Run[], pos: number): number {
  let acc = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (pos === acc) return i;
    if (pos < acc + r.text.length) {
      const cut = pos - acc;
      runs.splice(i, 1, { ...r, text: r.text.slice(0, cut) }, { id: e.newId('RUN'), text: r.text.slice(cut), format: { ...r.format } });
      return i + 1;
    }
    acc += r.text.length;
  }
  return runs.length;
}

function textNode(e: Engine, id: string | null | undefined) {
  const n = e.get(id);
  if (!['TEXT', 'NOTE', 'CAPTION', 'CITATION'].includes(n.type) || !Array.isArray(n.data.runs)) fail('INVALID_OPERATION', `${n.id} não é um texto.`);
  e.assertEditable(n.id);
  return e.touchNode(n.id);
}

function range(n: EditorNode, start?: number, end?: number) {
  const len = textOf(n).length;
  const s = Math.max(0, Math.min(start ?? 0, len)), en = Math.max(s, Math.min(end ?? len, len));
  return [s, en] as const;
}

export function insertText(e: Engine, n: EditorNode, offset: number, text: string, format?: Record<string, unknown>) {
  const runs = clone(n.data.runs as Run[]);
  const [at] = range(n, offset, offset);
  const i = splitAt(e, runs, at);
  const inherit = (runs[i - 1] ?? runs[i] ?? { format: {} }).format;   // herda a formatação de quem está antes do cursor
  runs.splice(i, 0, { id: e.newId('RUN'), text, format: format ? merge(inherit, format) : { ...inherit } });
  n.data.runs = normalize(e, runs);
  shiftAnchors(e, n.id, at, text.length);
}

export function deleteText(e: Engine, n: EditorNode, start: number, end: number) {
  const runs = clone(n.data.runs as Run[]);
  const [s, en] = range(n, start, end);
  const a = splitAt(e, runs, s), b = splitAt(e, runs, en);
  const fmt = runs[a]?.format ?? runs[a - 1]?.format ?? {};
  runs.splice(a, b - a);
  n.data.runs = normalize(e, runs.length ? runs : [{ id: e.newId('RUN'), text: '', format: fmt }]);
  shiftAnchors(e, n.id, s, s - en);
}

const caseOf = (mode: string, t: string) => {
  if (mode === 'UPPER') return t.toLocaleUpperCase('pt-BR');
  if (mode === 'LOWER') return t.toLocaleLowerCase('pt-BR');
  if (mode === 'TITLE') return t.toLocaleLowerCase('pt-BR').replace(/(^|\s)(\p{L})/gu, (_, sp, c) => sp + c.toLocaleUpperCase('pt-BR'));
  if (mode === 'SENTENCE') return t.toLocaleLowerCase('pt-BR').replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, sp, c) => sp + c.toLocaleUpperCase('pt-BR'));
  return fail('INVALID_PAYLOAD', 'Modo: UPPER, LOWER, TITLE ou SENTENCE.');
};

export interface Match { nodeId: string; start: number; end: number; text: string; cell?: string }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pattern(query: string, opts: { matchCase?: boolean; wholeWord?: boolean; regex?: boolean }) {
  if (!query) fail('INVALID_PAYLOAD', 'Digite o que procurar.');
  const body = opts.regex ? query : esc(query);
  return new RegExp(opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, `gu${opts.matchCase ? '' : 'i'}`);
}

/** Procura em textos, células de tabelas e de planilhas (dentro de `scope`, ou no documento todo). */
export function find(e: Engine, query: string, opts: { matchCase?: boolean; wholeWord?: boolean; regex?: boolean; scope?: string } = {}): Match[] {
  const re = pattern(query, opts);
  const ids = opts.scope ? [opts.scope, ...e.descendants(opts.scope)] : Object.keys(e.doc.nodes);
  const out: Match[] = [];
  const scan = (nodeId: string, text: string, cell?: string) => { for (const m of text.matchAll(re)) out.push({ nodeId, start: m.index!, end: m.index! + m[0].length, text: m[0], cell }); };
  for (const id of ids) {
    const n = e.doc.nodes[id];
    if (!n) continue;
    if (Array.isArray(n.data.runs)) scan(id, textOf(n));
    if (n.type === 'TABLE') for (const row of n.data.rows ?? []) for (const c of row.cells) if (c.value !== null && c.value !== undefined) scan(id, String(c.value), c.id);
    if (n.data.surfaceType === 'SHEET') for (const [addr, c] of Object.entries<any>(n.data.cells ?? {})) { const v = c.formula ?? c.value; if (v !== null && v !== undefined) scan(id, String(v), addr); }
  }
  return out;
}

export const textHandlers: Record<string, Handler> = {
  /** Substitui o texto inteiro (mantém a formatação do primeiro trecho). */
  TEXT_SET: (e, op) => {
    const n = textNode(e, op.targetId);
    n.data.runs = [{ id: e.newId('RUN'), text: String(op.payload?.text ?? ''), format: { ...((n.data.runs as Run[])[0]?.format ?? {}) } }];
    return textOf(n);
  },
  TEXT_INSERT: (e, op) => { const n = textNode(e, op.targetId); insertText(e, n, op.payload?.offset ?? textOf(n).length, String(op.payload?.text ?? ''), op.payload?.format); return textOf(n); },
  TEXT_DELETE: (e, op) => { const n = textNode(e, op.targetId); deleteText(e, n, op.payload?.start, op.payload?.end); return textOf(n); },

  /** Formata só um pedaço: TEXT_FORMAT { start, end, format: { bold: true } } (null remove a propriedade). */
  TEXT_FORMAT: (e, op) => {
    const n = textNode(e, op.targetId);
    const format = op.payload?.format ?? fail('INVALID_PAYLOAD', 'Informe format.');
    validateProps('TEXT', format);
    const runs = clone(n.data.runs as Run[]);
    const [s, en] = range(n, op.payload?.start, op.payload?.end);
    const a = splitAt(e, runs, s), b = splitAt(e, runs, en);
    for (let i = a; i < b; i++) runs[i].format = merge(runs[i].format, format);
    n.data.runs = normalize(e, runs);
    return n.data.runs.length;
  },

  /** Maiúsculas/minúsculas no trecho (muda o texto de verdade, não só a aparência). */
  CHANGE_CASE: (e, op) => {
    const n = textNode(e, op.targetId);
    const [s, en] = range(n, op.payload?.start, op.payload?.end);
    const runs = clone(n.data.runs as Run[]);
    const a = splitAt(e, runs, s), b = splitAt(e, runs, en);
    const joined = runs.slice(a, b).map((r) => r.text).join('');
    const changed = caseOf(op.payload?.mode, joined);
    let p = 0;
    for (let i = a; i < b; i++) { const len = runs[i].text.length; runs[i].text = changed.slice(p, p + len); p += len; }
    n.data.runs = normalize(e, runs);
    return textOf(n);
  },

  FIND: (e, op) => find(e, op.payload?.query, op.payload ?? {}),

  /** Substitui nos textos (e nas células, se cells: true). Mantém a formatação do trecho onde cada ocorrência começa. */
  REPLACE: (e, op) => {
    const { query, replacement = '', all = true, cells = false } = op.payload ?? {};
    let matches = find(e, query, op.payload ?? {});
    if (!all) matches = matches.slice(0, 1);
    const byNode = new Map<string, Match[]>();
    for (const m of matches) byNode.set(m.nodeId, [...(byNode.get(m.nodeId) ?? []), m]);
    let count = 0;
    for (const [nodeId, list] of byNode) {
      const node = e.get(nodeId);
      if (Array.isArray(node.data.runs)) {
        const n = textNode(e, nodeId);
        for (const m of list.filter((x) => !x.cell).reverse()) {
          const fmt = clone(((): Record<string, unknown> => { let acc = 0; for (const r of n.data.runs as Run[]) { if (m.start < acc + r.text.length) return r.format; acc += r.text.length; } return {}; })());
          deleteText(e, n, m.start, m.end);
          insertText(e, n, m.start, replacement);
          const runs = clone(n.data.runs as Run[]);
          const a = splitAt(e, runs, m.start), b = splitAt(e, runs, m.start + replacement.length);
          for (let i = a; i < b; i++) runs[i].format = fmt;
          n.data.runs = normalize(e, runs);
          count++;
        }
      }
      if (cells && list.some((x) => x.cell)) {
        e.assertEditable(nodeId);
        const t = e.touchNode(nodeId);
        const re = pattern(query, op.payload ?? {});
        for (const m of list.filter((x) => x.cell)) {
          if (t.type === 'TABLE') for (const row of t.data.rows) for (const c of row.cells) { if (c.id === m.cell) { c.value = String(c.value).replace(re, replacement); count++; } }
          else if (t.data.cells?.[m.cell!] && !t.data.cells[m.cell!].formula) { t.data.cells[m.cell!].value = String(t.data.cells[m.cell!].value).replace(re, replacement); count++; }
        }
      }
    }
    return count;
  },

  /** Contagem de palavras, caracteres e parágrafos (no documento ou dentro de `scope`). */
  TEXT_STATS: (e, op) => {
    const scope = op.payload?.scope;
    const ids = scope ? [scope, ...e.descendants(scope)] : Object.keys(e.doc.nodes);
    const texts = ids.map((id) => e.doc.nodes[id]).filter((n) => n && Array.isArray(n.data.runs)).map(textOf);
    const all = texts.join('\n');
    return {
      paragraphs: texts.filter((t) => t.trim()).length,
      words: (all.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length,
      characters: all.replace(/\n/g, '').length,
      charactersNoSpaces: all.replace(/\s/g, '').length,
    };
  },
};
