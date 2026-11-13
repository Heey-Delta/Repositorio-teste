// B1 · Recursos de processador de texto que faltavam (categoria Word):
//   Listas: LIST_SET_FORMAT (formato por nível: 1, a, A, i, I, •…) · LIST_RESTART · LIST_CONTINUE · LIST_LABELS
//   Parágrafos: SORT_PARAGRAPHS (A→Z, Z→A, número, data) · SELECT_SIMILAR (mesma formatação)
//   Estilos: INSTALL_BUILTIN_STYLES (Normal, Título, Título 1–6, Citação…) · LIST_STYLES · STYLE_INSPECTOR
//   Caracteres: SPECIAL_CHARACTERS (travessão, espaço inseparável, ©…) e as novas propriedades em format.ts
//   (sublinhado duplo/ondulado, versalete, contorno, sombra, escala, oculto, kerning, idioma, tabulações, capitular,
//   manter com o próximo, linhas juntas, quebra de página antes, controle de viúvas e órfãs, nível de tópico).
import type { DocumentModel, EditorNode, Style } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { clone, equal, fail } from '../util.ts';
import { validateProps, resolveStyle } from './format.ts';
import { setSelection } from './selection.ts';
import { textOf } from './text.ts';
import { createNode } from './basic.ts';

// ---------------------------------------------------------------- numeração
export const NUMBER_FORMATS = ['DECIMAL', 'DECIMAL_ZERO', 'LOWER_ALPHA', 'UPPER_ALPHA', 'LOWER_ROMAN', 'UPPER_ROMAN', 'ORDINAL', 'DISC', 'CIRCLE', 'SQUARE', 'DASH', 'ARROW', 'CHECK', 'NONE'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
const BULLETS: Partial<Record<NumberFormat, string>> = { DISC: '•', CIRCLE: '◦', SQUARE: '▪', DASH: '–', ARROW: '➢', CHECK: '✓', NONE: '' };

export function roman(n: number) {
  if (n <= 0 || n >= 4000) return String(n);
  const t: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of t) while (n >= v) { out += s; n -= v; }
  return out;
}
/** 1 → a, 26 → z, 27 → aa (como no Word). */
export function alpha(n: number) {
  if (n <= 0) return String(n);
  const letter = String.fromCharCode(97 + ((n - 1) % 26));
  return letter.repeat(Math.floor((n - 1) / 26) + 1);
}
export function formatNumber(n: number, f: NumberFormat): string {
  if (f in BULLETS) return BULLETS[f]!;
  if (f === 'DECIMAL_ZERO') return String(n).padStart(2, '0');
  if (f === 'LOWER_ALPHA') return alpha(n);
  if (f === 'UPPER_ALPHA') return alpha(n).toUpperCase();
  if (f === 'LOWER_ROMAN') return roman(n).toLowerCase();
  if (f === 'UPPER_ROMAN') return roman(n);
  if (f === 'ORDINAL') return `${n}º`;
  return String(n);
}
/** Formato padrão por nível numa lista de vários níveis: 1. → a. → i. → 1. … */
const MULTI: NumberFormat[] = ['DECIMAL', 'LOWER_ALPHA', 'LOWER_ROMAN'];
const BULLET_LEVELS: NumberFormat[] = ['DISC', 'CIRCLE', 'SQUARE'];

function levelFormat(list: EditorNode, level: number): NumberFormat {
  const per = list.data.levelFormats as NumberFormat[] | undefined;
  if (per?.[level]) return per[level];
  if (list.data.listType === 'BULLET') return level === 0 && list.data.numberFormat && list.data.numberFormat in BULLETS ? list.data.numberFormat : BULLET_LEVELS[level % 3];
  if (level === 0 && list.data.numberFormat && !(list.data.numberFormat in BULLETS)) return list.data.numberFormat;
  return list.data.listType === 'MULTILEVEL' ? 'DECIMAL' : MULTI[level % 3];
}

/** Lista anterior da qual esta continua a numeração (LIST_CONTINUE), para somar os itens. */
function previousCount(doc: DocumentModel, list: EditorNode, seen = new Set<string>()): number[] {
  const from = list.data.continueFrom ? doc.nodes[list.data.continueFrom] : undefined;
  if (!from || from.type !== 'LIST' || seen.has(from.id)) return [];
  seen.add(from.id);
  const base = previousCount(doc, from, seen);
  const counters = base.length ? [...base] : [(from.data.start ?? 1) - 1];
  for (const id of from.children) { const lv = doc.nodes[id]?.data.level ?? 0; counters.length = lv + 1; counters[lv] = (counters[lv] ?? 0) + 1; }
  return counters;
}

/** Rótulo de cada item ("1.", "a)", "1.2.", "•"), respeitando formatos por nível, início e continuação. */
export function listLabels(e: Engine, listId: string): Record<string, string> {
  if (e.get(listId).type !== 'LIST') fail('INVALID_OPERATION', `${listId} não é uma lista.`);
  return listLabelsIn(e.doc, listId);
}
/** Mesma coisa direto do documento (usado pelos exportadores e pela tela). */
export function listLabelsIn(doc: DocumentModel, listId: string): Record<string, string> {
  const list = doc.nodes[listId];
  const cont = previousCount(doc, list);
  const counters: number[] = cont.length ? cont : [];
  const out: Record<string, string> = {};
  let first = !cont.length;
  for (const id of list.children) {
    const lv = doc.nodes[id]?.data.level ?? 0;
    counters.length = lv + 1;
    counters[lv] = counters[lv] === undefined ? (lv === 0 && first ? list.data.start ?? 1 : 1) : counters[lv] + 1;
    first = false;
    const f = levelFormat(list, lv);
    if (f in BULLETS) { out[id] = formatNumber(1, f); continue; }
    const sep = list.data.separator ?? '.';
    out[id] = list.data.listType === 'MULTILEVEL'
      ? `${counters.map((c, i) => formatNumber(c ?? 1, levelFormat(list, i))).join('.')}${sep}`
      : `${formatNumber(counters[lv], f)}${sep}`;
  }
  return out;
}

const listOf = (e: Engine, id: string | null | undefined): EditorNode => {
  const n = e.get(id);
  const l = n.type === 'LIST' ? n : n.type === 'LIST_ITEM' ? e.get(n.parentId) : e.find(e.get(n.parentId).parentId);
  if (!l || l.type !== 'LIST') return fail('INVALID_OPERATION', `${id} não está numa lista.`);
  return l;
};

// ---------------------------------------------------------------- estilos prontos
type Builtin = { name: string; type: Style['type']; properties: Record<string, unknown> };
export const BUILTIN_STYLES: Builtin[] = [
  { name: 'Normal', type: 'TEXT', properties: { fontSize: 11, lineHeight: 1.15, spaceAfter: 8 } },
  { name: 'Sem espaçamento', type: 'TEXT', properties: { spaceBefore: 0, spaceAfter: 0, lineHeight: 1 } },
  { name: 'Título', type: 'TEXT', properties: { fontSize: 28, spaceAfter: 4, outlineLevel: 1, keepWithNext: true } },
  { name: 'Subtítulo', type: 'TEXT', properties: { fontSize: 15, color: '#5A5A5A', spaceAfter: 8 } },
  ...[1, 2, 3, 4, 5, 6].map((n): Builtin => ({ name: `Título ${n}`, type: 'TEXT', properties: { fontSize: [20, 16, 14, 12, 11, 11][n - 1], bold: n !== 5, italic: n === 6, spaceBefore: [24, 18, 14, 12, 10, 10][n - 1], spaceAfter: 6, outlineLevel: n, keepWithNext: true, keepTogether: true } })),
  { name: 'Citação', type: 'TEXT', properties: { italic: true, color: '#404040', indentLeft: 36, indentRight: 36, align: 'CENTER' } },
  { name: 'Citação intensa', type: 'TEXT', properties: { italic: true, bold: true, indentLeft: 36, indentRight: 36, align: 'CENTER', border: { top: { width: 1, style: 'SOLID', color: '#808080' }, bottom: { width: 1, style: 'SOLID', color: '#808080' } } } },
  { name: 'Legenda', type: 'TEXT', properties: { fontSize: 9, italic: true, color: '#5A5A5A', spaceAfter: 10 } },
  { name: 'Código', type: 'TEXT', properties: { fontFamily: 'Consolas, monospace', fontSize: 10, fill: '#F2F2F2', spaceAfter: 0, noProof: true } },
  { name: 'Ênfase', type: 'TEXT', properties: { italic: true } },
  { name: 'Ênfase intensa', type: 'TEXT', properties: { italic: true, bold: true } },
  { name: 'Referência sutil', type: 'TEXT', properties: { smallCaps: true, color: '#5A5A5A' } },
  { name: 'Parágrafo da lista', type: 'TEXT', properties: { indentLeft: 36, spaceAfter: 0 } },
];

// ---------------------------------------------------------------- caracteres especiais
export const SPECIAL_CHARACTERS: [string, string][] = [
  ['—', 'Travessão'], ['–', 'Meia-risca'], [' ', 'Espaço inseparável'], ['‑', 'Hífen inseparável'], ['­', 'Hífen opcional'],
  [' ', 'Espaço eme'], [' ', 'Espaço ene'], [' ', 'Espaço fino'], ['​', 'Sem largura (quebra opcional)'],
  ['©', 'Direitos autorais'], ['®', 'Marca registrada'], ['™', 'Marca comercial'], ['§', 'Seção'], ['¶', 'Parágrafo'],
  ['…', 'Reticências'], ['‘', 'Aspa simples de abertura'], ['’', 'Aspa simples de fechamento'], ['“', 'Aspa dupla de abertura'], ['”', 'Aspa dupla de fechamento'],
  ['«', 'Aspa angular de abertura'], ['»', 'Aspa angular de fechamento'], ['°', 'Grau'], ['º', 'Ordinal masculino'], ['ª', 'Ordinal feminino'],
  ['±', 'Mais ou menos'], ['×', 'Multiplicação'], ['÷', 'Divisão'], ['≠', 'Diferente'], ['≤', 'Menor ou igual'], ['≥', 'Maior ou igual'], ['∞', 'Infinito'],
  ['€', 'Euro'], ['£', 'Libra'], ['¥', 'Iene'], ['¢', 'Centavo'], ['→', 'Seta'], ['•', 'Marcador'],
];

// ---------------------------------------------------------------- ordenação
const sortKey = (by: string, t: string): number | string => {
  if (by === 'NUMBER') { const m = t.replace(/\./g, '').replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : Number.POSITIVE_INFINITY; }
  if (by === 'DATE') {
    const br = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (br) return new Date(Number(br[3].length === 2 ? `20${br[3]}` : br[3]), Number(br[2]) - 1, Number(br[1])).getTime();
    const iso = Date.parse(t); return Number.isNaN(iso) ? Number.POSITIVE_INFINITY : iso;
  }
  return t.trim();
};

export const wordHandlers: Record<string, Handler> = {
  /** LIST_SET_FORMAT { numberFormat?, levelFormats?: [nível0, nível1…], listType?, separator?: "." | ")" | "" } */
  LIST_SET_FORMAT: (e, op) => {
    const list = listOf(e, op.targetId);
    e.assertEditable(list.id);
    const p = op.payload ?? {};
    const check = (f: unknown) => { if (!NUMBER_FORMATS.includes(f as NumberFormat)) fail('VALIDATION', `Formato de número: ${NUMBER_FORMATS.join(', ')}.`); };
    if (p.numberFormat !== undefined) check(p.numberFormat);
    if (p.levelFormats !== undefined && p.levelFormats !== null) { if (!Array.isArray(p.levelFormats) || p.levelFormats.length > 9) fail('VALIDATION', 'levelFormats: até 9 formatos, um por nível.'); p.levelFormats.forEach(check); }
    if (p.listType !== undefined && !['BULLET', 'NUMBERED', 'MULTILEVEL'].includes(p.listType)) fail('VALIDATION', 'Lista: BULLET, NUMBERED ou MULTILEVEL.');
    if (p.separator !== undefined && !['.', ')', '', ' -', ':'].includes(p.separator)) fail('VALIDATION', 'Separador: ".", ")", ":", " -" ou vazio.');
    const n = e.touchNode(list.id);
    for (const k of ['numberFormat', 'levelFormats', 'listType', 'separator'] as const) { if (p[k] === null) delete n.data[k]; else if (p[k] !== undefined) n.data[k] = clone(p[k]); }
    return listLabels(e, list.id);
  },

  /** Reinicia a numeração. Num item do meio, a lista é dividida e a parte de baixo começa em `start` (padrão 1). */
  LIST_RESTART: (e, op) => {
    const target = e.get(op.targetId);
    const list = listOf(e, op.targetId);
    e.assertEditable(list.id);
    const start = op.payload?.start ?? 1;
    if (!Number.isInteger(start) || start < 0) fail('VALIDATION', 'O início precisa ser um número inteiro ≥ 0.');
    const item = target.type === 'LIST_ITEM' ? target : target.type === 'TEXT' ? e.get(target.parentId) : null;
    const idx = item ? list.children.indexOf(item.id) : 0;
    if (idx <= 0) { const n = e.touchNode(list.id); n.data.start = start; delete n.data.continueFrom; return list.id; }
    // divide: cria uma lista nova logo depois e move os itens de baixo para ela
    const parentId = list.parentId!;
    const moving = list.children.slice(idx);
    const data: Record<string, any> = { ...clone(list.data), start }; delete data.continueFrom;
    const newId = createNode(e, { parentId, nodeType: 'LIST', data, layout: clone(list.layout), index: e.get(parentId).children.indexOf(list.id) + 1 }).id;
    const nn = e.touchNode(newId); nn.styleId = list.styleId; nn.styleOverrides = clone(list.styleOverrides);
    e.touchNode(list.id).children = list.children.slice(0, idx);
    e.touchNode(newId).children = moving;
    for (const id of moving) e.touchNode(id).parentId = newId;
    e.normalizeOrder(parentId); e.normalizeOrder(list.id); e.normalizeOrder(newId);
    return newId;
  },

  /** Continua a numeração da lista anterior (do mesmo nível do documento), como "Continuar numeração" no Word. */
  LIST_CONTINUE: (e, op) => {
    const list = listOf(e, op.targetId);
    e.assertEditable(list.id);
    let from = op.payload?.fromId as string | undefined;
    if (!from) {
      const sib = e.get(list!.parentId).children;
      from = sib.slice(0, sib.indexOf(list!.id)).reverse().find((id) => e.get(id).type === 'LIST');
    }
    if (!from) fail('NOT_FOUND', 'Não há lista anterior para continuar a numeração.');
    if (from === list.id) fail('INVALID_OPERATION', 'A lista não pode continuar dela mesma.');
    e.touchNode(list.id).data.continueFrom = from;
    return listLabels(e, list.id);
  },

  LIST_LABELS: (e, op) => listLabels(e, listOf(e, op.targetId).id),

  /** Classifica parágrafos (ou itens de lista) de um mesmo pai. SORT_PARAGRAPHS { ids?, by: TEXT|NUMBER|DATE, order: ASC|DESC } */
  SORT_PARAGRAPHS: (e, op) => {
    const p = op.payload ?? {};
    const by = p.by ?? 'TEXT', order = p.order ?? 'ASC';
    if (!['TEXT', 'NUMBER', 'DATE'].includes(by)) fail('VALIDATION', 'Classificar por TEXT, NUMBER ou DATE.');
    if (!['ASC', 'DESC'].includes(order)) fail('VALIDATION', 'Ordem: ASC ou DESC.');
    const ids: string[] = p.ids ?? (op.targetId ? e.get(op.targetId).children : e.state.selection.selectedIds);
    if (ids.length < 2) return ids;
    const parentId = e.get(ids[0]).parentId!;
    if (ids.some((id) => e.get(id).parentId !== parentId)) fail('INVALID_OPERATION', 'Só dá para classificar parágrafos do mesmo bloco.');
    for (const id of ids) e.assertEditable(id);
    const text = (id: string) => { const n = e.get(id); return n.type === 'TEXT' ? textOf(n) : n.children.map((c) => (e.get(c).type === 'TEXT' ? textOf(e.get(c)) : '')).join(' '); };
    const coll = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
    const sorted = [...ids].sort((a, b) => {
      const ka = sortKey(by, text(a)), kb = sortKey(by, text(b));
      const r = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : coll.compare(String(ka), String(kb));
      return order === 'ASC' ? r : -r;
    });
    const parent = e.touchNode(parentId);
    const slots = ids.map((id) => parent.children.indexOf(id)).sort((a, b) => a - b);
    slots.forEach((slot, i) => { parent.children[slot] = sorted[i]; });
    e.normalizeOrder(parentId);
    return sorted;
  },

  /** Seleciona todos os textos com a mesma formatação (mesmo estilo, tipo e ajustes) do alvo. */
  SELECT_SIMILAR: (e, op) => {
    const ref = e.get(op.targetId ?? e.state.selection.primaryId);
    const key = (n: EditorNode) => [n.type, n.data.textType ?? null, n.styleId, n.styleOverrides];
    const k0 = key(ref);
    const ids = Object.values(e.doc.nodes).filter((n) => equal(key(n), k0)).map((n) => n.id);
    setSelection(e, ids, ref.id);
    return ids;
  },

  /** Cria os estilos prontos que ainda não existem (pelo nome). Devolve { nome: id }. */
  INSTALL_BUILTIN_STYLES: (e, op) => {
    const only: string[] | undefined = op.payload?.names;
    const byName = new Map(Object.values(e.doc.styles).map((s) => [s.name, s.id]));
    const out: Record<string, string> = {};
    for (const b of BUILTIN_STYLES) {
      if (only && !only.includes(b.name)) continue;
      if (byName.has(b.name)) { out[b.name] = byName.get(b.name)!; continue; }
      validateProps(b.type, b.properties);
      const id = e.newId('STYLE');
      e.put('styles', id, { id, name: b.name, type: b.type, properties: clone(b.properties), builtin: true } as Style);
      out[b.name] = id;
    }
    return out;
  },

  /** Estilos do documento com quantos objetos usam cada um. */
  LIST_STYLES: (e) => {
    const use = new Map<string, number>();
    for (const n of Object.values(e.doc.nodes)) if (n.styleId) use.set(n.styleId, (use.get(n.styleId) ?? 0) + 1);
    return Object.values(e.doc.styles).map((s) => ({ id: s.id, name: s.name, type: s.type, builtin: Boolean((s as any).builtin), uses: use.get(s.id) ?? 0 }));
  },

  /** "Inspetor de estilos": de onde vem cada propriedade do objeto (tema, estilo ou ajuste próprio). */
  STYLE_INSPECTOR: (e, op) => {
    const n = e.get(op.targetId);
    const style = n.styleId ? e.doc.styles[n.styleId] : undefined;
    const final = resolveStyle(e, n.id);
    return Object.fromEntries(Object.entries(final).map(([k, v]) => [k, { value: v, from: k in n.styleOverrides ? 'DIRECT' : style && k in style.properties ? `STYLE:${style.name}` : 'THEME' }]));
  },

  SPECIAL_CHARACTERS: () => SPECIAL_CHARACTERS.map(([char, name]) => ({ char, name, code: `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` })),
};
