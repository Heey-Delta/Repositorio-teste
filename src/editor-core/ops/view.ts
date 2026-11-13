// Visualização e navegação (F18 e régua, F09.12).
//
// Tudo aqui é estado da TELA (engine.state), não do documento: não entra no histórico nem é salvo junto.
//   SET_VIEW        modo (EDIT, READ, PRESENT), zoom ou ajuste (largura/página), tela cheia, grade, guias, régua
//                   e marcas de formatação. Em leitura e apresentação, alterações no conteúdo são bloqueadas.
//   Apresentação    PRESENT_START / NEXT / PREV / GOTO / END — avança animação por animação, depois slide a slide
//   Navegação       GO_TO (página, título, indicador, elemento, planilha/slide, célula) · SET_ACTIVE_SURFACE ·
//                   NAVIGATE (teclado: próximo/anterior elemento, célula, slide, título)
//   Painéis         NAVIGATION_TREE (títulos/slides/planilhas) · SELECTION_PANEL (camadas)
//   Janelas         OPEN_VIEW / SWITCH_VIEW / UPDATE_VIEW / CLOSE_VIEW / LIST_VIEWS
//   Acessibilidade  READING_ORDER (texto na ordem de leitura, com texto alternativo)
//   Régua           RULER (unidade, escala, margens e recuos do parágrafo)
import type { EditorNode, EditorState } from '../types.ts';
import type { CommitHook, Engine, Handler } from '../engine.ts';
import { paginate, pageIndex, setupFor } from './page.ts';
import { stateAt } from './animation.ts';
import { textOf } from './text.ts';
import { bookmarks } from './reference.ts';
import { parseAddress, toAddress } from '../formula/parse.ts';
import { clone, fail } from '../util.ts';

const DEFAULT_VIEW: NonNullable<EditorState['view']> = { showGrid: false, showGuides: true, showRuler: true, showMarks: false, rulerUnit: 'CM', fullscreen: false };
const view = (e: Engine) => (e.state.view ??= { ...DEFAULT_VIEW });
const PX_PER: Record<string, number> = { CM: 96 / 2.54, IN: 96, PX: 1, PT: 96 / 72 };

/** Em leitura ou apresentação, o documento não muda (só comentários continuam possíveis na leitura). */
export const readOnlyHook: CommitHook = (e, { type, changes, remote }) => {
  if (remote || e.state.mode === 'EDIT') return;
  // ensaiar intervalos grava o tempo de cada slide durante a apresentação
  if (e.state.mode === 'PRESENT' && (type === 'RECORD_SLIDE_TIME' || type === 'SET_SLIDE_TIMINGS')) return;
  const allowed = e.state.mode === 'READ' ? ['comments'] : [];
  if (changes.some((c) => !allowed.includes(c.collection))) fail('LOCKED', e.state.mode === 'READ' ? 'Modo de leitura: volte para edição para alterar.' : 'Apresentação em andamento: saia da apresentação para editar.');
};
export function installView(e: Engine) { e.commitHooks.unshift(readOnlyHook); }

const surfaces = (e: Engine, type: 'SLIDE' | 'SHEET') => {
  const out: EditorNode[] = [];
  const walk = (id: string) => { const n = e.doc.nodes[id]; if (!n) return; if (n.type === 'SURFACE' && n.data.surfaceType === type) out.push(n); n.children.forEach(walk); };
  walk(e.doc.document.rootId);
  return out;
};
const surfaceOf = (e: Engine, id: string) => [id, ...e.ancestors(id)].map((x) => e.doc.nodes[x]).find((n) => n?.type === 'SURFACE') ?? null;
/** Área ativa do documento (o bloco) para documentos sem superfícies. */
const docArea = (e: Engine, id: string) => [id, ...e.ancestors(id)].map((x) => e.doc.nodes[x]).find((n) => n?.parentId === e.doc.document.rootId && ['BLOCK', 'SURFACE', 'SECTION'].includes(n.type)) ?? null;

function readingOrder(e: Engine, rootId: string) {
  const out: { nodeId: string; type: string; text: string }[] = [];
  const describe = (n: EditorNode): string => {
    if (Array.isArray(n.data.runs)) return textOf(n);
    if (n.type === 'IMAGE') return n.data.decorative ? '' : `Imagem: ${n.data.alt || 'sem descrição'}`;
    if (n.type === 'CHART') return `Gráfico: ${n.data.alt || n.data.title?.text || 'sem título'}`;
    if (n.type === 'TABLE') return `Tabela com ${n.data.rows?.length ?? 0} linhas: ` + (n.data.rows ?? []).map((r: any) => r.cells.map((c: any) => c.calculatedValue ?? c.value ?? '').join(', ')).join('; ');
    if (n.type === 'DIAGRAM') return `Diagrama: ${(n.data.items ?? []).map((i: any) => i.label).join(', ')}`;
    if (n.type === 'EQUATION') return `Equação: ${n.data.latex ?? ''}`;
    if (n.type === 'VIDEO' || n.type === 'AUDIO') return `${n.type === 'VIDEO' ? 'Vídeo' : 'Áudio'}${n.data.title ? `: ${n.data.title}` : ''}`;
    if (n.type === 'FIELD') return String(n.data.value ?? '');
    return '';
  };
  const walk = (id: string) => {
    const n = e.doc.nodes[id];
    if (!n || n.metadata.visible === false) return;
    const kids = n.children.map((c) => e.doc.nodes[c]).filter(Boolean);
    // em posição livre (slide, grupo): ordem de leitura explícita, senão de cima para baixo e da esquerda para a direita
    const spatial = n.layout.mode === 'ABSOLUTE' || n.type === 'GROUP' || (n.type === 'SURFACE' && n.data.surfaceType === 'SLIDE');
    const ordered = spatial ? [...kids].sort((a, b) => (Number(a.metadata.readingOrder ?? 1e9) - Number(b.metadata.readingOrder ?? 1e9)) || Math.round(Number(a.layout.y ?? 0) / 10) - Math.round(Number(b.layout.y ?? 0) / 10) || Number(a.layout.x ?? 0) - Number(b.layout.x ?? 0)) : kids;
    const t = describe(n);
    if (t.trim()) out.push({ nodeId: n.id, type: n.type, text: t });
    if (!n.metadata.collapsed || n.type === 'SURFACE') for (const c of ordered) walk(c.id);
  };
  walk(rootId);
  return out;
}

function navTree(e: Engine) {
  const app = e.doc.document.application;
  if (app === 'PRESENTATION_EDITOR') return surfaces(e, 'SLIDE').map((s, i) => {
    const title = e.descendants(s.id).map((x) => e.doc.nodes[x]).find((n) => n.type === 'TEXT' && ['TITLE', 'HEADING_1'].includes(n.data.textType));
    return { kind: 'SLIDE', id: s.id, index: i + 1, title: title ? textOf(title) : `Slide ${i + 1}`, hidden: s.metadata.visible === false, active: s.id === e.state.activeSurface };
  });
  if (app === 'SPREADSHEET_EDITOR') return surfaces(e, 'SHEET').map((s, i) => ({ kind: 'SHEET', id: s.id, index: i + 1, title: String(s.data.name ?? `Planilha ${i + 1}`), hidden: s.metadata.visible === false, active: s.id === e.state.activeSurface }));
  // documento: títulos em árvore, com a página de cada um
  let pages: Map<string, number> | null = null;
  try { pages = pageIndex(paginate(e)); } catch { pages = null; }
  const LEVEL: Record<string, number> = { TITLE: 0, HEADING_1: 1, HEADING_2: 2, HEADING_3: 3, HEADING_4: 4, HEADING_5: 5, HEADING_6: 6 };
  type Node = { kind: 'HEADING'; id: string; level: number; title: string; page: number | null; collapsed: boolean; children: Node[] };
  const root: Node[] = [];
  const stack: Node[] = [];
  const walk = (id: string) => {
    const n = e.doc.nodes[id];
    if (!n || n.metadata.visible === false) return;
    if (n.type === 'REGION' && ['HEADER', 'FOOTER'].includes(n.data.regionType)) return;
    if (n.type === 'TEXT' && LEVEL[n.data.textType] !== undefined && textOf(n).trim()) {
      const node: Node = { kind: 'HEADING', id: n.id, level: LEVEL[n.data.textType], title: textOf(n), page: pages?.get(n.id) ?? null, collapsed: Boolean(n.metadata.collapsed), children: [] };
      while (stack.length && stack.at(-1)!.level >= node.level) stack.pop();
      (stack.at(-1)?.children ?? root).push(node);
      stack.push(node);
    }
    n.children.forEach(walk);
  };
  walk(e.doc.document.rootId);
  return root;
}

function selectionPanel(e: Engine, surfaceId: string) {
  const layer = (id: string): any => {
    const n = e.doc.nodes[id];
    const label = n.metadata.name ?? (Array.isArray(n.data.runs) && textOf(n).trim() ? textOf(n).slice(0, 40) : { SHAPE: 'Forma', IMAGE: 'Imagem', LINE: 'Linha', TABLE: 'Tabela', CHART: 'Gráfico', DIAGRAM: 'Diagrama', GROUP: 'Grupo', TEXT: 'Texto' }[n.type as string] ?? n.type);
    return { id, type: n.type, name: label, visible: n.metadata.visible !== false, locked: n.metadata.locked === true, selected: e.state.selection.selectedIds.includes(id), ...(n.children.length && n.type === 'GROUP' ? { children: order(n) } : {}) };
  };
  const order = (n: EditorNode) => [...n.children].sort((a, b) => (Number(e.doc.nodes[b].layout.zIndex ?? e.doc.nodes[b].order) - Number(e.doc.nodes[a].layout.zIndex ?? e.doc.nodes[a].order))).map(layer);
  return order(e.get(surfaceId));
}

/** Uma posição só: página, título, indicador, elemento, superfície ou célula. */
function goTo(e: Engine, p: Record<string, any>) {
  let nodeId: string | null = null, surfaceId: string | null = null, page: number | null = null;
  if (p.page !== undefined) {
    const pages = paginate(e);
    const pg = pages.find((x) => x.number === Number(p.page)) ?? fail('NOT_FOUND', `O documento tem ${pages.length} página(s).`);
    nodeId = pg!.columns.flatMap((c) => c.items)[0]?.nodeId ?? null;
    page = pg!.number;
  } else if (p.bookmark) nodeId = bookmarks(e).get(p.bookmark) ?? fail('NOT_FOUND', `Indicador "${p.bookmark}" não existe.`);
  else if (p.heading) {
    const want = String(p.heading).toLowerCase();
    nodeId = Object.values(e.doc.nodes).find((n) => n.type === 'TEXT' && /^(TITLE|HEADING_\d)$/.test(n.data.textType ?? '') && textOf(n).toLowerCase().includes(want))?.id ?? fail('NOT_FOUND', `Nenhum título com "${p.heading}".`);
  } else if (p.surfaceId || p.sheet || p.slide !== undefined) {
    const s = p.surfaceId ? e.get(p.surfaceId)
      : p.sheet ? surfaces(e, 'SHEET').find((x) => String(x.data.name).toLowerCase() === String(p.sheet).toLowerCase()) ?? fail('NOT_FOUND', `Planilha "${p.sheet}" não existe.`)
      : surfaces(e, 'SLIDE')[Number(p.slide) - 1] ?? fail('NOT_FOUND', `Slide ${p.slide} não existe.`);
    surfaceId = s!.id;
  } else if (p.targetId) nodeId = e.get(p.targetId).id;
  if (p.cell) {
    const sheet = surfaceId ? e.get(surfaceId) : e.find(e.state.activeSurface) ?? null;
    if (sheet?.data.surfaceType !== 'SHEET') fail('INVALID_OPERATION', 'Célula só numa planilha.');
    try { parseAddress(String(p.cell)); } catch { fail('VALIDATION', `Célula inválida: ${p.cell}.`); }
    surfaceId = sheet!.id;
    e.state.activeCell = String(p.cell).toUpperCase();
  }
  if (nodeId) {
    surfaceId = surfaceOf(e, nodeId)?.id ?? docArea(e, nodeId)?.id ?? e.state.activeSurface;
    e.state.selection = { selectedIds: [nodeId], primaryId: nodeId, mode: 'SINGLE' };
    if (page === null && e.doc.document.application === 'DOCUMENT_EDITOR') { try { page = pageIndex(paginate(e)).get(nodeId) ?? null; } catch { /* sem paginação */ } }
  }
  if (!surfaceId && !nodeId) fail('INVALID_PAYLOAD', 'Informe page, heading, bookmark, targetId, surfaceId, sheet, slide ou cell.');
  if (surfaceId) e.state.activeSurface = surfaceId;
  e.emit('navigate', { surfaceId: e.state.activeSurface, nodeId, page, cell: e.state.activeCell ?? null });
  return { surfaceId: e.state.activeSurface, nodeId, page, cell: p.cell ? e.state.activeCell : null };
}

function presentState(e: Engine) {
  const p = e.state.present;
  if (!p) return null;
  const slideId = p.slideIds[p.index];
  const slide = e.get(slideId);
  const anim = stateAt(e, slide, p.step);
  return { slideId, index: p.index, slides: p.slideIds.length, step: p.step, hidden: anim.hidden, stepsDone: anim.done, transition: p.step === 0 ? slide.data.transition ?? null : null, notes: slide.data.notes ?? '' };
}

function views(e: Engine): Map<string, any> { return (e.services.views ??= new Map([['VIEW_1', { id: 'VIEW_1', activeSurface: e.state.activeSurface, zoom: e.state.zoom, mode: e.state.mode, scroll: { x: 0, y: 0 } }]])); }
const saveCurrent = (e: Engine) => { const id = e.services.currentView ?? 'VIEW_1'; const v = views(e).get(id); if (v) Object.assign(v, { activeSurface: e.state.activeSurface, zoom: e.state.zoom, mode: e.state.mode }); };

const contentSize = (e: Engine) => {
  const app = e.doc.document.application;
  if (app === 'PRESENTATION_EDITOR') { const s = e.doc.document.settings.slide ?? { width: 1280, height: 720 }; return { width: s.width, height: s.height }; }
  if (app === 'SPREADSHEET_EDITOR') return { width: 1200, height: 800 };
  const s = setupFor(e, null); return { width: s.width, height: s.height };
};

export const viewHandlers: Record<string, Handler> = {
  /** SET_VIEW { mode?, zoom?, fit? (WIDTH|PAGE) + viewport { width, height }, fullscreen?, showGrid?, showGuides?, showRuler?, showMarks?, rulerUnit? } */
  SET_VIEW: (e, op) => {
    const p = op.payload ?? {};
    if (p.mode !== undefined) {
      if (!['EDIT', 'READ', 'PRESENT'].includes(p.mode)) fail('VALIDATION', 'Modo: EDIT, READ ou PRESENT.');
      if (p.mode === 'PRESENT' && e.doc.document.application !== 'PRESENTATION_EDITOR') fail('INVALID_OPERATION', 'Apresentação vale para slides.');
      if (p.mode === 'PRESENT') return viewHandlers.PRESENT_START(e, { type: 'PRESENT_START' });
      if (e.state.mode === 'PRESENT') e.state.present = null;
      e.state.mode = p.mode;
    }
    if (p.fit !== undefined) {
      if (!['WIDTH', 'PAGE'].includes(p.fit)) fail('VALIDATION', 'Ajuste: WIDTH ou PAGE.');
      const vp = p.viewport ?? fail('INVALID_PAYLOAD', 'Ajustar precisa do tamanho da área visível (viewport).');
      const c = contentSize(e);
      const k = p.fit === 'WIDTH' ? (vp.width - 48) / c.width : Math.min((vp.width - 48) / c.width, (vp.height - 48) / c.height);
      e.state.zoom = Math.max(10, Math.min(500, Math.floor(k * 100)));
    } else if (p.zoom !== undefined) {
      const z = Number(p.zoom);
      if (!(z >= 10 && z <= 500)) fail('VALIDATION', 'Zoom: de 10% a 500%.');
      e.state.zoom = Math.round(z);
    }
    if (p.zoomIn) e.state.zoom = Math.min(500, [10, 25, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500].find((s) => s > e.state.zoom) ?? 500);
    if (p.zoomOut) e.state.zoom = Math.max(10, [...[10, 25, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500]].reverse().find((s) => s < e.state.zoom) ?? 10);
    const v = view(e);
    for (const k of ['showGrid', 'showGuides', 'showRuler', 'showMarks', 'fullscreen'] as const) if (p[k] !== undefined) v[k] = Boolean(p[k]);
    if (p.rulerUnit !== undefined) { if (!PX_PER[p.rulerUnit]) fail('VALIDATION', 'Unidade da régua: CM, IN, PX ou PT.'); v.rulerUnit = p.rulerUnit; }
    saveCurrent(e);
    e.emit('view', { mode: e.state.mode, zoom: e.state.zoom, ...clone(v) });
    return { mode: e.state.mode, zoom: e.state.zoom, ...clone(v) };
  },

  /** PRESENT_START { from? (número do slide), current? } — slides ocultos ficam de fora. */
  PRESENT_START: (e, op) => {
    if (e.doc.document.application !== 'PRESENTATION_EDITOR') fail('INVALID_OPERATION', 'Apresentação vale para slides.');
    const slideIds = surfaces(e, 'SLIDE').filter((s) => s.metadata.visible !== false).map((s) => s.id);
    if (!slideIds.length) fail('INVALID_OPERATION', 'Não há slides visíveis.');
    const from = op.payload?.current && e.state.activeSurface ? Math.max(0, slideIds.indexOf(e.state.activeSurface)) : Math.max(0, Number(op.payload?.from ?? 1) - 1);
    e.state.mode = 'PRESENT';
    e.state.present = { slideIds, index: Math.min(from, slideIds.length - 1), step: 0 };
    e.state.activeSurface = slideIds[e.state.present.index];
    e.emit('present', presentState(e));
    return presentState(e);
  },
  /** Próxima animação; acabou o slide, vai para o próximo. */
  PRESENT_NEXT: (e) => {
    const p = e.state.present ?? fail('INVALID_OPERATION', 'Nenhuma apresentação em andamento.');
    const st = presentState(e)!;
    if (!st.stepsDone) p!.step++;
    else if (p!.index < p!.slideIds.length - 1) { p!.index++; p!.step = 0; }
    else return { ...st, ended: true };
    e.state.activeSurface = p!.slideIds[p!.index];
    e.emit('present', presentState(e));
    return presentState(e);
  },
  PRESENT_PREV: (e) => {
    const p = e.state.present ?? fail('INVALID_OPERATION', 'Nenhuma apresentação em andamento.');
    if (p!.step > 0) p!.step--;
    else if (p!.index > 0) { p!.index--; p!.step = stepsOf(e, p!.slideIds[p!.index]); }   // volta ao slide anterior já completo
    e.state.activeSurface = p!.slideIds[p!.index];
    e.emit('present', presentState(e));
    return presentState(e);
  },
  PRESENT_GOTO: (e, op) => {
    const p = e.state.present ?? fail('INVALID_OPERATION', 'Nenhuma apresentação em andamento.');
    const i = Number(op.payload?.slide) - 1;
    if (!(i >= 0 && i < p!.slideIds.length)) fail('VALIDATION', `Slide de 1 a ${p!.slideIds.length}.`);
    p!.index = i; p!.step = 0;
    e.state.activeSurface = p!.slideIds[i];
    e.emit('present', presentState(e));
    return presentState(e);
  },
  PRESENT_END: (e) => { const was = Boolean(e.state.present); e.state.present = null; e.state.mode = 'EDIT'; e.emit('present', null); return was; },
  PRESENT_STATE: (e) => presentState(e),

  /** GO_TO { page | heading | bookmark | targetId | surfaceId | sheet | slide, cell? } */
  GO_TO: (e, op) => goTo(e, { ...(op.payload ?? {}), ...(op.targetId ? { targetId: op.targetId } : {}) }),
  SET_ACTIVE_SURFACE: (e, op) => {
    const s = e.get(op.targetId ?? op.payload?.surfaceId);
    if (s.type !== 'SURFACE' && !(s.parentId === e.doc.document.rootId && s.type === 'BLOCK')) fail('INVALID_OPERATION', `${s.id} não é uma página, slide ou planilha.`);
    e.state.activeSurface = s.id;
    e.state.selection = { selectedIds: [], primaryId: null, mode: 'NONE' };
    if (s.data.surfaceType === 'SHEET') e.state.activeCell = 'A1';
    saveCurrent(e);
    return s.id;
  },
  /**
   * NAVIGATE { direction: NEXT|PREV|UP|DOWN|LEFT|RIGHT|FIRST|LAST, unit?: ELEMENT|CELL|SLIDE|HEADING }
   * Sem unit: célula na planilha, elemento no resto.
   */
  NAVIGATE: (e, op) => {
    const dir = String(op.payload?.direction ?? 'NEXT').toUpperCase();
    const active = e.find(e.state.activeSurface);
    const unit = op.payload?.unit ?? (active?.data.surfaceType === 'SHEET' ? 'CELL' : 'ELEMENT');
    if (unit === 'CELL') {
      if (active?.data.surfaceType !== 'SHEET') fail('INVALID_OPERATION', 'Navegar por células só numa planilha.');
      const p = parseAddress(e.state.activeCell ?? 'A1');
      const d: Record<string, [number, number]> = { UP: [-1, 0], DOWN: [1, 0], LEFT: [0, -1], RIGHT: [0, 1], NEXT: [0, 1], PREV: [0, -1] };
      if (dir === 'FIRST') e.state.activeCell = 'A1';
      else if (dir === 'LAST') { const keys = Object.keys(active!.data.cells ?? {}).map(parseAddress); e.state.activeCell = toAddress({ row: Math.max(1, ...keys.map((k) => k.row)), col: Math.max(1, ...keys.map((k) => k.col)) }); }
      else { const [dr, dc] = d[dir] ?? fail('VALIDATION', 'Direção inválida.'); e.state.activeCell = toAddress({ row: Math.max(1, p.row + dr!), col: Math.max(1, p.col + dc!) }); }
      return { cell: e.state.activeCell };
    }
    const step = (list: string[], current: string | null) => {
      if (!list.length) return null;
      const i = current ? list.indexOf(current) : -1;
      if (dir === 'FIRST') return list[0];
      if (dir === 'LAST') return list.at(-1)!;
      const back = ['PREV', 'UP', 'LEFT'].includes(dir);
      return list[Math.max(0, Math.min(list.length - 1, i < 0 ? (back ? list.length - 1 : 0) : i + (back ? -1 : 1)))];
    };
    if (unit === 'SLIDE' || unit === 'SHEET') {
      const list = surfaces(e, unit).map((s) => s.id);
      const id = step(list, e.state.activeSurface);
      if (id) { e.state.activeSurface = id; e.state.selection = { selectedIds: [], primaryId: null, mode: 'NONE' }; }
      return { surfaceId: e.state.activeSurface };
    }
    if (unit === 'HEADING') {
      const list = readingOrder(e, e.doc.document.rootId).filter((x) => { const n = e.doc.nodes[x.nodeId]; return n.type === 'TEXT' && /^(TITLE|HEADING_\d)$/.test(n.data.textType ?? ''); }).map((x) => x.nodeId);
      const id = step(list, e.state.selection.primaryId);
      return id ? goTo(e, { targetId: id }) : { nodeId: null };
    }
    const scope = active?.id ?? e.doc.document.rootId;
    const list = readingOrder(e, scope).map((x) => x.nodeId).filter((id) => id !== scope && e.doc.nodes[id].metadata.locked !== true);
    const id = step(list, e.state.selection.primaryId);
    if (id) e.state.selection = { selectedIds: [id], primaryId: id, mode: 'SINGLE' };
    return { nodeId: id };
  },

  NAVIGATION_TREE: (e) => navTree(e),
  SELECTION_PANEL: (e, op) => selectionPanel(e, op.targetId ?? op.payload?.surfaceId ?? e.state.activeSurface ?? fail('INVALID_PAYLOAD', 'Informe o slide.')),
  /** Texto na ordem de leitura (leitor de tela, leitura em voz alta). */
  READING_ORDER: (e, op) => readingOrder(e, op.targetId ?? op.payload?.surfaceId ?? e.doc.document.rootId),

  /** Régua: unidade, escala em px na tela, margens e recuos do parágrafo selecionado. */
  RULER: (e) => {
    const v = view(e);
    const k = (e.state.zoom / 100) * PX_PER[v.rulerUnit];
    const app = e.doc.document.application;
    const size = contentSize(e);
    const margins = app === 'DOCUMENT_EDITOR' ? setupFor(e, null).margins : { top: 0, right: 0, bottom: 0, left: 0 };
    const sel = e.find(e.state.selection.primaryId);
    const st = sel ? { ...(sel.styleOverrides ?? {}) } : {};
    const toUnit = (px: number) => Math.round((px / PX_PER[v.rulerUnit]) * 100) / 100;
    return {
      unit: v.rulerUnit, visible: v.showRuler, pxPerUnit: Math.round(k * 1000) / 1000,
      length: toUnit(size.width), height: toUnit(size.height),
      marginStart: toUnit(margins.left), marginEnd: toUnit(size.width - margins.right),
      ...(sel && Array.isArray(sel.data.runs) ? { indents: { left: toUnit(Number(st.indentLeft ?? 0)), right: toUnit(Number(st.indentRight ?? 0)), firstLine: toUnit(Number(st.indentFirstLine ?? 0)) } } : {}),
    };
  },

  /** Nova janela do mesmo documento: OPEN_VIEW { surfaceId?, zoom?, mode? } → id. */
  OPEN_VIEW: (e, op) => {
    saveCurrent(e);
    const id = `VIEW_${views(e).size + 1 + Math.floor(Math.random() * 1000)}`;
    const v = { id, activeSurface: op.payload?.surfaceId ?? e.state.activeSurface, zoom: op.payload?.zoom ?? e.state.zoom, mode: op.payload?.mode ?? 'EDIT', scroll: { x: 0, y: 0 } };
    views(e).set(id, v);
    return clone(v);
  },
  /** Troca a janela ativa: o estado da tela (superfície, zoom, modo) passa a ser o dela. */
  SWITCH_VIEW: (e, op) => {
    const v = views(e).get(op.payload?.viewId) ?? fail('NOT_FOUND', 'Janela não existe.');
    saveCurrent(e);
    e.services.currentView = v.id;
    Object.assign(e.state, { activeSurface: v.activeSurface, zoom: v.zoom, mode: v.mode });
    return clone(v);
  },
  UPDATE_VIEW: (e, op) => {
    const v = views(e).get(op.payload?.viewId) ?? fail('NOT_FOUND', 'Janela não existe.');
    if (op.payload?.scroll) v.scroll = { x: Number(op.payload.scroll.x ?? 0), y: Number(op.payload.scroll.y ?? 0) };
    if (op.payload?.zoom !== undefined) v.zoom = Math.max(10, Math.min(500, Number(op.payload.zoom)));
    if ((e.services.currentView ?? 'VIEW_1') === v.id) e.state.zoom = v.zoom;
    return clone(v);
  },
  CLOSE_VIEW: (e, op) => {
    const id = op.payload?.viewId;
    if (!views(e).has(id)) fail('NOT_FOUND', 'Janela não existe.');
    if (views(e).size === 1) fail('INVALID_OPERATION', 'Não dá para fechar a última janela.');
    views(e).delete(id);
    if ((e.services.currentView ?? 'VIEW_1') === id) viewHandlers.SWITCH_VIEW(e, { type: 'SWITCH_VIEW', payload: { viewId: views(e).keys().next().value } });
    return id;
  },
  LIST_VIEWS: (e) => { saveCurrent(e); return [...views(e).values()].map((v) => ({ ...clone(v), current: v.id === (e.services.currentView ?? 'VIEW_1') })); },
};

/** Último passo de animação de um slide (para voltar a ele já completo). */
function stepsOf(e: Engine, slideId: string) { let s = 0; while (!stateAt(e, e.get(slideId), s).done && s < 500) s++; return s; }
