// Importação, exportação, impressão e conversão (F16).
//
//   EXPORT { format, targetId?, options? } → { fileName, mimeType, data } — TXT, MD, HTML, CSV, JSON, XLSX, DOCX,
//          PPTX, PDF e SVG (slide, gráfico ou diagrama). PNG: a interface rasteriza o SVG (precisa de canvas).
//   IMPORT { format, content } | { model } — TXT, MD, HTML, CSV e JSON direto; XLSX, DOCX e PPTX são pacotes ZIP e
//          descompactar é assíncrono: use importFile() (lê o arquivo e chama IMPORT com o modelo). Dá para desfazer.
//   PRINT_LAYOUT — páginas prontas para imprimir/visualizar (documento paginado, um slide por página, planilha
//          dividida em páginas com linhas repetidas), respeitando SET_PRINT (intervalo e cópias).
//   CONVERT_BATCH { files, to } — vários arquivos de uma vez (formatos de texto); convertFiles() aceita todos.
import type { Application, DocumentModel } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { buildFromModel, documentFromModel, readDocument, type ImportModel, type Scalar } from '../io/model.ts';
import { fromHtml, fromMarkdown, fromTxt, parseCsv, sheetFromRows, sheetMatrix, toCsv, toHtml, toMarkdown, toTxt } from '../io/text-formats.ts';
import { fromDocx, fromPptx, fromXlsx, toDocx, toPptx, toXlsx } from '../io/office.ts';
import { toPdf } from '../io/pdf.ts';
import { chartSvg, diagramSvg, slideSvg } from '../io/svg.ts';
import { chartData } from '../charts/chart.ts';
import { paginate, setupFor } from './page.ts';
import { readCell } from './table.ts';
import { cloneSubtree, insertSubtree } from './basic.ts';
import { checkIntegrity, repair } from './versions.ts';
import { clone, fail } from '../util.ts';

export const FORMATS: Record<string, { mime: string; ext: string; binary: boolean }> = {
  TXT: { mime: 'text/plain;charset=utf-8', ext: 'txt', binary: false },
  MD: { mime: 'text/markdown;charset=utf-8', ext: 'md', binary: false },
  HTML: { mime: 'text/html;charset=utf-8', ext: 'html', binary: false },
  CSV: { mime: 'text/csv;charset=utf-8', ext: 'csv', binary: false },
  JSON: { mime: 'application/json', ext: 'json', binary: false },
  SVG: { mime: 'image/svg+xml', ext: 'svg', binary: false },
  PDF: { mime: 'application/pdf', ext: 'pdf', binary: true },
  XLSX: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', binary: true },
  DOCX: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', binary: true },
  PPTX: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx', binary: true },
};
const ZIPPED = ['XLSX', 'DOCX', 'PPTX'];
const ALIAS: Record<string, string> = { MARKDOWN: 'MD', HTM: 'HTML', TEXT: 'TXT', JPEG: 'JPG' };
const fmt = (f: unknown) => { const raw = String(f ?? '').toUpperCase().replace(/^\./, ''); const k = ALIAS[raw] ?? raw; if (!FORMATS[k]) fail('VALIDATION', `Formato: ${Object.keys(FORMATS).join(', ')}.`); return k; };
/** Formato pelo nome do arquivo ("relatorio.docx" → DOCX). */
export const formatOf = (fileName: string) => fmt(fileName.split('.').pop());
const safeName = (s: string) => (s || 'documento').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 120) || 'documento';

/** Linhas de uma tabela ou planilha (valores calculados). */
function tableRowsOf(e: Engine, id: string): Scalar[][] {
  const n = e.get(id);
  if (n.type === 'TABLE') return (n.data.rows ?? []).map((row: any, r: number) => row.cells.map((_: any, c: number) => readCell(e, n, r + 1, c + 1).display ?? null));
  if (n.data.surfaceType === 'SHEET') return sheetMatrix(readDocument(e, n.id).sheets![0]);
  return fail('INVALID_OPERATION', 'CSV vem de uma planilha ou tabela (targetId).');
}

export function exportDocument(e: Engine, format: string, opts: { targetId?: string | null; options?: Record<string, any> } = {}) {
  const f = fmt(format);
  const o = opts.options ?? {};
  const name = safeName(e.doc.document.name);
  const target = opts.targetId ? e.get(opts.targetId) : null;
  const model = (): ImportModel => readDocument(e, target && !['TABLE', 'CHART', 'DIAGRAM'].includes(target.type) ? target.id : undefined);
  const page = () => { const s = setupFor(e, null); return { width: s.width, height: s.height, margins: s.margins }; };
  let data: string | Uint8Array;
  switch (f) {
    case 'TXT': data = toTxt(model()); break;
    case 'MD': data = toMarkdown(model()); break;
    case 'HTML': data = toHtml(model()); break;
    case 'JSON': data = JSON.stringify({ format: 'hallan-editor-document', version: 1, document: e.doc }, null, 2); break;
    case 'CSV': {
      const id = target?.id ?? (e.state.activeSurface && (e.find(e.state.activeSurface)?.data.surfaceType === 'SHEET') ? e.state.activeSurface : Object.values(e.doc.nodes).find((n) => n.type === 'TABLE' || n.data.surfaceType === 'SHEET')?.id);
      if (!id) fail('INVALID_OPERATION', 'Não há planilha nem tabela para exportar em CSV.');
      data = (o.bom ? '﻿' : '') + toCsv(tableRowsOf(e, id!), { delimiter: o.delimiter, decimal: o.decimal });
      break;
    }
    case 'XLSX': {
      const m = model();
      const tables = m.sheets?.length ? undefined : Object.values(e.doc.nodes).filter((n) => n.type === 'TABLE').map((n, i) => ({ name: `Tabela ${i + 1}`, rows: tableRowsOf(e, n.id) }));
      data = toXlsx(m, tables);
      break;
    }
    case 'DOCX': data = toDocx(model(), page()); break;
    case 'PPTX': data = toPptx(model()); break;
    case 'PDF': data = toPdf(model(), page()); break;
    case 'SVG': {
      const t = target ?? (e.state.activeSurface ? e.find(e.state.activeSurface) : undefined);
      if (t?.type === 'CHART') data = chartSvg(chartData(e, t), String(t.data.title?.text ?? ''), Number(t.layout.width ?? 640), Number(t.layout.height ?? 400));
      else if (t?.type === 'DIAGRAM') data = diagramSvg(t.data);
      else if (t?.type === 'SURFACE' && t.data.surfaceType === 'SLIDE') { const m = readDocument(e, t.id); data = slideSvg(m.slides![0], m.slideSize!); }
      else return fail('INVALID_OPERATION', 'SVG sai de um slide, gráfico ou diagrama (targetId).');
      break;
    }
    default: return fail('VALIDATION', `Formato ${f} não exporta.`);
  }
  return { format: f, fileName: `${safeName(o.fileName ?? (target && target.type !== 'SURFACE' ? `${name}-${target.type.toLowerCase()}` : name))}.${FORMATS[f].ext}`, mimeType: FORMATS[f].mime, data };
}

const text = (c: unknown) => (typeof c === 'string' ? c : c instanceof Uint8Array ? new TextDecoder().decode(c) : fail('INVALID_PAYLOAD', 'content: texto do arquivo.'));

/** Formatos de texto → modelo (síncrono). */
export function parseTextFormat(format: string, content: unknown, opts: Record<string, any> = {}): ImportModel {
  const f = fmt(format);
  const src = text(content);
  switch (f) {
    case 'TXT': return fromTxt(src);
    case 'MD': return fromMarkdown(src);
    case 'HTML': return fromHtml(src);
    case 'CSV': { const rows = parseCsv(src, opts); return { sheets: [sheetFromRows(opts.sheetName ?? 'Importado', rows)], blocks: [{ kind: 'table', header: true, rows }] }; }
    default: return fail('INVALID_OPERATION', `${f} é um pacote compactado: use importFile() (leitura assíncrona).`);
  }
}

/** Qualquer formato → modelo. */
export async function parseFile(format: string, data: Uint8Array | string, opts: Record<string, any> = {}): Promise<ImportModel> {
  const f = fmt(format);
  if (!ZIPPED.includes(f)) return parseTextFormat(f, data, opts);
  const bytes = typeof data === 'string' ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : data;
  return f === 'XLSX' ? fromXlsx(bytes) : f === 'DOCX' ? fromDocx(bytes) : fromPptx(bytes);
}

/** Importa um arquivo para o documento aberto (uma transação; desfazer tira tudo). */
export async function importFile(e: Engine, file: { format?: string; name?: string; data: Uint8Array | string; parentId?: string; options?: Record<string, any> }) {
  const f = file.format ?? (file.name ? formatOf(file.name) : fail('INVALID_PAYLOAD', 'Informe format ou name.'));
  if (fmt(f) === 'JSON') return e.run({ type: 'IMPORT', payload: { format: 'JSON', content: text(file.data), parentId: file.parentId } });
  const model = await parseFile(f!, file.data, file.options);
  return e.run({ type: 'IMPORT', payload: { model, parentId: file.parentId } });
}

/** Abre um arquivo como documento novo (aplicação escolhida pelo conteúdo). */
export async function openFile(make: (app: Application) => Engine, file: { format?: string; name?: string; data: Uint8Array | string }): Promise<DocumentModel> {
  const f = fmt(file.format ?? (file.name ? file.name.split('.').pop() : ''));
  if (f === 'JSON') {
    const parsed = JSON.parse(text(file.data));
    const doc: DocumentModel = parsed.format === 'hallan-editor-document' ? parsed.document : parsed;
    if (!doc?.nodes || !doc.document) fail('VALIDATION', 'JSON não é um documento do editor.');
    return repair(clone(doc)).doc;
  }
  const model = await parseFile(f, file.data);
  if (f === 'CSV') delete model.blocks;
  if (file.name && !model.name) model.name = file.name.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
  return documentFromModel(make, model);
}

/** Converte vários arquivos (qualquer formato de entrada e saída). */
export async function convertFiles(make: (app: Application) => Engine, files: { name: string; data: Uint8Array | string; format?: string }[], to: string) {
  const out: { name: string; ok: boolean; fileName?: string; mimeType?: string; data?: string | Uint8Array; error?: string }[] = [];
  for (const file of files) {
    try {
      const doc = await openFile(make, file);
      const e = make(doc.document.application);
      e.doc = doc;
      e.state.activeSurface = Object.values(doc.nodes).find((n) => n.type === 'SURFACE' || n.type === 'BLOCK')?.id ?? null;
      const r = exportDocument(e, to, { options: { fileName: file.name.replace(/\.[^.]+$/, '') } });
      out.push({ name: file.name, ok: true, fileName: r.fileName, mimeType: r.mimeType, data: r.data });
    } catch (err) { out.push({ name: file.name, ok: false, error: (err as Error).message }); }
  }
  return out;
}

/** Páginas para imprimir/visualizar. */
export function printLayout(e: Engine) {
  const st: Record<string, any> = { range: 'ALL', copies: 1, scale: 100, ...(e.doc.document.settings.print ?? {}) };
  const app = e.doc.document.application;
  let pages: any[];
  if (app === 'PRESENTATION_EDITOR') {
    const size = e.doc.document.settings.slide ?? { width: 1280, height: 720 };
    pages = Object.values(e.doc.nodes).filter((n) => n.type === 'SURFACE' && n.data.surfaceType === 'SLIDE' && n.metadata.visible !== false)
      .sort((a, b) => a.order - b.order).map((s, i) => ({ number: i + 1, surfaceId: s.id, width: size.width, height: size.height }));
  } else if (app === 'SPREADSHEET_EDITOR') {
    const s = setupFor(e, null);
    const sheets = Object.values(e.doc.nodes).filter((n) => n.data.surfaceType === 'SHEET').sort((a, b) => a.order - b.order);
    const scale = (st.scale ?? 100) / 100;
    const perPage = { rows: Math.max(1, Math.floor((s.height - s.margins.top - s.margins.bottom) / (24 * scale))), cols: Math.max(1, Math.floor((s.width - s.margins.left - s.margins.right) / (100 * scale))) };
    const repeat = Number(st.repeatRows ?? 0);
    pages = [];
    for (const sh of sheets) {
      const m = sheetMatrix(readDocument(e, sh.id).sheets![0]);
      const R = m.length, C = Math.max(0, ...m.map((r) => r.length));
      if (!R) continue;
      const rowsPer = Math.max(1, perPage.rows - repeat);
      for (let c0 = 0; c0 < C; c0 += perPage.cols) for (let r0 = 0; r0 < R; r0 += r0 === 0 ? perPage.rows : rowsPer) {
        const r1 = Math.min(R, r0 + (r0 === 0 ? perPage.rows : rowsPer)), c1 = Math.min(C, c0 + perPage.cols);
        const col = (n: number) => { let s2 = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s2 = String.fromCharCode(65 + ((n - 1) % 26)) + s2; return s2; };
        pages.push({ number: pages.length + 1, surfaceId: sh.id, sheet: sh.data.name, range: `${col(c0 + 1)}${r0 + 1}:${col(c1)}${r1}`, ...(repeat && r0 > 0 ? { repeatRows: `1:${repeat}` } : {}), width: s.width, height: s.height });
        if (st.fitToPage) break;
      }
    }
  } else pages = paginate(e).map((p) => ({ ...p }));
  // intervalo: "1-3,5"
  const range = String(st.range ?? 'ALL').replace(/\s/g, '');
  if (/^\d/.test(range)) {
    const want = new Set<number>();
    for (const part of range.split(',')) { const [a, b] = part.split('-').map(Number); for (let k = a; k <= (b || a); k++) want.add(k); }
    pages = pages.filter((p) => want.has(p.number));
  }
  return { application: app, copies: st.copies ?? 1, scale: st.scale ?? 100, pages };
}

export const ioHandlers: Record<string, Handler> = {
  /** EXPORT { format, targetId?, options? { delimiter, decimal, bom, fileName } } */
  EXPORT: (e, op) => exportDocument(e, op.payload?.format, { targetId: op.targetId ?? op.payload?.targetId, options: op.payload?.options }),
  /** IMPORT { format, content, parentId?, options? } | { model, parentId? } — entra no documento aberto. */
  IMPORT: (e, op) => {
    const p = op.payload ?? {};
    if (p.model) return buildFromModel(e, p.model as ImportModel, p.parentId);
    const f = fmt(p.format);
    if (f === 'JSON') {
      const parsed = JSON.parse(text(p.content));
      const src: DocumentModel = parsed.format === 'hallan-editor-document' ? parsed.document : parsed;
      if (!src?.nodes || !src.document?.rootId) fail('VALIDATION', 'JSON não é um documento do editor.');
      const fixed = checkIntegrity(src).length ? repair(clone(src)).doc : src;
      for (const col of ['styles', 'themes', 'assets'] as const) for (const [id, v] of Object.entries(fixed[col] ?? {})) if (!(e.doc[col] as any)[id]) e.put(col, id, clone(v));
      const root = e.doc.document.rootId;
      return fixed.nodes[fixed.document.rootId].children.map((cid) => insertSubtree(e, cloneSubtree(e, fixed.nodes, cid), root).id);
    }
    return buildFromModel(e, parseTextFormat(f, p.content, p.options), p.parentId);
  },
  PRINT_LAYOUT: (e) => printLayout(e),
  /** CONVERT_BATCH { files: [{ name, content, format? }], to } — formatos de texto (sem ZIP); convertFiles() faz todos. */
  CONVERT_BATCH: (e, op) => {
    const p = op.payload ?? {};
    const to = fmt(p.to);
    if (!Array.isArray(p.files) || !p.files.length) fail('INVALID_PAYLOAD', 'Informe files.');
    const make = e.services.makeEngine as ((app: Application) => Engine) | undefined;
    if (!make) fail('INVALID_OPERATION', 'Conversão precisa de services.makeEngine (o index registra).');
    return p.files.map((file: any) => {
      try {
        const f = fmt(file.format ?? String(file.name).split('.').pop());
        if (ZIPPED.includes(f)) return { name: file.name, ok: false, error: `${f}: use convertFiles() (leitura assíncrona).` };
        const model = parseTextFormat(f, file.content);
        if (f === 'CSV') delete model.blocks;
        model.name = String(file.name).replace(/\.[^.]+$/, '');
        const doc = documentFromModel(make!, model);
        const x = make!(doc.document.application);
        x.doc = doc;
        x.state.activeSurface = Object.values(doc.nodes).find((n) => n.type === 'SURFACE' || n.type === 'BLOCK')?.id ?? null;
        const r = exportDocument(x, to);
        return { name: file.name, ok: true, fileName: r.fileName, mimeType: r.mimeType, data: r.data };
      } catch (err) { return { name: file.name, ok: false, error: (err as Error).message }; }
    });
  },
};
