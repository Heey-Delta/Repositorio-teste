// Inserção de conteúdo (Camada 8): um único mecanismo de criação (CREATE universal) com um construtor e um
// validador por tipo. Cada construtor só sabe preparar os dados do seu tipo; ID, hierarquia, ordem, camada e
// histórico são do núcleo.
//   INTERFACE → INSERT_CONTENT { contentType, data } → construtor → validador → CREATE → NODES
// Também: estruturas (seção, superfície, região, lista, quebra), arquivos (ASSETS), atualizar e converter conteúdo.
import type { Asset, ContentType, EditorNode, Layout } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { createNode } from './basic.ts';
import { targetsOf } from './selection.ts';
import { buildTableData, recalcTable, validateTableData } from './table.ts';
import { validateChartData } from '../charts/chart.ts';
import { itemsFromOutline, layoutDiagram, validateDiagram } from './diagram.ts';
import { clone, fail, merge } from '../util.ts';

type Built = { data: Record<string, any>; layout?: Layout };
interface ContentSpec {
  /** tamanho padrão quando entra numa superfície de posicionamento livre (slide) */
  size: [number, number];
  build: (input: Record<string, any>, e: Engine) => Built;
  validate: (data: Record<string, any>, e: Engine) => void;
}

const runs = (e: Engine, input: Record<string, any>) => input.runs ?? [{ id: e.newId('RUN'), text: String(input.text ?? ''), format: {} }];
const needRuns = (d: Record<string, any>) => { if (!Array.isArray(d.runs) || d.runs.some((r: any) => typeof r.text !== 'string')) fail('VALIDATION', 'Texto inválido (runs).'); };
const oneOf = (v: unknown, list: string[], what: string) => { if (!list.includes(v as string)) fail('VALIDATION', `${what}: use ${list.join(', ')}.`); };
const assetOf = (e: Engine, id: unknown, types: Asset['type'][]) => {
  const a = e.doc.assets[id as string] ?? fail('VALIDATION', `Arquivo ${String(id)} não existe na biblioteca do documento.`);
  if (!types.includes(a.type)) fail('VALIDATION', `O arquivo ${a.name} não é ${types.join(' ou ').toLowerCase()}.`);
  return a;
};
const URL_OK = /^(https?:\/\/|mailto:|tel:|#)/i;
const withIds = <T extends Record<string, any>>(e: Engine, list: T[] = [], prefix: string) => list.map((x) => ({ ...x, id: x.id ?? e.newId(prefix) }));

export const TEXT_TYPES = ['PARAGRAPH', 'TITLE', 'SUBTITLE', 'HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6', 'QUOTE', 'CODE'];
export const SHAPE_TYPES = ['RECTANGLE', 'ROUNDED_RECTANGLE', 'SQUARE', 'CIRCLE', 'ELLIPSE', 'TRIANGLE', 'DIAMOND', 'PENTAGON', 'HEXAGON', 'POLYGON', 'STAR', 'ARROW', 'CALLOUT', 'CUSTOM'];
export const FIELD_TYPES = ['PAGE_NUMBER', 'PAGE_COUNT', 'DATE', 'TIME', 'DATETIME', 'DOC_NAME', 'AUTHOR', 'SECTION_TITLE', 'CROSS_REFERENCE', 'SLIDE_NUMBER', 'SHEET_NAME', 'TOC', 'INDEX', 'BIBLIOGRAPHY'];

export const CONTENT: Record<ContentType, ContentSpec> = {
  TEXT: {
    size: [480, 60],
    build: (i, e) => ({ data: { textType: i.textType ?? 'PARAGRAPH', runs: runs(e, i) } }),
    validate: (d) => { oneOf(d.textType, TEXT_TYPES, 'Tipo de texto'); needRuns(d); },
  },
  IMAGE: {
    size: [400, 300],
    build: (i, e) => {
      const a = e.doc.assets[i.assetId];
      const w = a?.width ?? 400, h = a?.height ?? 300, k = Math.min(1, 480 / w);
      return { data: { assetId: i.assetId, alt: i.alt ?? '', crop: i.crop ?? null }, layout: { width: Math.round(w * k), height: Math.round(h * k), lockAspectRatio: true } };
    },
    validate: (d, e) => { assetOf(e, d.assetId, ['IMAGE']); if (typeof d.alt !== 'string') fail('VALIDATION', 'Descreva a imagem (alt) para leitores de tela.'); },
  },
  SHAPE: {
    size: [160, 120],
    build: (i, e) => ({ data: { shapeType: i.shapeType ?? 'RECTANGLE', ...(i.path ? { path: i.path } : {}), ...(i.sides ? { sides: i.sides } : {}), ...(i.text !== undefined || i.runs ? { runs: runs(e, i) } : {}) } }),
    validate: (d) => { oneOf(d.shapeType, SHAPE_TYPES, 'Forma'); if (d.shapeType === 'CUSTOM' && typeof d.path !== 'string') fail('VALIDATION', 'Forma personalizada precisa do caminho vetorial (path).'); if (d.runs) needRuns(d); },
  },
  LINE: {
    size: [200, 0],
    build: (i) => ({ data: { lineType: i.lineType ?? 'STRAIGHT', start: i.start ?? { point: { x: 0, y: 0 } }, end: i.end ?? { point: { x: 200, y: 0 } }, ...(i.label ? { label: i.label } : {}) } }),
    validate: (d, e) => {
      oneOf(d.lineType, ['STRAIGHT', 'ELBOW', 'CURVED', 'CONNECTOR'], 'Linha');
      for (const k of ['start', 'end']) {
        const p = d[k];
        if (!p || (!p.targetId && !p.point)) fail('VALIDATION', `A ponta ${k} precisa de um objeto (targetId) ou de um ponto.`);
        if (p.targetId) e.get(p.targetId);
        if (p.anchor) oneOf(p.anchor, ['TOP', 'RIGHT', 'BOTTOM', 'LEFT', 'CENTER', 'AUTO'], 'Ponto de ancoragem');
      }
    },
  },
  TABLE: {
    size: [480, 160],
    build: (i, e) => ({ data: buildTableData(e, i) }),
    validate: (d) => validateTableData(d),
  },
  CHART: {
    size: [520, 320],
    build: (i) => ({ data: { chartType: i.chartType ?? 'COLUMN', source: i.source, title: i.title ?? { text: '', visible: false }, legend: i.legend ?? { visible: true, position: 'BOTTOM' }, axes: i.axes ?? {}, labels: i.labels ?? { visible: false }, series: i.series ?? [] } }),
    validate: (d, e) => validateChartData(e, d),
  },
  DIAGRAM: {
    size: [560, 360],
    build: (i, e) => ({ data: { diagramType: i.diagramType ?? 'FLOWCHART', items: i.outline ? itemsFromOutline(e, String(i.outline)) : withIds(e, i.items, 'DITEM'), connections: withIds(e, i.connections, 'DCON'), ...(i.layoutOptions ? { layoutOptions: i.layoutOptions } : {}) } }),
    validate: (d) => { validateDiagram(d); layoutDiagram(d); },
  },
  LINK: {
    size: [240, 30],
    build: (i, e) => ({ data: { url: i.url ?? null, targetId: i.targetId ?? null, ...(i.bookmark ? { bookmark: i.bookmark } : {}), runs: runs(e, { text: i.text ?? i.url ?? i.bookmark ?? '', runs: i.runs }), title: i.title ?? '' } }),
    validate: (d, e) => {
      if (!d.url && !d.targetId && !d.bookmark) fail('VALIDATION', 'O link precisa de um endereço (url), de um elemento (targetId) ou de um indicador (bookmark).');
      if (d.url && !URL_OK.test(d.url)) fail('VALIDATION', 'Endereço do link precisa começar com http(s)://, mailto:, tel: ou #.');
      if (d.targetId) e.get(d.targetId);
      needRuns(d);
    },
  },
  SYMBOL: {
    size: [40, 40],
    build: (i) => ({ data: { char: i.char, name: i.name ?? '' } }),
    validate: (d) => { if (typeof d.char !== 'string' || !d.char.length || [...d.char].length > 4) fail('VALIDATION', 'Símbolo: um caractere (ou combinação curta).'); },
  },
  EQUATION: {
    size: [320, 80],
    build: (i) => ({ data: { latex: i.latex ?? '', display: i.display ?? 'BLOCK' } }),
    validate: (d) => { if (typeof d.latex !== 'string' || !d.latex.trim()) fail('VALIDATION', 'Escreva a equação (LaTeX).'); oneOf(d.display, ['BLOCK', 'INLINE'], 'Exibição'); },
  },
  AUDIO: {
    size: [320, 54],
    build: (i) => ({ data: { assetId: i.assetId ?? null, url: i.url ?? null, autoplay: Boolean(i.autoplay), loop: Boolean(i.loop), controls: i.controls ?? true, title: i.title ?? '' } }),
    validate: (d, e) => { if (d.assetId) assetOf(e, d.assetId, ['AUDIO']); else if (!d.url || !URL_OK.test(d.url)) fail('VALIDATION', 'Áudio: escolha um arquivo ou informe um endereço.'); },
  },
  VIDEO: {
    size: [480, 270],
    build: (i) => ({ data: { assetId: i.assetId ?? null, url: i.url ?? null, autoplay: Boolean(i.autoplay), loop: Boolean(i.loop), controls: i.controls ?? true, muted: Boolean(i.muted), poster: i.poster ?? null, captions: i.captions ?? null }, layout: { lockAspectRatio: true } }),
    validate: (d, e) => { if (d.assetId) assetOf(e, d.assetId, ['VIDEO']); else if (!d.url || !URL_OK.test(d.url)) fail('VALIDATION', 'Vídeo: escolha um arquivo ou informe um endereço.'); },
  },
  FIELD: {
    size: [120, 24],
    build: (i) => ({ data: { ...i, fieldType: i.fieldType, format: i.format ?? null, targetId: i.targetId ?? null } }),
    validate: (d, e) => {
      oneOf(d.fieldType, FIELD_TYPES, 'Campo');
      if (d.fieldType === 'CROSS_REFERENCE') {
        if (d.targetId) e.get(d.targetId);
        else if (!d.bookmark || !Object.values(e.doc.nodes).some((n) => n.metadata.bookmark === d.bookmark)) fail('VALIDATION', 'Referência cruzada: informe targetId ou um indicador existente (bookmark).');
        if (d.show) oneOf(d.show, ['TEXT', 'NUMBER', 'LABEL_NUMBER', 'PAGE', 'ABOVE_BELOW'], 'Mostrar');
      }
    },
  },
  NOTE: {
    size: [320, 60],
    build: (i, e) => ({ data: { noteType: i.noteType ?? 'FOOTNOTE', runs: runs(e, i), targetId: i.targetId ?? null } }),
    validate: (d, e) => { oneOf(d.noteType, ['FOOTNOTE', 'ENDNOTE', 'SPEAKER'], 'Nota'); needRuns(d); if (d.targetId) e.get(d.targetId); },
  },
  CAPTION: {
    size: [400, 30],
    build: (i, e) => ({ data: { label: i.label ?? 'Figura', runs: runs(e, i), targetId: i.targetId ?? null } }),
    validate: (d, e) => { oneOf(d.label, ['Figura', 'Tabela', 'Gráfico', 'Quadro', 'Equação'], 'Legenda'); needRuns(d); if (d.targetId) e.get(d.targetId); },
  },
  CITATION: {
    size: [400, 30],
    build: (i, e) => ({ data: { ...(i.sourceId ? { sourceId: i.sourceId } : { source: i.source ?? {} }), page: i.page ?? null, citationStyle: i.citationStyle ?? e.doc.document.settings.citationStyle ?? 'ABNT', runs: runs(e, { text: i.text ?? '' }) } }),
    validate: (d, e) => {
      if (d.sourceId) { if (!(e.doc.document.settings.sources as any)?.[d.sourceId]) fail('VALIDATION', `Fonte ${d.sourceId} não existe na bibliografia do documento.`); }
      else if (!d.source?.title && !d.source?.author && !d.source?.authors) fail('VALIDATION', 'A citação precisa de autor ou título da fonte.');
      oneOf(d.citationStyle, ['ABNT', 'APA', 'MLA', 'CHICAGO'], 'Norma');
      if (d.source?.url && !URL_OK.test(d.source.url)) fail('VALIDATION', 'Endereço da fonte inválido.');
    },
  },
};

/** Onde inserir: o informado, o lugar do objeto selecionado ou a superfície ativa. */
function targetParent(e: Engine, explicit?: string) {
  if (explicit) return explicit;
  const p = e.find(e.state.selection.primaryId);
  if (p) {
    if (['SURFACE', 'BLOCK', 'REGION', 'SECTION'].includes(p.type)) return p.id;   // selecionou o contêiner: entra nele
    let parent = p.parentId;   // selecionou um objeto: entra ao lado dele (fora de grupos)
    while (parent && e.get(parent).type === 'GROUP') parent = e.get(parent).parentId;
    if (parent) return parent;
  }
  return e.state.activeSurface ?? e.doc.document.rootId;
}

export function insertContent(e: Engine, p: Record<string, any>): EditorNode {
  const type = p.contentType as ContentType;
  const spec = CONTENT[type] ?? fail('INVALID_PAYLOAD', `Tipo de conteúdo não suportado: ${String(type)}.`);
  const parentId = targetParent(e, p.parentId);
  const parent = e.get(parentId);
  const built = spec.build(p.data ?? {}, e);
  spec.validate(built.data, e);
  const spatial = parent.layout.mode === 'ABSOLUTE' || parent.type === 'GROUP';
  const [w, h] = spec.size;
  const layout: Layout = spatial
    ? { mode: 'ABSOLUTE', x: 40, y: 40, width: w, height: h, rotation: 0, ...built.layout, ...p.layout }
    : { mode: 'FLOW', ...built.layout, ...p.layout };
  const node = createNode(e, { parentId, nodeType: type, data: built.data, layout, styleId: p.styleId, styleOverrides: p.styleOverrides, metadata: p.metadata, index: p.index });
  if (type === 'TABLE') recalcTable(e, e.touchNode(node.id));   // tabela criada já com fórmulas
  return node;
}

const STRUCTURES = ['SECTION', 'BLOCK', 'SURFACE', 'REGION', 'LIST', 'BREAK'] as const;

export const contentHandlers: Record<string, Handler> = {
  /** INSERT_CONTENT { contentType, data, parentId?, layout?, index? } */
  INSERT_CONTENT: (e, op) => {
    const n = insertContent(e, op.payload ?? {});
    e.state.selection = { selectedIds: [n.id], primaryId: n.id, mode: 'SINGLE' };
    return clone(n);
  },

  /** Altera os dados do conteúdo e revalida (ex.: trocar o arquivo da imagem, o tipo da forma). */
  UPDATE_CONTENT: (e, op) => targetsOf(e, op).map((id) => {
    e.assertEditable(id);
    const n = e.touchNode(id);
    const spec = CONTENT[n.type as ContentType] ?? fail('INVALID_OPERATION', `${n.type} não é um conteúdo.`);
    n.data = merge(n.data, op.payload?.data ?? {});
    spec.validate(n.data, e);
    return id;
  }),

  /** Converte entre tipos compatíveis: título ↔ parágrafo, forma ↔ outra forma, gráfico ↔ outro gráfico. */
  CONVERT_CONTENT: (e, op) => targetsOf(e, op).map((id) => {
    e.assertEditable(id);
    const n = e.touchNode(id);
    const to = op.payload?.to;
    if (n.type === 'TEXT') { oneOf(to, TEXT_TYPES, 'Tipo de texto'); n.data.textType = to; }
    else if (n.type === 'SHAPE') { oneOf(to, SHAPE_TYPES, 'Forma'); n.data.shapeType = to; }
    else if (n.type === 'CHART') { n.data.chartType = to; validateChartData(e, n.data); }
    else fail('INVALID_OPERATION', `Não há conversão disponível para ${n.type}.`);
    return id;
  }),

  /**
   * INSERT_STRUCTURE { structureType, parentId?, ... }:
   *   SURFACE { surfaceType: SLIDE|SHEET|PAGE, name? } · REGION { regionType: HEADER|FOOTER|MAIN|SIDEBAR }
   *   LIST { listType: BULLET|NUMBERED|MULTILEVEL, items: ['texto', …] } · BREAK { breakType: PAGE|SECTION|COLUMN }
   *   SECTION { title? } · BLOCK { columns? }
   */
  INSERT_STRUCTURE: (e, op) => {
    const p = op.payload ?? {};
    const kind = p.structureType;
    if (!STRUCTURES.includes(kind)) fail('INVALID_PAYLOAD', `Estrutura: ${STRUCTURES.join(', ')}.`);
    const root = e.doc.document.rootId;
    if (kind === 'SURFACE') {
      oneOf(p.surfaceType, ['SLIDE', 'SHEET', 'PAGE'], 'Superfície');
      const parentId = p.parentId ?? root;
      const same = e.get(parentId).children.map((id) => e.doc.nodes[id]).filter((n) => n.type === 'SURFACE' && n.data.surfaceType === p.surfaceType);
      let data: Record<string, any>, layout: Layout;
      if (p.surfaceType === 'SHEET') {
        const names = new Set(Object.values(e.doc.nodes).filter((n) => n.data.surfaceType === 'SHEET').map((n) => n.data.name));
        let k = same.length + 1, name = p.name ?? `Planilha${k}`;
        while (!p.name && names.has(name)) name = `Planilha${++k}`;
        if (names.has(name)) fail('VALIDATION', `Já existe uma planilha chamada ${name}.`);
        data = { surfaceType: 'SHEET', name, cells: {}, rowHeights: {}, colWidths: {}, merges: [], filter: null };
        layout = { mode: 'GRID' };
      } else if (p.surfaceType === 'SLIDE') {
        const s = e.doc.document.settings.slide ?? { width: 1280, height: 720 };
        data = { surfaceType: 'SLIDE', title: p.name ?? `Slide ${same.length + 1}`, notes: '' };
        layout = { mode: 'ABSOLUTE', width: s.width, height: s.height };
      } else { data = { surfaceType: 'PAGE' }; layout = { mode: 'FLOW', direction: 'VERTICAL' }; }
      const n = createNode(e, { parentId, nodeType: 'SURFACE', data, layout, index: p.index });
      e.state.activeSurface = n.id;
      return n.id;
    }
    const parentId = targetParent(e, p.parentId);
    if (kind === 'REGION') {
      oneOf(p.regionType, ['HEADER', 'FOOTER', 'MAIN', 'SIDEBAR'], 'Região');
      if (p.applyTo !== undefined) oneOf(p.applyTo, ['ALL', 'FIRST', 'EVEN', 'ODD'], 'Páginas do cabeçalho/rodapé');
      return createNode(e, { parentId, nodeType: 'REGION', data: { regionType: p.regionType, applyTo: p.applyTo ?? 'ALL' }, layout: { mode: 'FLOW', direction: 'VERTICAL' }, index: p.regionType === 'HEADER' ? 0 : p.index }).id;
    }
    if (kind === 'BREAK') {
      oneOf(p.breakType, ['PAGE', 'SECTION', 'COLUMN'], 'Quebra');
      return createNode(e, { parentId, nodeType: 'BREAK', data: { breakType: p.breakType }, layout: { mode: 'FLOW' }, index: p.index }).id;
    }
    if (kind === 'LIST') {
      oneOf(p.listType ?? 'BULLET', ['BULLET', 'NUMBERED', 'MULTILEVEL'], 'Lista');
      const list = createNode(e, { parentId, nodeType: 'LIST', data: { listType: p.listType ?? 'BULLET', numberFormat: p.numberFormat ?? (p.listType === 'NUMBERED' ? 'DECIMAL' : 'DISC'), start: p.start ?? 1 }, layout: { mode: 'FLOW' }, index: p.index });
      for (const it of (p.items ?? ['']) as (string | { text: string; level?: number })[]) {
        const text = typeof it === 'string' ? it : it.text, level = typeof it === 'string' ? 0 : it.level ?? 0;
        const item = createNode(e, { parentId: list.id, nodeType: 'LIST_ITEM', data: { level }, layout: { mode: 'FLOW' } });
        createNode(e, { parentId: item.id, nodeType: 'TEXT', data: { textType: 'PARAGRAPH', runs: [{ id: e.newId('RUN'), text, format: {} }] }, layout: { mode: 'FLOW' } });
      }
      return list.id;
    }
    if (kind === 'SECTION') {
      const sec = createNode(e, { parentId: p.parentId ?? root, nodeType: 'SECTION', data: { title: p.title ?? '' }, layout: { mode: 'FLOW', direction: 'VERTICAL' }, index: p.index });
      createNode(e, { parentId: sec.id, nodeType: 'BLOCK', layout: { mode: 'FLOW', direction: 'VERTICAL', gap: 12 } });
      return sec.id;
    }
    return createNode(e, { parentId, nodeType: 'BLOCK', layout: { mode: 'FLOW', direction: 'VERTICAL', gap: 12, columns: p.columns ?? 1 }, index: p.index }).id;
  },

  /** Nível do item de lista (recuo): SET_LIST_LEVEL { level } ou { delta: +1 / -1 }. */
  SET_LIST_LEVEL: (e, op) => targetsOf(e, op).map((id) => {
    e.assertEditable(id);
    const n = e.touchNode(id);
    if (n.type !== 'LIST_ITEM') fail('INVALID_OPERATION', `${id} não é um item de lista.`);
    const level = op.payload?.level ?? (n.data.level ?? 0) + (op.payload?.delta ?? 1);
    n.data.level = Math.max(0, Math.min(8, level));
    return n.data.level;
  }),

  /** Biblioteca de arquivos do documento: guarda a referência; o arquivo fica no armazenamento. */
  IMPORT_ASSET: (e, op) => {
    const p = op.payload ?? {};
    oneOf(p.type, ['IMAGE', 'AUDIO', 'VIDEO', 'FILE'], 'Tipo de arquivo');
    if (!p.source || !p.name) fail('INVALID_PAYLOAD', 'Informe name e source do arquivo.');
    const id = e.newId('ASSET');
    e.put('assets', id, { id, type: p.type, name: p.name, source: p.source, mimeType: p.mimeType ?? 'application/octet-stream', size: p.size ?? 0, width: p.width, height: p.height } satisfies Asset);
    return id;
  },

  /** Troca o arquivo de uma imagem/áudio/vídeo mantendo posição, tamanho e formatação. */
  REPLACE_ASSET: (e, op) => {
    const id = op.targetId ?? fail('INVALID_PAYLOAD', 'Informe targetId.');
    e.assertEditable(id!);
    const n = e.touchNode(id!);
    if (!['IMAGE', 'AUDIO', 'VIDEO'].includes(n.type)) fail('INVALID_OPERATION', `${n.type} não usa arquivo.`);
    assetOf(e, op.payload?.assetId, [n.type as Asset['type']]);
    n.data.assetId = op.payload!.assetId;
    return id;
  },

  /** Remove da biblioteca os arquivos que nenhum elemento usa. */
  REMOVE_UNUSED_ASSETS: (e) => {
    const used = new Set(Object.values(e.doc.nodes).map((n) => n.data.assetId).filter(Boolean));
    const gone = Object.keys(e.doc.assets).filter((id) => !used.has(id));
    for (const id of gone) e.del('assets', id);
    return gone;
  },
};
