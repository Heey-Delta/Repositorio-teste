// Layout e composição (categoria 09): configuração de página/slide, colunas, plano de fundo, impressão e PAGINAÇÃO.
//
// As páginas de um documento não são armazenadas: são calculadas (Registro Mestre: "páginas de documentos contínuos
// podem ser geradas pelo mecanismo de layout"). paginate() percorre o fluxo (seções → blocos → parágrafos, tabelas,
// imagens, listas), mede cada elemento e distribui nas áreas de conteúdo (página − margens − cabeçalho/rodapé),
// coluna por coluna, quebrando parágrafos entre páginas quando precisa.
//
// A MEDIÇÃO é plugável: engine.services.measure(node, width) → altura em px. O padrão estima pela fonte (largura média
// dos caracteres); a interface troca pela medição real do navegador.
import type { EditorNode } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { resolveStyle } from './format.ts';
import { textOf } from './text.ts';
import { fail, merge } from '../util.ts';

// ---------------------------------------------------------------- configuração

export interface Margins { top: number; right: number; bottom: number; left: number }
export interface PageSetup {
  size: string;
  width: number;
  height: number;
  orientation: 'PORTRAIT' | 'LANDSCAPE';
  margins: Margins;
  headerDistance: number;
  footerDistance: number;
  columns: number;
  columnGap: number;
  background?: Background | null;
}
export interface Background { color?: string; assetId?: string; gradient?: { from: string; to: string; angle: number }; fit?: 'COVER' | 'CONTAIN' | 'TILE' }

/** Tamanhos em px a 96 dpi, em retrato. */
export const PAGE_SIZES: Record<string, [number, number]> = {
  A3: [1123, 1587], A4: [794, 1123], A5: [559, 794], LETTER: [816, 1056], LEGAL: [816, 1344], OFICIO: [816, 1247],
};
const cm = (v: number) => Math.round((v / 2.54) * 96);
/** Margens prontas. ABNT: 3 cm em cima e à esquerda, 2 cm embaixo e à direita. */
export const MARGIN_PRESETS: Record<string, Margins> = {
  NORMAL: { top: cm(2.5), right: cm(2.5), bottom: cm(2.5), left: cm(2.5) },
  NARROW: { top: cm(1.27), right: cm(1.27), bottom: cm(1.27), left: cm(1.27) },
  WIDE: { top: cm(2.54), right: cm(5.08), bottom: cm(2.54), left: cm(5.08) },
  ABNT: { top: cm(3), right: cm(2), bottom: cm(2), left: cm(3) },
};
export const SLIDE_SIZES: Record<string, [number, number]> = { '16:9': [1280, 720], '4:3': [1024, 768], '16:10': [1280, 800], A4: [1123, 794] };

export function defaultSetup(): PageSetup {
  return { size: 'A4', width: 794, height: 1123, orientation: 'PORTRAIT', margins: { ...MARGIN_PRESETS.NORMAL }, headerDistance: cm(1.25), footerDistance: cm(1.25), columns: 1, columnGap: cm(1.25), background: null };
}

/** Configuração efetiva: documento ← seção (uma quebra de seção pode mudar tamanho, margens e colunas). */
export function setupFor(e: Engine, sectionId?: string | null): PageSetup {
  const base = { ...defaultSetup(), ...(e.doc.document.settings.page as Partial<PageSetup> ?? {}) } as PageSetup;
  const chain = sectionId ? [sectionId, ...e.ancestors(sectionId)].reverse() : [];
  return chain.reduce<PageSetup>((acc, id) => {
    const p = e.find(id)?.data.page;
    return p ? { ...acc, ...p, margins: { ...acc.margins, ...(p.margins ?? {}) } } : acc;
  }, base);
}

function applySetup(cur: PageSetup, p: Record<string, any>): PageSetup {
  const next: PageSetup = { ...cur };
  if (p.size) {
    const s = PAGE_SIZES[p.size] ?? (p.size === 'CUSTOM' ? null : fail('VALIDATION', `Tamanho: ${Object.keys(PAGE_SIZES).join(', ')} ou CUSTOM.`));
    next.size = p.size;
    if (s) [next.width, next.height] = s;
  }
  if (p.width !== undefined || p.height !== undefined) {
    next.size = p.size ?? 'CUSTOM';
    next.width = Number(p.width ?? next.width); next.height = Number(p.height ?? next.height);
  }
  const orientation = p.orientation ?? cur.orientation;
  if (!['PORTRAIT', 'LANDSCAPE'].includes(orientation)) fail('VALIDATION', 'Orientação: PORTRAIT (retrato) ou LANDSCAPE (paisagem).');
  const [w, h] = [next.width, next.height];
  next.orientation = orientation;
  if ((orientation === 'LANDSCAPE') !== (w > h) && w !== h) [next.width, next.height] = [h, w];
  if (p.margins) next.margins = typeof p.margins === 'string' ? { ...(MARGIN_PRESETS[p.margins] ?? fail('VALIDATION', `Margens prontas: ${Object.keys(MARGIN_PRESETS).join(', ')}.`)) } : { ...cur.margins, ...p.margins };
  for (const k of ['headerDistance', 'footerDistance', 'columnGap'] as const) if (p[k] !== undefined) next[k] = Number(p[k]);
  if (p.columns !== undefined) next.columns = Number(p.columns);
  if (next.width < 96 || next.height < 96) fail('VALIDATION', 'A página precisa ter pelo menos 1 polegada (96 px) de cada lado.');
  const m = next.margins;
  if ([m.top, m.right, m.bottom, m.left].some((v) => v < 0)) fail('VALIDATION', 'Margens não podem ser negativas.');
  if (m.left + m.right >= next.width - 48 || m.top + m.bottom >= next.height - 48) fail('VALIDATION', 'As margens não deixam espaço para o conteúdo.');
  if (next.columns < 1 || next.columns > 12) fail('VALIDATION', 'Colunas: de 1 a 12.');
  return next;
}

function validateBackground(e: Engine, b: Record<string, any> | null): Background | null {
  if (b === null) return null;
  const out: Background = {};
  if (b.color !== undefined) { if (typeof b.color !== 'string' || !/^(#[0-9a-f]{3,8}|rgba?\(.+\)|transparent|theme:[\w.]+)$/i.test(b.color)) fail('VALIDATION', 'Cor de fundo inválida.'); out.color = b.color; }
  if (b.assetId !== undefined) { const a = e.doc.assets[b.assetId] ?? fail('VALIDATION', `Arquivo ${b.assetId} não existe.`); if (a!.type !== 'IMAGE') fail('VALIDATION', 'O fundo precisa ser uma imagem.'); out.assetId = b.assetId; }
  if (b.gradient !== undefined) { const g = b.gradient; if (!g?.from || !g?.to) fail('VALIDATION', 'Gradiente: from e to.'); out.gradient = { from: g.from, to: g.to, angle: Number(g.angle ?? 180) }; }
  if (b.fit !== undefined) { if (!['COVER', 'CONTAIN', 'TILE'].includes(b.fit)) fail('VALIDATION', 'Ajuste: COVER, CONTAIN ou TILE.'); out.fit = b.fit; }
  if (!Object.keys(out).length) fail('VALIDATION', 'Informe color, assetId ou gradient.');
  return out;
}

// ---------------------------------------------------------------- medição

const PX_PER_PT = 96 / 72;
const HEADING_SIZE: Record<string, number> = { TITLE: 26, SUBTITLE: 16, HEADING_1: 20, HEADING_2: 16, HEADING_3: 14, HEADING_4: 12, HEADING_5: 11, HEADING_6: 10 };

export type Measure = (e: Engine, node: EditorNode, width: number) => { height: number; lineHeight?: number; lines?: number };

/** Estimativa padrão: largura média de caractere ≈ 0,5 × tamanho da fonte. A interface substitui pela real. */
export const estimateMeasure: Measure = (e, n, width) => {
  const st = resolveStyle(e, n.id);
  const explicit = n.styleOverrides.fontSize !== undefined || (n.styleId && e.doc.styles[n.styleId]?.properties.fontSize !== undefined);
  const pt = Number(explicit ? st.fontSize : HEADING_SIZE[n.data.textType] ?? st.fontSize ?? 12);
  const font = pt * PX_PER_PT;
  const lh = font * Number(st.lineHeight ?? 1.4);
  const spacing = Number(st.spaceBefore ?? 0) + Number(st.spaceAfter ?? (n.type === 'TEXT' ? 8 : 0));
  if (Array.isArray(n.data.runs)) {
    const indent = Number(st.indentLeft ?? 0) + Number(st.indentRight ?? 0) + (n.parentId && e.find(n.parentId)?.type === 'LIST_ITEM' ? 24 * (1 + (e.get(n.parentId).data.level ?? 0)) : 0);
    const perLine = Math.max(1, Math.floor((width - indent) / (font * 0.5)));
    const lines = textOf(n).split('\n').reduce((s, p) => s + Math.max(1, Math.ceil(p.length / perLine)), 0);
    return { height: lines * lh + spacing, lineHeight: lh, lines };
  }
  if (n.type === 'TABLE') return { height: (n.data.rows ?? []).reduce((s: number, r: any) => s + (r.height ?? Math.max(24, lh + 8)), 0) + 8 };
  if (n.type === 'BREAK') return { height: 0 };
  const h = typeof n.layout.height === 'number' ? n.layout.height : { IMAGE: 240, CHART: 300, VIDEO: 270, DIAGRAM: 320, EQUATION: 48, AUDIO: 54, SHAPE: 120, LINE: 2 }[n.type as string] ?? lh;
  const w = typeof n.layout.width === 'number' ? n.layout.width : width;
  return { height: (w > width ? h * (width / w) : h) + 8 };   // maior que a coluna: reduz mantendo a proporção
};

const measureOf = (e: Engine): Measure => e.services.measure ?? estimateMeasure;

// ---------------------------------------------------------------- paginação

export interface PlacedItem { nodeId: string; y: number; height: number; lines?: [number, number] }
export interface PageColumn { x: number; width: number; items: PlacedItem[] }
export interface Page {
  number: number;
  sectionId: string;
  width: number; height: number;
  margins: Margins;
  contentArea: { x: number; y: number; width: number; height: number };
  columns: PageColumn[];
  headerId: string | null;
  footerId: string | null;
  floating: string[];
  background: Background | null;
}

type FlowItem = { kind: 'node'; node: EditorNode; sectionId: string } | { kind: 'break'; type: 'PAGE' | 'COLUMN' | 'SECTION'; sectionId: string };

/** Sequência de leitura do documento (o que entra no fluxo), na ordem. */
function flow(e: Engine): FlowItem[] {
  const out: FlowItem[] = [];
  const walk = (id: string, sectionId: string) => {
    const n = e.doc.nodes[id];
    if (!n || n.metadata.visible === false) return;
    if (n.type === 'REGION' && ['HEADER', 'FOOTER'].includes(n.data.regionType)) return;   // decoram as páginas, não entram no fluxo
    if (n.type === 'SECTION') {
      if (n.parentId && n.data.page) out.push({ kind: 'break', type: 'SECTION', sectionId: n.id });   // seção com página própria começa em página nova
      for (const c of n.children) walk(c, n.id);
      return;
    }
    if (n.type === 'BREAK') { out.push({ kind: 'break', type: n.data.breakType ?? 'PAGE', sectionId }); return; }
    if (['BLOCK', 'REGION', 'LIST', 'LIST_ITEM', 'GROUP', 'SURFACE'].includes(n.type) && n.layout.mode !== 'ABSOLUTE') {
      if (n.type === 'LIST_ITEM' || n.type === 'LIST') { for (const c of n.children) walk(c, sectionId); return; }
      for (const c of n.children) walk(c, sectionId);
      return;
    }
    out.push({ kind: 'node', node: n, sectionId });
  };
  walk(e.doc.document.rootId, e.doc.document.rootId);
  return out;
}

const regionHeight = (e: Engine, id: string, width: number) => e.get(id).children.reduce((s, c) => s + measureOf(e)(e, e.get(c), width).height, 0);

/** Cabeçalho/rodapé da seção para a página (primeira página, pares/ímpares ou todas). */
function regionFor(e: Engine, sectionId: string, type: 'HEADER' | 'FOOTER', pageInSection: number, pageNumber: number): string | null {
  for (const sid of [sectionId, ...e.ancestors(sectionId)]) {
    const s = e.find(sid);
    if (!s) continue;
    const regs = s.children.map((c) => e.doc.nodes[c]).filter((r) => r?.type === 'REGION' && r.data.regionType === type);
    if (!regs.length) continue;
    const pick = (w: string) => regs.find((r) => (r.data.applyTo ?? 'ALL') === w)?.id;
    if (pageInSection === 1 && s.data.differentFirstPage) return pick('FIRST') ?? null;
    if (s.data.differentOddEven) return (pageNumber % 2 === 0 ? pick('EVEN') : pick('ODD')) ?? pick('ALL') ?? null;
    return pick('ALL') ?? regs[0].id;
  }
  return null;
}

export function paginate(e: Engine): Page[] {
  if (e.doc.document.application !== 'DOCUMENT_EDITOR' && !e.doc.document.settings.page) return [];
  const pages: Page[] = [];
  let page: Page | null = null, col = 0, cursor = 0, sectionPage = 0, currentSection = '';
  const measure = measureOf(e);
  const newPage = (sectionId: string) => {
    if (sectionId !== currentSection) { sectionPage = 0; currentSection = sectionId; }
    sectionPage++;
    const s = setupFor(e, sectionId);
    const number = pages.length + 1;
    const headerId = regionFor(e, sectionId, 'HEADER', sectionPage, number);
    const footerId = regionFor(e, sectionId, 'FOOTER', sectionPage, number);
    const inner = s.width - s.margins.left - s.margins.right;
    const top = Math.max(s.margins.top, headerId ? s.headerDistance + regionHeight(e, headerId, inner) + 8 : 0);
    const bottom = Math.max(s.margins.bottom, footerId ? s.footerDistance + regionHeight(e, footerId, inner) + 8 : 0);
    const colW = (inner - s.columnGap * (s.columns - 1)) / s.columns;
    page = {
      number, sectionId, width: s.width, height: s.height, margins: s.margins,
      contentArea: { x: s.margins.left, y: top, width: inner, height: s.height - top - bottom },
      columns: Array.from({ length: s.columns }, (_, i) => ({ x: s.margins.left + i * (colW + s.columnGap), width: colW, items: [] })),
      headerId, footerId, floating: [], background: s.background ?? null,
    };
    pages.push(page);
    col = 0; cursor = 0;
  };
  const nextColumn = (sectionId: string) => { if (page && col < page.columns.length - 1) { col++; cursor = 0; } else newPage(sectionId); };

  for (const item of flow(e)) {
    if (!page) newPage(item.sectionId);
    if (item.kind === 'break') {
      if (item.type === 'COLUMN') nextColumn(item.sectionId);
      else if (item.type === 'SECTION') { if (cursor > 0 || col > 0) newPage(item.sectionId); else if (page!.sectionId !== item.sectionId) { pages.pop(); newPage(item.sectionId); } }
      else newPage(item.sectionId);
      continue;
    }
    const n = item.node;
    if (n.layout.mode === 'ABSOLUTE') { page!.floating.push(n.id); continue; }   // objeto flutuante: fica na página onde aparece
    const c = page!.columns[col];
    const m = measure(e, n, c.width);
    const room = () => page!.contentArea.height - cursor;
    if (m.height <= room() || (cursor === 0 && !m.lines)) {   // cabe (ou é maior que uma página inteira: fica sozinho)
      c.items.push({ nodeId: n.id, y: cursor, height: m.height });
      cursor += m.height;
      continue;
    }
    if (m.lines && m.lineHeight && m.lines > 1) {   // parágrafo: divide por linhas (mínimo de 2 linhas de cada lado)
      let from = 0;
      while (from < m.lines) {
        const col2 = page!.columns[col];
        const fit = Math.floor(room() / m.lineHeight);
        const left = m.lines - from;
        let take = Math.min(fit, left);
        if (take < left && left - take < 2) take = left - 2;   // não deixa uma linha sozinha na próxima página (viúva)
        if (take < 2 && left > 1 && cursor > 0) { nextColumn(item.sectionId); continue; }   // nem duas linhas cabem (órfã)
        if (take <= 0) take = Math.min(left, Math.max(1, fit));
        col2.items.push({ nodeId: n.id, y: cursor, height: take * m.lineHeight, lines: [from, from + take] });
        cursor += take * m.lineHeight;
        from += take;
        if (from < m.lines) nextColumn(item.sectionId);
      }
      cursor += Math.max(0, m.height - m.lines * m.lineHeight);   // espaço depois do parágrafo
      continue;
    }
    nextColumn(item.sectionId);
    page!.columns[col].items.push({ nodeId: n.id, y: cursor, height: m.height });
    cursor += m.height;
  }
  if (!pages.length) newPage(e.doc.document.rootId);
  return pages;
}

/** Em que página(s) cada elemento aparece (usado por campos, sumário e índice). */
export function pageIndex(pages: Page[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of pages) {
    for (const c of p.columns) for (const it of c.items) if (!out.has(it.nodeId)) out.set(it.nodeId, p.number);
    for (const f of p.floating) if (!out.has(f)) out.set(f, p.number);
  }
  return out;
}

// ---------------------------------------------------------------- operações

const settings = (e: Engine) => (e.touch('document', 'info') as any).settings;

export const pageHandlers: Record<string, Handler> = {
  /**
   * SET_PAGE { size?, width?, height?, orientation?, margins?: {…} | 'NORMAL'|'NARROW'|'WIDE'|'ABNT', columns?, columnGap?,
   *            headerDistance?, footerDistance? } — para o documento ou, com targetId, para uma seção.
   */
  SET_PAGE: (e, op) => {
    const p = op.payload ?? {};
    if (op.targetId) {
      const s = e.get(op.targetId);
      if (s.type !== 'SECTION') fail('INVALID_OPERATION', 'Configuração de página vale para o documento ou para uma seção.');
      e.assertEditable(s.id);
      const parentSetup = setupFor(e, s.parentId);
      const next = applySetup({ ...parentSetup, ...(s.data.page ?? {}), margins: { ...parentSetup.margins, ...(s.data.page?.margins ?? {}) } }, p);
      const own: Record<string, unknown> = {};
      for (const k of Object.keys(next) as (keyof PageSetup)[]) if (JSON.stringify(next[k]) !== JSON.stringify(parentSetup[k])) own[k] = next[k];
      e.touchNode(s.id).data.page = own;
      return setupFor(e, s.id);
    }
    const st = settings(e);
    st.page = applySetup({ ...defaultSetup(), ...(st.page ?? {}) }, p);
    return st.page;
  },

  /** Tamanho dos slides: SET_SLIDE_SIZE { preset: '16:9'|'4:3'|… | width, height, scaleContent? }. */
  SET_SLIDE_SIZE: (e, op) => {
    const p = op.payload ?? {};
    const [w, h] = p.preset ? SLIDE_SIZES[p.preset] ?? fail('VALIDATION', `Formato: ${Object.keys(SLIDE_SIZES).join(', ')}.`) : [Number(p.width), Number(p.height)];
    if (!(w! >= 200 && h! >= 200)) fail('VALIDATION', 'Slide: pelo menos 200 × 200 px.');
    const st = settings(e);
    const old = st.slide ?? { width: 1280, height: 720 };
    st.slide = { width: w, height: h };
    const sx = w! / old.width, sy = h! / old.height;
    for (const n of Object.values(e.doc.nodes)) {
      if (n.type !== 'SURFACE' || n.data.surfaceType !== 'SLIDE') continue;
      const t = e.touchNode(n.id);
      t.layout.width = w; t.layout.height = h;
      if (p.scaleContent === false) continue;
      for (const cid of e.descendants(n.id)) {   // conteúdo acompanha o novo tamanho
        const c = e.doc.nodes[cid];
        if (c.layout.mode !== 'ABSOLUTE') continue;
        const k = Math.min(sx, sy), ct = e.touchNode(cid);
        ct.layout.x = (c.layout.x ?? 0) * sx; ct.layout.y = (c.layout.y ?? 0) * sy;
        if (typeof c.layout.width === 'number') ct.layout.width = c.layout.width * k;
        if (typeof c.layout.height === 'number') ct.layout.height = c.layout.height * k;
      }
    }
    return st.slide;
  },

  /** Texto em colunas numa seção (ou no documento): SET_COLUMNS { count, gap? }. */
  SET_COLUMNS: (e, op) => e.run({ type: 'SET_PAGE', targetId: op.targetId, payload: { columns: op.payload?.count, ...(op.payload?.gap !== undefined ? { columnGap: op.payload.gap } : {}) } }),

  /** Plano de fundo: do documento (todas as páginas), de uma seção ou de um slide. null remove. */
  SET_BACKGROUND: (e, op) => {
    const bg = validateBackground(e, op.payload?.background === null ? null : op.payload ?? {});
    if (!op.targetId) { const st = settings(e); st.page = { ...defaultSetup(), ...(st.page ?? {}), background: bg }; return bg; }
    const n = e.get(op.targetId);
    e.assertEditable(n.id);
    if (n.type === 'SECTION') { const t = e.touchNode(n.id); t.data.page = { ...(t.data.page ?? {}), background: bg }; return bg; }
    if (n.type !== 'SURFACE') fail('INVALID_OPERATION', 'Plano de fundo vale para documento, seção ou slide.');
    e.touchNode(n.id).data.background = bg;
    return bg;
  },

  /** Opções de cabeçalho/rodapé da seção: primeira página diferente, pares e ímpares diferentes. */
  SET_HEADER_FOOTER: (e, op) => {
    const s = e.get(op.targetId ?? e.doc.document.rootId);
    if (s.type !== 'SECTION') fail('INVALID_OPERATION', 'Cabeçalho e rodapé são da seção.');
    const t = e.touchNode(s.id);
    for (const k of ['differentFirstPage', 'differentOddEven'] as const) if (op.payload?.[k] !== undefined) t.data[k] = Boolean(op.payload[k]);
    return { differentFirstPage: Boolean(t.data.differentFirstPage), differentOddEven: Boolean(t.data.differentOddEven) };
  },

  /** Impressão: SET_PRINT { range: 'ALL'|'1-3,5', copies, scale, fitToPage, gridlines, headings, repeatRows, orientation }. */
  SET_PRINT: (e, op) => {
    const p = op.payload ?? {};
    if (p.range !== undefined && !/^(ALL|CURRENT|SELECTION|\d+(-\d+)?(,\d+(-\d+)?)*)$/.test(String(p.range).replace(/\s/g, ''))) fail('VALIDATION', 'Intervalo: ALL, CURRENT, SELECTION ou páginas como "1-3,5".');
    if (p.copies !== undefined && !(Number.isInteger(p.copies) && p.copies >= 1 && p.copies <= 999)) fail('VALIDATION', 'Cópias: de 1 a 999.');
    if (p.scale !== undefined && !(p.scale >= 10 && p.scale <= 400)) fail('VALIDATION', 'Escala: de 10% a 400%.');
    const st = settings(e);
    st.print = merge(st.print ?? { range: 'ALL', copies: 1, scale: 100, fitToPage: false, gridlines: false, headings: false }, p);
    return st.print;
  },

  /** Páginas calculadas (consulta): tamanho, área de conteúdo, colunas com os elementos, cabeçalho e rodapé. */
  PAGINATE: (e) => paginate(e),
  PAGE_SETUP: (e, op) => setupFor(e, op.targetId ?? null),
};
