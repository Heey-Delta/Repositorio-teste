// Modelo neutro de importação/exportação: todo formato passa por aqui.
//   arquivo → ler (parser do formato) → MODELO → montar no documento (operações normais: dá para desfazer)
//   documento → ler (readDocument) → MODELO → escrever no formato
// Assim cada formato só precisa saber converter de/para o modelo, nunca mexe no motor diretamente.
import type { Application, DocumentModel, EditorNode } from '../types.ts';
import type { Engine } from '../engine.ts';
import { textOf } from '../ops/text.ts';
import { readCell } from '../ops/table.ts';
import { chartData } from '../charts/chart.ts';
import { clone } from '../util.ts';
import { listLabelsIn } from '../ops/word.ts';

export type Scalar = string | number | boolean | null;
export interface RunM { text: string; format?: Record<string, unknown> }
export type BlockM =
  | { kind: 'text'; textType?: string; runs: RunM[] }
  | { kind: 'list'; listType: 'BULLET' | 'NUMBERED'; items: { level: number; runs: RunM[]; label?: string }[] }
  | { kind: 'table'; header?: boolean; rows: Scalar[][] }
  | { kind: 'image'; alt: string; source?: string; width?: number; height?: number }
  | { kind: 'shape'; shapeType: string; width: number; height: number; fill?: string; color?: string; bold?: boolean; fontSize?: number; runs?: RunM[] }
  | { kind: 'break' };
export interface SlideItemM {
  kind: 'text' | 'shape' | 'image' | 'line' | 'table';
  x: number; y: number; width: number; height: number;
  textType?: string; runs?: RunM[]; shapeType?: string; fill?: string; stroke?: string; alt?: string; source?: string; rows?: Scalar[][];
}
export interface SlideM { items: SlideItemM[]; background?: string; notes?: string }
export interface SheetM { name: string; cells: Record<string, { value?: Scalar; formula?: string }> }
export interface ImportModel { application?: Application; name?: string; blocks?: BlockM[]; slides?: SlideM[]; slideSize?: { width: number; height: number }; sheets?: SheetM[] }

// ---------------------------------------------------------------- documento → modelo

const runsOf = (n: EditorNode): RunM[] => (n.data.runs ?? []).map((r: any) => ({ text: r.text, format: clone(r.format ?? {}) }));
const cellText = (v: unknown): Scalar => (v === undefined ? null : (v as Scalar));

function tableRows(e: Engine, n: EditorNode): Scalar[][] {
  return (n.data.rows ?? []).map((row: any, r: number) => row.cells.map((_: any, c: number) => cellText(readCell(e, n, r + 1, c + 1).display)));
}

function blockOf(e: Engine, n: EditorNode): BlockM | null {
  switch (n.type) {
    case 'TEXT': case 'NOTE': case 'CAPTION': case 'CITATION': return { kind: 'text', textType: n.type === 'TEXT' ? n.data.textType ?? 'PARAGRAPH' : 'PARAGRAPH', runs: runsOf(n) };
    case 'LINK': return { kind: 'text', textType: 'PARAGRAPH', runs: runsOf(n).map((r) => ({ ...r, format: { ...r.format, ...(n.data.url ? { link: n.data.url } : {}) } })) };
    case 'TABLE': return { kind: 'table', header: Boolean(n.data.header), rows: tableRows(e, n) };
    case 'IMAGE': { const a = e.doc.assets[n.data.assetId]; return { kind: 'image', alt: n.data.alt ?? '', source: a?.source, width: n.layout.width as number, height: n.layout.height as number }; }
    case 'BREAK': return { kind: 'break' };
    case 'SHAPE': return { kind: 'shape', shapeType: n.data.shapeType ?? 'RECTANGLE', width: Number(n.layout.width ?? 160), height: Number(n.layout.height ?? 120), ...(n.styleOverrides.fill ? { fill: String(n.styleOverrides.fill) } : {}), ...(n.styleOverrides.color ? { color: String(n.styleOverrides.color) } : {}), ...(n.styleOverrides.bold ? { bold: true } : {}), ...(typeof n.styleOverrides.fontSize === 'number' ? { fontSize: n.styleOverrides.fontSize } : {}), ...(n.data.runs ? { runs: runsOf(n) } : {}) };
    case 'FIELD': return Array.isArray(n.data.entries)
      ? { kind: 'list', listType: 'BULLET', items: n.data.entries.map((x: any) => ({ level: Math.max(0, (x.level ?? 1) - 1), runs: [{ text: [x.text ?? x.term ?? x.label, x.page ?? x.pages?.join(', ')].filter((v) => v !== undefined && v !== '').join(' — ') }] })) }
      : { kind: 'text', textType: 'PARAGRAPH', runs: [{ text: String(n.data.value ?? '') }] };
    case 'EQUATION': return { kind: 'text', textType: 'CODE', runs: [{ text: String(n.data.latex ?? '') }] };
    case 'CHART': {
      const d = chartData(e, n);
      return { kind: 'table', header: true, rows: [[String(n.data.title?.text ?? ''), ...d.series.map((s) => s.name)], ...d.categories.map((c, i) => [c, ...d.series.map((s) => s.values[i] ?? null)] as Scalar[])] };
    }
    case 'DIAGRAM': return { kind: 'list', listType: 'BULLET', items: (n.data.items ?? []).map((it: any) => { let lvl = 0; for (let p = it.parentId; p; p = n.data.items.find((x: any) => x.id === p)?.parentId) lvl++; return { level: lvl, runs: [{ text: it.label }] }; }) };
    default: return null;
  }
}

/** Lê o documento (ou só `scope`) no modelo neutro. */
export function readDocument(e: Engine, scope?: string): ImportModel {
  const doc = e.doc;
  const app = doc.document.application;
  const model: ImportModel = { application: app, name: doc.document.name };
  const rootId = scope ?? doc.document.rootId;
  const surfaces = [rootId, ...e.descendants(rootId)].map((id) => doc.nodes[id]).filter((n) => n?.type === 'SURFACE');
  const slides = surfaces.filter((s) => s.data.surfaceType === 'SLIDE');
  const sheets = surfaces.filter((s) => s.data.surfaceType === 'SHEET');
  if (slides.length) {
    model.slideSize = clone(doc.document.settings.slide ?? { width: 1280, height: 720 });
    model.slides = slides.map((s) => ({
      ...(s.data.background?.color ? { background: s.data.background.color } : s.styleOverrides.fill ? { background: String(s.styleOverrides.fill) } : {}),
      ...(s.data.notes ? { notes: String(s.data.notes) } : {}),
      items: e.descendants(s.id).map((id) => doc.nodes[id]).filter((n) => n.metadata.visible !== false && n.type !== 'GROUP').flatMap((n): SlideItemM[] => {
        const L = n.layout, box = { x: Number(L.x ?? 0), y: Number(L.y ?? 0), width: Number(L.width ?? 200), height: Number(L.height ?? 40) };
        const look = { ...(n.styleOverrides.fill ? { fill: String(n.styleOverrides.fill) } : {}), ...(n.styleOverrides.stroke ? { stroke: String(n.styleOverrides.stroke) } : {}) };
        if (n.type === 'TEXT') return [{ kind: 'text', ...box, textType: n.data.textType, runs: runsOf(n), ...look }];
        if (n.type === 'SHAPE') return [{ kind: 'shape', ...box, shapeType: n.data.shapeType, runs: n.data.runs ? runsOf(n) : undefined, ...look }];
        if (n.type === 'IMAGE') return [{ kind: 'image', ...box, alt: n.data.alt ?? '', source: doc.assets[n.data.assetId]?.source }];
        if (n.type === 'LINE') return [{ kind: 'line', ...box, ...look }];
        if (n.type === 'TABLE') return [{ kind: 'table', ...box, rows: tableRows(e, n) }];
        const b = blockOf(e, n);
        if (b?.kind === 'text') return [{ kind: 'text', ...box, textType: b.textType, runs: b.runs }];
        if (b?.kind === 'table') return [{ kind: 'table', ...box, rows: b.rows }];
        return [];
      }),
    }));
  }
  if (sheets.length) {
    model.sheets = sheets.map((s) => ({
      name: String(s.data.name ?? 'Planilha'),
      cells: Object.fromEntries(Object.entries<any>(s.data.cells ?? {}).filter(([, c]) => c.formula || (c.value !== null && c.value !== undefined && c.value !== '')).map(([a, c]) => [a, c.formula ? { formula: c.formula, value: c.calculatedValue ?? null } : { value: c.value }])),
    }));
  }
  if (!slides.length && !sheets.length || app === 'DOCUMENT_EDITOR') {
    const blocks: BlockM[] = [];
    const walk = (id: string) => {
      const n = doc.nodes[id];
      if (!n || n.metadata.visible === false) return;
      if (n.type === 'REGION' && ['HEADER', 'FOOTER'].includes(n.data.regionType)) return;
      if (n.type === 'SURFACE' && n.data.surfaceType !== 'PAGE' && app !== 'DOCUMENT_EDITOR') return;
      if (n.type === 'LIST') {
        const items: { level: number; runs: RunM[]; label?: string }[] = [];
        const collect = (lid: string, base: number) => {
          const labels = listLabelsIn(doc, lid);
          for (const iid of doc.nodes[lid].children) {
            const it = doc.nodes[iid];
            const level = base + (it.data.level ?? 0);
            const txt = it.children.map((c) => doc.nodes[c]).find((c) => Array.isArray(c?.data.runs));
            items.push({ level, runs: txt ? runsOf(txt) : [{ text: '' }], label: labels[iid] });
            for (const c of it.children) if (doc.nodes[c]?.type === 'LIST') collect(c, level + 1);
          }
        };
        collect(n.id, 0);
        blocks.push({ kind: 'list', listType: n.data.listType === 'BULLET' ? 'BULLET' : 'NUMBERED', items });
        return;
      }
      if (['SECTION', 'BLOCK', 'REGION', 'GROUP', 'SURFACE'].includes(n.type)) { n.children.forEach(walk); return; }
      const b = blockOf(e, n);
      if (b) blocks.push(b);
    };
    walk(rootId);
    model.blocks = blocks;
  }
  return model;
}

/** Texto puro de uma lista de trechos. */
export const plain = (runs: RunM[] = []) => runs.map((r) => r.text).join('');

// ---------------------------------------------------------------- modelo → documento

const textRuns = (e: Engine, runs: RunM[]) => (runs.length ? runs : [{ text: '' }]).map((r) => ({ id: e.newId('RUN'), text: String(r.text), format: { ...(r.format ?? {}) } }));
const HEADING_SIZE: Record<string, number> = { TITLE: 40, SUBTITLE: 24, HEADING_1: 32, HEADING_2: 26, HEADING_3: 22 };

function insertBlock(e: Engine, b: BlockM, parentId: string): string | null {
  const ins = (contentType: string, data: any) => e.run({ type: 'INSERT_CONTENT', payload: { contentType, parentId, data } }).id as string;
  switch (b.kind) {
    case 'text': {
      const link = b.runs.length === 1 && typeof b.runs[0].format?.link === 'string' ? String(b.runs[0].format!.link) : null;
      if (link && /^(https?:|mailto:|tel:|#)/.test(link)) { const { link: _l, ...format } = b.runs[0].format!; return ins('LINK', { url: link, runs: textRuns(e, [{ text: b.runs[0].text, format }]) }); }
      return ins('TEXT', { textType: b.textType ?? 'PARAGRAPH', runs: textRuns(e, b.runs.map((r) => { const { link: _l, ...format } = r.format ?? {}; return { text: r.text, format }; })) });
    }
    case 'list': return e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'LIST', parentId, listType: b.listType, items: b.items.map((it) => ({ level: Math.min(8, it.level), runs: it.runs.map((r) => { const { link: _l, ...format } = r.format ?? {}; return { text: r.text, format }; }) })) } }) as string;
    case 'table': {
      const width = Math.max(1, ...b.rows.map((r) => r.length));
      if (!b.rows.length) return null;
      return ins('TABLE', { header: b.header ?? false, values: b.rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null)) });
    }
    case 'image': {
      if (!b.source) return ins('TEXT', { textType: 'PARAGRAPH', runs: textRuns(e, [{ text: `[Imagem${b.alt ? `: ${b.alt}` : ''}]` }]) });
      const asset = e.run({ type: 'IMPORT_ASSET', payload: { type: 'IMAGE', name: b.alt || 'imagem', source: b.source, ...(b.width ? { width: b.width, height: b.height } : {}) } });
      return ins('IMAGE', { assetId: asset, alt: b.alt ?? '' });
    }
    case 'break': return e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'BREAK', parentId, breakType: 'PAGE' } }) as string;
    case 'shape': {
      const id = e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'SHAPE', parentId, data: { shapeType: b.shapeType, ...(b.runs ? { runs: textRuns(e, b.runs) } : {}) }, layout: { width: b.width, height: b.height } } }).id as string;
      const look = { ...(b.fill ? { fill: b.fill } : {}), ...(b.color ? { color: b.color } : {}), ...(b.bold ? { bold: true } : {}), ...(b.fontSize ? { fontSize: b.fontSize } : {}) };
      if (Object.keys(look).length) e.run({ type: 'FORMAT', targetId: id, payload: look });
      return id;
    }
  }
}

/** Blocos → slides: cada título de nível 1 (ou quebra) começa um slide. */
function blocksToSlides(blocks: BlockM[], size: { width: number; height: number }): SlideM[] {
  const slides: SlideM[] = [];
  let cur: SlideM | null = null, y = 0;
  const pad = 60, w = size.width - pad * 2;
  const next = () => { cur = { items: [] }; slides.push(cur); y = pad; };
  for (const b of blocks) {
    if (b.kind === 'break') { next(); continue; }
    const isTitle = b.kind === 'text' && ['TITLE', 'HEADING_1'].includes(b.textType ?? '');
    if (!cur || (isTitle && (cur as SlideM).items.length)) next();
    const s = cur as unknown as SlideM;
    if (b.kind === 'text') { const h = isTitle ? 80 : Math.max(40, Math.ceil(plain(b.runs).length / 70) * 32); s.items.push({ kind: 'text', x: pad, y, width: w, height: h, textType: isTitle ? 'TITLE' : b.textType, runs: b.runs }); y += h + 16; }
    else if (b.kind === 'list') { for (const it of b.items) { s.items.push({ kind: 'text', x: pad + it.level * 32, y, width: w - it.level * 32, height: 36, textType: 'PARAGRAPH', runs: [{ text: (b.listType === 'NUMBERED' ? '' : '• ') }, ...it.runs] }); y += 40; } }
    else if (b.kind === 'table') { const h = b.rows.length * 32; s.items.push({ kind: 'table', x: pad, y, width: w, height: h, rows: b.rows }); y += h + 16; }
    else if (b.kind === 'image') { s.items.push({ kind: 'image', x: pad, y, width: 320, height: 240, alt: b.alt, source: b.source }); y += 256; }
    else if (b.kind === 'shape') { s.items.push({ kind: 'shape', x: pad, y, width: b.width, height: b.height, shapeType: b.shapeType, fill: b.fill, runs: b.runs }); y += b.height + 16; }
  }
  return slides;
}

const isBlankSurface = (e: Engine, id: string | null) => {
  const n = id ? e.find(id) : undefined;
  if (!n) return false;
  const kids = e.descendants(n.id).map((x) => e.doc.nodes[x]);
  return kids.every((k) => (k.type === 'TEXT' && !textOf(k).trim()) || ['BLOCK', 'REGION'].includes(k.type)) && !Object.keys(n.data.cells ?? {}).length;
};

/**
 * Monta o modelo no documento. Documentos: blocos entram em `parentId` (padrão: a área ativa).
 * Apresentações: slides novos (o primeiro slide vazio é aproveitado). Planilhas: planilhas novas (idem).
 * Precisa rodar dentro de uma transação (a operação IMPORT cuida disso).
 */
export function buildFromModel(e: Engine, model: ImportModel, parentId?: string | null) {
  const created: string[] = [];
  const app = e.doc.document.application;
  let slides = model.slides;
  if (!slides && app === 'PRESENTATION_EDITOR' && model.blocks?.length) slides = blocksToSlides(model.blocks, e.doc.document.settings.slide ?? { width: 1280, height: 720 });
  if (slides?.length) {
    let reuse = e.state.activeSurface && e.find(e.state.activeSurface)?.data.surfaceType === 'SLIDE' && isBlankSurface(e, e.state.activeSurface) ? e.state.activeSurface : null;
    for (const s of slides) {
      const sid = reuse ?? (e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SLIDE' } }) as string);
      if (reuse) for (const c of [...e.get(reuse).children]) e.run({ type: 'DELETE', targetId: c });
      reuse = null;
      created.push(sid);
      if (s.background) e.run({ type: 'SET_BACKGROUND', targetId: sid, payload: { color: s.background } });
      if (s.notes) e.touchNode(sid).data.notes = s.notes;
      for (const it of s.items) {
        const layout = { mode: 'ABSOLUTE', x: Math.round(it.x), y: Math.round(it.y), width: Math.max(1, Math.round(it.width)), height: Math.max(1, Math.round(it.height)) };
        const ins = (contentType: string, data: any) => e.run({ type: 'INSERT_CONTENT', payload: { contentType, parentId: sid, data, layout } }).id as string;
        let id: string;
        if (it.kind === 'text') id = ins('TEXT', { textType: it.textType ?? 'PARAGRAPH', runs: textRuns(e, it.runs ?? []) });
        else if (it.kind === 'shape') id = ins('SHAPE', { shapeType: it.shapeType ?? 'RECTANGLE', ...(it.runs ? { runs: textRuns(e, it.runs) } : {}) });
        else if (it.kind === 'line') id = ins('LINE', { lineType: 'STRAIGHT' });
        else if (it.kind === 'table') id = ins('TABLE', { values: (it.rows ?? [[null]]).map((r) => [...r]) });
        else if (it.source) { const asset = e.run({ type: 'IMPORT_ASSET', payload: { type: 'IMAGE', name: it.alt || 'imagem', source: it.source } }); id = ins('IMAGE', { assetId: asset, alt: it.alt ?? '' }); }
        else continue;
        const look = { ...(it.fill ? { fill: it.fill } : {}), ...(it.stroke ? { stroke: it.stroke } : {}) };
        if (Object.keys(look).length) e.run({ type: 'FORMAT', targetId: id, payload: look });
      }
    }
  }
  if (model.sheets?.length) {
    let reuse = e.state.activeSurface && e.find(e.state.activeSurface)?.data.surfaceType === 'SHEET' && isBlankSurface(e, e.state.activeSurface) ? e.state.activeSurface : null;
    for (const sh of model.sheets) {
      const taken = new Set(Object.values(e.doc.nodes).filter((n) => n.data.surfaceType === 'SHEET' && n.id !== reuse).map((n) => String(n.data.name).toLowerCase()));
      let name = sh.name || 'Planilha', k = 2;
      while (taken.has(name.toLowerCase())) name = `${sh.name} (${k++})`;
      const sid = reuse ?? (e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SHEET', name } }) as string);
      if (reuse) e.touchNode(reuse).data.name = name;
      reuse = null;
      created.push(sid);
      // valores primeiro, fórmulas depois (assim as referências já encontram os números)
      const entries = Object.entries(sh.cells);
      for (const [addr, c] of entries) if (!c.formula && c.value !== null && c.value !== undefined) e.run({ type: 'SET_CELL', targetId: sid, payload: { cell: addr, value: c.value } });
      for (const [addr, c] of entries) if (c.formula) {
        const r = e.execute({ type: 'SET_CELL', targetId: sid, payload: { cell: addr, value: c.formula.startsWith('=') ? c.formula : `=${c.formula}` } });
        if (!r.ok) e.run({ type: 'SET_CELL', targetId: sid, payload: { cell: addr, value: c.value ?? null } });   // fórmula que o motor não conhece: fica o valor calculado
      }
    }
  }
  if (model.blocks?.length && !(app === 'PRESENTATION_EDITOR' && !model.slides)) {
    const target = parentId ?? (app === 'DOCUMENT_EDITOR' ? e.state.activeSurface : null) ?? e.state.activeSurface;
    if (app === 'DOCUMENT_EDITOR' || !model.sheets?.length) {
      const host = target && e.find(target) && e.find(target)!.data.surfaceType !== 'SHEET' ? target : null;
      if (host) for (const b of model.blocks) { const id = insertBlock(e, b, host); if (id) created.push(id); }
    }
  }
  return created;
}

/** Documento novo a partir do modelo (para "abrir arquivo"). */
export function documentFromModel(make: (app: Application) => Engine, model: ImportModel): DocumentModel {
  const app = model.application ?? (model.sheets?.length ? 'SPREADSHEET_EDITOR' : model.slides?.length ? 'PRESENTATION_EDITOR' : 'DOCUMENT_EDITOR');
  const e = make(app);
  const blank = e.state.activeSurface ? e.descendants(e.state.activeSurface).filter((id) => e.doc.nodes[id].type === 'TEXT' && !textOf(e.doc.nodes[id]).trim()) : [];
  e.run({ type: 'IMPORT', payload: { model } });
  if (app === 'DOCUMENT_EDITOR') for (const id of blank) if (e.find(id)) e.run({ type: 'DELETE', targetId: id });
  if (model.name) e.doc.document.name = model.name;
  return clone(e.doc);
}
