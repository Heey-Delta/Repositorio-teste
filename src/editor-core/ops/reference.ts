// Referências e elementos automáticos (categoria 15).
//   Campos (FIELD): página, total de páginas, data, hora, nome do documento, autor, título da seção, número do slide,
//     nome da planilha, referência cruzada, sumário (TOC), índice (INDEX) e bibliografia (BIBLIOGRAPHY).
//   Indicadores: um nome num elemento (destino de links e referências cruzadas).
//   Numeração automática: legendas por rótulo ("Figura 1", "Tabela 2"), notas de rodapé e de fim.
//   Citações e bibliografia: fontes do documento formatadas em ABNT, APA, MLA ou Chicago.
//
// fieldText(e, id, contexto) calcula o valor de qualquer campo (o número de página do cabeçalho muda a cada página,
// por isso o contexto); UPDATE_FIELDS grava no documento o que é estável (numerações, sumário, índice, bibliografia
// e campos do corpo do texto).
import { formFieldText } from './document-tools.ts';
import type { EditorNode } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { insertContent } from './content.ts';
import { paginate, pageIndex } from './page.ts';
import { textOf } from './text.ts';
import { clone, fail } from '../util.ts';

// ---------------------------------------------------------------- ordem do documento

export function documentOrder(e: Engine): string[] {
  const out: string[] = [];
  const walk = (id: string) => { out.push(id); for (const c of e.doc.nodes[id]?.children ?? []) walk(c); };
  walk(e.doc.document.rootId);
  return out;
}

const isHeaderFooter = (e: Engine, id: string) => [id, ...e.ancestors(id)].some((a) => { const n = e.find(a); return n?.type === 'REGION' && ['HEADER', 'FOOTER'].includes(n.data.regionType); });

/** Página onde um elemento aparece: o próprio nó ou o primeiro descendente paginado. */
function pageOf(e: Engine, idx: Map<string, number>, id: string): number | null {
  if (idx.has(id)) return idx.get(id)!;
  for (const d of e.descendants(id)) if (idx.has(d)) return idx.get(d)!;
  for (const a of e.ancestors(id)) if (idx.has(a)) return idx.get(a)!;
  return null;
}

// ---------------------------------------------------------------- datas

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** Formatos: dd/MM/yyyy, dd 'de' MMMM 'de' yyyy, HH:mm, HH:mm:ss, yyyy-MM-dd (padrão pt-BR). */
export function formatDate(d: Date, format = 'dd/MM/yyyy') {
  return format.replace(/'([^']*)'|yyyy|MMMM|MM|dd|HH|mm|ss/g, (m, lit) => {
    if (lit !== undefined) return lit;
    return { yyyy: String(d.getFullYear()), MMMM: MONTHS[d.getMonth()], MM: pad(d.getMonth() + 1), dd: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()) }[m]!;
  });
}

// ---------------------------------------------------------------- numerações

export interface Numbering { captions: Map<string, number>; notes: Map<string, number> }

/** Numera legendas por rótulo e notas por tipo, na ordem em que aparecem. */
export function numbering(e: Engine): Numbering {
  const captions = new Map<string, number>(), notes = new Map<string, number>();
  const byLabel = new Map<string, number>(), byNote = new Map<string, number>();
  for (const id of documentOrder(e)) {
    const n = e.doc.nodes[id];
    if (n.type === 'CAPTION') { const k = (byLabel.get(n.data.label) ?? 0) + 1; byLabel.set(n.data.label, k); captions.set(id, k); }
    if (n.type === 'NOTE' && n.data.noteType !== 'SPEAKER') { const k = (byNote.get(n.data.noteType) ?? 0) + 1; byNote.set(n.data.noteType, k); notes.set(id, k); }
  }
  return { captions, notes };
}

const roman = (n: number) => [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']].reduce((s, [v, r]) => { while (n >= (v as number)) { s += r; n -= v as number; } return s; }, '');
export const noteMark = (type: string, k: number) => (type === 'ENDNOTE' ? roman(k) : String(k));

// ---------------------------------------------------------------- indicadores

export function bookmarks(e: Engine): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of Object.values(e.doc.nodes)) if (typeof n.metadata.bookmark === 'string') out.set(n.metadata.bookmark, n.id);
  return out;
}

/** Destino de uma referência: targetId direto ou nome de indicador. */
export function resolveTarget(e: Engine, d: { targetId?: string | null; bookmark?: string | null }): EditorNode | undefined {
  if (d.targetId) return e.find(d.targetId);
  if (d.bookmark) return e.find(bookmarks(e).get(d.bookmark));
  return undefined;
}

// ---------------------------------------------------------------- citações e bibliografia

export interface Source {
  id: string;
  type: 'BOOK' | 'ARTICLE' | 'WEBSITE' | 'CHAPTER' | 'THESIS' | 'OTHER';
  authors: { given: string; family: string }[];
  title: string;
  year?: number | string;
  publisher?: string;
  city?: string;
  edition?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  accessedOn?: string;
}
export const CITATION_STYLES = ['ABNT', 'APA', 'MLA', 'CHICAGO'] as const;

const sources = (e: Engine): Record<string, Source> => (e.doc.document.settings.sources as Record<string, Source>) ?? {};
const initials = (given: string) => given.split(/\s+/).filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join(' ');

/** Fonte de uma citação: pelo sourceId (bibliografia do documento) ou a fonte escrita na própria citação. */
function citationSource(e: Engine, n: EditorNode): Source | null {
  if (n.data.sourceId) return sources(e)[n.data.sourceId] ?? null;
  const s = n.data.source;
  if (!s || (!s.title && !s.author && !s.authors)) return null;
  const authors = s.authors ?? (s.author ? String(s.author).split(/;\s*/).map((a: string) => { const parts = a.trim().split(/\s+/); return { family: parts.pop() ?? '', given: parts.join(' ') }; }) : []);
  return { id: n.id, type: s.type ?? 'OTHER', authors, title: s.title ?? '', year: s.year, publisher: s.publisher, city: s.city, url: s.url, accessedOn: s.accessedOn };
}

/** Citação no texto. ABNT: (SOBRENOME, 2020, p. 12) · APA: (Sobrenome, 2020, p. 12) · MLA: (Sobrenome 12) · Chicago: (Sobrenome 2020, 12). */
export function formatCitation(src: Source, style: string, page?: string | null) {
  const fam = src.authors.map((a) => a.family);
  const names = (upper: boolean) => {
    const f = upper ? fam.map((x) => x.toUpperCase()) : fam;
    if (!f.length) return upper ? src.title.split(/\s+/)[0].toUpperCase() : src.title.split(/\s+/)[0];
    if (f.length > 3) return `${f[0]} et al.`;
    return style === 'ABNT' ? f.join('; ') : f.length === 2 ? `${f[0]} ${style === 'APA' ? '&' : 'e'} ${f[1]}` : f.length === 3 && style !== 'ABNT' ? `${f[0]}, ${f[1]} & ${f[2]}` : f.join(', ');
  };
  const year = src.year ?? 's.d.';
  if (style === 'ABNT') return `(${names(true)}, ${year}${page ? `, p. ${page}` : ''})`;
  if (style === 'APA') return `(${names(false)}, ${year}${page ? `, p. ${page}` : ''})`;
  if (style === 'MLA') return `(${names(false)}${page ? ` ${page}` : ''})`;
  return `(${names(false)} ${year}${page ? `, ${page}` : ''})`;
}

/** Referência completa (lista de referências / bibliografia). */
export function formatReference(src: Source, style: string) {
  const authorsABNT = src.authors.map((a) => `${a.family.toUpperCase()}, ${a.given}`).join('; ');
  const authorsAPA = src.authors.map((a) => `${a.family}, ${initials(a.given)}`).join(src.authors.length > 1 ? ', ' : '');
  const first = src.authors[0];
  const authorsMLA = first ? `${first.family}, ${first.given}${src.authors.length > 1 ? (src.authors.length > 2 ? ', et al' : `, e ${src.authors[1].given} ${src.authors[1].family}`) : ''}` : '';
  const year = src.year ?? 's.d.';
  const where = [src.city, src.publisher].filter(Boolean).join(': ');
  const online = src.url ? ` Disponível em: ${src.url}.${src.accessedOn ? ` Acesso em: ${src.accessedOn}.` : ''}` : '';
  const journal = src.journal ? ` ${src.journal}${src.volume ? `, v. ${src.volume}` : ''}${src.issue ? `, n. ${src.issue}` : ''}${src.pages ? `, p. ${src.pages}` : ''},` : '';
  switch (style) {
    case 'APA': return `${authorsAPA || src.title} (${year}). ${src.title}.${src.journal ? ` ${src.journal}${src.volume ? `, ${src.volume}` : ''}${src.issue ? `(${src.issue})` : ''}${src.pages ? `, ${src.pages}` : ''}.` : src.publisher ? ` ${src.publisher}.` : ''}${src.url ? ` ${src.url}` : ''}`.trim();
    case 'MLA': return `${authorsMLA ? `${authorsMLA}. ` : ''}${src.title}.${src.publisher ? ` ${src.publisher},` : ''} ${year}.${src.url ? ` ${src.url}.` : ''}`.replace(/\s+/g, ' ').trim();
    case 'CHICAGO': return `${first ? `${first.family}, ${first.given}. ` : ''}${year}. ${src.title}.${where ? ` ${where}.` : ''}${src.url ? ` ${src.url}.` : ''}`.trim();
    default: return `${authorsABNT ? `${authorsABNT}. ` : ''}${src.title}.${src.edition ? ` ${src.edition}. ed.` : ''}${journal}${where ? ` ${where},` : ''} ${year}.${online}`.replace(/\s+/g, ' ').replace(/,\s*\./g, '.').trim();
  }
}

const sortKey = (src: Source) => `${src.authors[0]?.family ?? src.title}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------------------------------------------------------------- valores dos campos

export interface FieldContext { page?: number; pages?: number; now?: Date }

interface Computed { pages: ReturnType<typeof paginate>; index: Map<string, number>; numbering: Numbering }

function compute(e: Engine): Computed {
  const pages = paginate(e);
  return { pages, index: pageIndex(pages), numbering: numbering(e) };
}

function headingTitle(e: Engine, id: string): string {
  const order = documentOrder(e);
  const at = order.indexOf(id);
  for (let i = at; i >= 0; i--) {
    const n = e.doc.nodes[order[i]];
    if (n.type === 'TEXT' && /^HEADING_|^TITLE$/.test(n.data.textType)) return textOf(n);
    if (n.type === 'SECTION' && n.data.title) return n.data.title;
  }
  return '';
}

/** Texto que um elemento referenciado mostra numa referência cruzada. */
function targetText(e: Engine, c: Computed, t: EditorNode, show: string, from: EditorNode) {
  const caption = t.type === 'CAPTION' ? t : t.children.map((x) => e.doc.nodes[x]).find((x) => x?.type === 'CAPTION') ?? Object.values(e.doc.nodes).find((x) => x.type === 'CAPTION' && x.data.targetId === t.id);
  const page = pageOf(e, c.index, t.id);
  if (show === 'PAGE') return page ? String(page) : '?';
  if (show === 'ABOVE_BELOW') { const o = documentOrder(e); return o.indexOf(t.id) < o.indexOf(from.id) ? 'acima' : 'abaixo'; }
  if (caption) {
    const k = c.numbering.captions.get(caption.id) ?? 0;
    if (show === 'NUMBER') return String(k);
    if (show === 'LABEL_NUMBER') return `${caption.data.label} ${k}`;
    return `${caption.data.label} ${k} — ${textOf(caption)}`;
  }
  if (t.type === 'NOTE') return noteMark(t.data.noteType, c.numbering.notes.get(t.id) ?? 0);
  return Array.isArray(t.data.runs) ? textOf(t) : t.data.title ?? t.data.name ?? t.id;
}

/** Valor de um campo. Para cabeçalho/rodapé, passe a página no contexto. */
export function fieldText(e: Engine, id: string, ctx: FieldContext = {}, computed?: Computed): string {
  const n = e.get(id);
  const now = ctx.now ?? (e.services.now?.() as Date | undefined) ?? new Date();
  const c = computed ?? compute(e);
  if (n.type === 'CAPTION') return `${n.data.label} ${c.numbering.captions.get(id) ?? '?'}`;
  if (n.type === 'NOTE') return noteMark(n.data.noteType, c.numbering.notes.get(id) ?? 0);
  if (n.type === 'CITATION') {
    const src = citationSource(e, n);
    return src ? formatCitation(src, n.data.citationStyle ?? e.doc.document.settings.citationStyle ?? 'ABNT', n.data.page) : '(fonte não encontrada)';
  }
  if (n.type !== 'FIELD') fail('INVALID_OPERATION', `${id} não é um campo.`);
  const d = n.data;
  switch (d.fieldType) {
    case 'PAGE_NUMBER': return String(ctx.page ?? pageOf(e, c.index, id) ?? 1);
    case 'PAGE_COUNT': return String(ctx.pages ?? c.pages.length);
    case 'DATE': return formatDate(now, d.format ?? 'dd/MM/yyyy');
    case 'TIME': return formatDate(now, d.format ?? 'HH:mm');
    case 'DATETIME': return formatDate(now, d.format ?? 'dd/MM/yyyy HH:mm');
    case 'DOC_NAME': return e.doc.document.name;
    case 'AUTHOR': return String(e.doc.document.settings.author ?? '');
    case 'SECTION_TITLE': return headingTitle(e, id);
    case 'SLIDE_NUMBER': {
      const slide = [n.id, ...e.ancestors(n.id)].map((x) => e.find(x)).find((x) => x?.data.surfaceType === 'SLIDE');
      const slides = documentOrder(e).filter((x) => e.doc.nodes[x].data.surfaceType === 'SLIDE');
      return slide ? String(slides.indexOf(slide.id) + 1) : '';
    }
    case 'SHEET_NAME': { const s = [n.id, ...e.ancestors(n.id)].map((x) => e.find(x)).find((x) => x?.data.surfaceType === 'SHEET'); return s?.data.name ?? ''; }
    case 'CROSS_REFERENCE': {
      const t = resolveTarget(e, d);
      return t ? targetText(e, c, t, d.show ?? 'TEXT', n) : 'Erro! Referência não encontrada.';
    }
    case 'TOC': return (d.entries ?? []).map((x: any) => `${'  '.repeat(x.level - 1)}${x.text} ${x.page}`).join('\n');
    case 'INDEX': return (d.entries ?? []).map((x: any) => `${x.term}, ${x.pages.join(', ')}`).join('\n');
    case 'BIBLIOGRAPHY': return (d.entries ?? []).map((x: any) => x.text).join('\n');
    case 'FORM': case 'MERGE': return formFieldText(e, n);
    default: return '';
  }
}

// ---------------------------------------------------------------- sumário, índice e bibliografia

function tocEntries(e: Engine, c: Computed, levels: number) {
  const out: { text: string; level: number; page: number; targetId: string }[] = [];
  for (const id of documentOrder(e)) {
    const n = e.doc.nodes[id];
    if (n.type !== 'TEXT' || n.metadata.visible === false || isHeaderFooter(e, id)) continue;
    const m = /^HEADING_(\d)$/.exec(n.data.textType ?? '');
    if (!m || Number(m[1]) > levels) continue;
    out.push({ text: textOf(n), level: Number(m[1]), page: pageOf(e, c.index, id) ?? 1, targetId: id });
  }
  return out;
}

function indexEntries(e: Engine, c: Computed) {
  const map = new Map<string, Set<number>>();
  for (const n of Object.values(e.doc.nodes)) {
    for (const entry of (n.data.indexEntries ?? []) as { term: string; subterm?: string }[]) {
      const key = entry.subterm ? `${entry.term} — ${entry.subterm}` : entry.term;
      const p = pageOf(e, c.index, n.id) ?? 1;
      map.set(key, (map.get(key) ?? new Set()).add(p));
    }
  }
  return [...map].map(([term, pages]) => ({ term, pages: [...pages].sort((a, b) => a - b), letter: term.normalize('NFD')[0].toUpperCase() }))
    .sort((a, b) => a.term.localeCompare(b.term, 'pt-BR', { sensitivity: 'base' }));
}

function bibliographyEntries(e: Engine, style: string, onlyCited: boolean) {
  const cited = new Set(Object.values(e.doc.nodes).filter((n) => n.type === 'CITATION').map((n) => n.data.sourceId ?? n.id));
  const list: Source[] = [];
  for (const s of Object.values(sources(e))) if (!onlyCited || cited.has(s.id)) list.push(s);
  for (const n of Object.values(e.doc.nodes)) if (n.type === 'CITATION' && !n.data.sourceId) { const s = citationSource(e, n); if (s) list.push(s); }
  const seen = new Set<string>();
  return list.sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'pt-BR'))
    .map((s) => ({ sourceId: s.id, text: formatReference(s, style) }))
    .filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true)));
}

/** Recalcula e grava: numerações, sumário, índice, bibliografia e campos do corpo. Dois passes (o sumário ocupa espaço). */
export function updateFields(e: Engine) {
  let c = compute(e);
  for (let pass = 0; pass < 2; pass++) {
    for (const n of Object.values(e.doc.nodes)) {
      if (n.type !== 'FIELD') continue;
      const d = n.data;
      if (d.fieldType === 'TOC') { const entries = tocEntries(e, c, d.levels ?? 3); if (JSON.stringify(entries) !== JSON.stringify(d.entries)) e.touchNode(n.id).data.entries = entries; }
      if (d.fieldType === 'INDEX') { const entries = indexEntries(e, c); if (JSON.stringify(entries) !== JSON.stringify(d.entries)) e.touchNode(n.id).data.entries = entries; }
      if (d.fieldType === 'BIBLIOGRAPHY') { const entries = bibliographyEntries(e, d.citationStyle ?? e.doc.document.settings.citationStyle ?? 'ABNT', d.onlyCited ?? false); if (JSON.stringify(entries) !== JSON.stringify(d.entries)) e.touchNode(n.id).data.entries = entries; }
    }
    if (pass === 0) c = compute(e);   // sumário/índice mudaram de tamanho: pagina de novo antes de gravar as páginas
  }
  let updated = 0;
  for (const n of Object.values(e.doc.nodes)) {
    let value: string | null = null, extra: Record<string, unknown> = {};
    if (n.type === 'FIELD' && !['TOC', 'INDEX', 'BIBLIOGRAPHY'].includes(n.data.fieldType)) {
      const dynamic = isHeaderFooter(e, n.id) && ['PAGE_NUMBER', 'PAGE_COUNT', 'SECTION_TITLE'].includes(n.data.fieldType);
      value = dynamic ? null : fieldText(e, n.id, {}, c);
      extra = { dynamic };
    } else if (n.type === 'CAPTION') { value = fieldText(e, n.id, {}, c); extra = { number: c.numbering.captions.get(n.id) }; }
    else if (n.type === 'NOTE' && n.data.noteType !== 'SPEAKER') { value = fieldText(e, n.id, {}, c); extra = { number: c.numbering.notes.get(n.id) }; }
    else if (n.type === 'CITATION') value = fieldText(e, n.id, {}, c);
    else continue;
    if (n.data.value !== value || Object.entries(extra).some(([k, v]) => n.data[k] !== v)) { Object.assign(e.touchNode(n.id).data, { value, ...extra }); updated++; }
  }
  return { updated, pages: c.pages.length };
}

function insertField(e: Engine, op: any, fieldType: string, data: Record<string, unknown>) {
  const n = insertContent(e, { contentType: 'FIELD', parentId: op.payload?.parentId ?? op.targetId, index: op.payload?.index, data: { fieldType, ...data } });
  updateFields(e);
  return n.id;
}

// ---------------------------------------------------------------- operações

export const referenceHandlers: Record<string, Handler> = {
  /** Indicador: ADD_BOOKMARK { targetId, name } — nome único (letras, números e _). */
  ADD_BOOKMARK: (e, op) => {
    const name = String(op.payload?.name ?? '').trim();
    if (!/^[\p{L}_][\p{L}\p{N}_]{0,39}$/u.test(name)) fail('VALIDATION', 'Nome do indicador: comece com letra, use letras, números e _ (até 40).');
    const owner = bookmarks(e).get(name);
    if (owner && owner !== op.targetId) fail('VALIDATION', `Já existe o indicador "${name}".`);
    e.assertEditable(op.targetId!);
    e.touchNode(op.targetId!).metadata.bookmark = name;
    return name;
  },
  REMOVE_BOOKMARK: (e, op) => {
    const id = op.targetId ?? bookmarks(e).get(op.payload?.name) ?? fail('NOT_FOUND', 'Indicador não encontrado.');
    delete e.touchNode(id!).metadata.bookmark;
    return id;
  },
  LIST_BOOKMARKS: (e) => [...bookmarks(e)].map(([name, id]) => ({ name, targetId: id })),

  /** Recalcula todos os campos, numerações, sumário, índice e bibliografia. */
  UPDATE_FIELDS: (e) => updateFields(e),
  /** Valor de um campo (consulta): FIELD_TEXT { targetId, page? }. */
  FIELD_TEXT: (e, op) => fieldText(e, op.targetId ?? fail('INVALID_PAYLOAD', 'Informe targetId.'), { page: op.payload?.page, pages: op.payload?.pages }),

  /** Sumário automático: BUILD_TOC { parentId?, index?, levels? (1–6) }. */
  BUILD_TOC: (e, op) => {
    const levels = Number(op.payload?.levels ?? 3);
    if (!(levels >= 1 && levels <= 6)) fail('VALIDATION', 'Níveis do sumário: de 1 a 6.');
    return insertField(e, op, 'TOC', { levels, title: op.payload?.title ?? 'Sumário', entries: [] });
  },

  /** Marca um termo para o índice remissivo: MARK_INDEX_ENTRY { targetId, term, subterm? }. */
  MARK_INDEX_ENTRY: (e, op) => {
    const term = String(op.payload?.term ?? '').trim();
    if (!term) fail('VALIDATION', 'Informe o termo do índice.');
    e.assertEditable(op.targetId!);
    const t = e.touchNode(op.targetId!);
    const list = (t.data.indexEntries ??= []);
    if (!list.some((x: any) => x.term === term && x.subterm === op.payload?.subterm)) list.push({ term, ...(op.payload?.subterm ? { subterm: op.payload.subterm } : {}) });
    return list.length;
  },
  UNMARK_INDEX_ENTRY: (e, op) => {
    const t = e.touchNode(op.targetId!);
    t.data.indexEntries = (t.data.indexEntries ?? []).filter((x: any) => x.term !== op.payload?.term);
    return t.data.indexEntries.length;
  },
  BUILD_INDEX: (e, op) => insertField(e, op, 'INDEX', { title: op.payload?.title ?? 'Índice', entries: [] }),

  /** Fonte da bibliografia: ADD_SOURCE { type, authors: [{ given, family }], title, year, publisher, city, url, … }. */
  ADD_SOURCE: (e, op) => {
    const p = op.payload ?? {};
    if (!p.title) fail('VALIDATION', 'A fonte precisa de título.');
    if (p.type && !['BOOK', 'ARTICLE', 'WEBSITE', 'CHAPTER', 'THESIS', 'OTHER'].includes(p.type)) fail('VALIDATION', 'Tipo: BOOK, ARTICLE, WEBSITE, CHAPTER, THESIS ou OTHER.');
    if (p.authors && (!Array.isArray(p.authors) || p.authors.some((a: any) => !a.family))) fail('VALIDATION', 'Autores: lista com family (sobrenome) e given (nome).');
    if (p.url && !/^https?:\/\//.test(p.url)) fail('VALIDATION', 'Endereço da fonte precisa começar com http(s)://.');
    const id = e.newId('SRC');
    const st = (e.touch('document', 'info') as any).settings;
    st.sources = { ...(st.sources ?? {}), [id]: { id, type: p.type ?? 'BOOK', authors: p.authors ?? [], ...clone(p), } };
    st.sources[id].id = id;
    return id;
  },
  UPDATE_SOURCE: (e, op) => {
    const st = (e.touch('document', 'info') as any).settings;
    const s = st.sources?.[op.targetId!] ?? fail('NOT_FOUND', `Fonte ${op.targetId} não existe.`);
    Object.assign(s, clone(op.payload ?? {}), { id: s.id });
    updateFields(e);
    return s.id;
  },
  REMOVE_SOURCE: (e, op) => {
    const used = Object.values(e.doc.nodes).some((n) => n.type === 'CITATION' && n.data.sourceId === op.targetId);
    if (used) fail('INVALID_OPERATION', 'Essa fonte é citada no documento. Remova as citações antes.');
    const st = (e.touch('document', 'info') as any).settings;
    delete st.sources?.[op.targetId!];
    return op.targetId;
  },
  LIST_SOURCES: (e) => Object.values(sources(e)),

  /** Norma das citações do documento (e reformatação de todas): SET_CITATION_STYLE { style }. */
  SET_CITATION_STYLE: (e, op) => {
    const style = op.payload?.style;
    if (!CITATION_STYLES.includes(style)) fail('VALIDATION', `Norma: ${CITATION_STYLES.join(', ')}.`);
    (e.touch('document', 'info') as any).settings.citationStyle = style;
    for (const n of Object.values(e.doc.nodes)) if (n.type === 'CITATION' || (n.type === 'FIELD' && n.data.fieldType === 'BIBLIOGRAPHY')) e.touchNode(n.id).data.citationStyle = style;
    return updateFields(e);
  },
  /** Texto formatado de uma citação (consulta). */
  FORMAT_CITATION: (e, op) => fieldText(e, op.targetId ?? fail('INVALID_PAYLOAD', 'Informe targetId.')),
  /** Lista de referências: BUILD_BIBLIOGRAPHY { onlyCited?, style? }. */
  BUILD_BIBLIOGRAPHY: (e, op) => insertField(e, op, 'BIBLIOGRAPHY', { title: op.payload?.title ?? 'Referências', onlyCited: op.payload?.onlyCited ?? true, citationStyle: op.payload?.style ?? e.doc.document.settings.citationStyle ?? 'ABNT', entries: [] }),

  /** Autor do documento (campo AUTHOR). */
  SET_DOCUMENT_INFO: (e, op) => {
    const info = e.touch('document', 'info') as any;
    if (op.payload?.name !== undefined) info.name = String(op.payload.name).trim() || 'Sem título';
    if (op.payload?.author !== undefined) info.settings.author = String(op.payload.author);
    return { name: info.name, author: info.settings.author ?? '' };
  },
};
