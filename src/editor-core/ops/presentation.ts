// D1 · Apresentações: o que faltava em relação ao PowerPoint.
//   Seções:       ADD_SLIDE_SECTION · RENAME_SLIDE_SECTION · REMOVE_SLIDE_SECTION · MOVE_SLIDE_SECTION · LIST_SLIDE_SECTIONS
//   Mestre:       ENSURE_MASTER · SET_MASTER (fundo, fontes, cores, rodapé, número, data) · SET_SLIDE_MASTER (ocultar elementos do mestre)
//                 (os elementos fixos do mestre — logotipo, faixas — são inseridos no slide mestre com INSERT_CONTENT)
//   Notas:        SET_SPEAKER_NOTES · LIST_NOTES
//   Apresentador: PRESENTER_VIEW (atual, próximo, notas, cronômetro) · RECORD_SLIDE_TIME / SET_SLIDE_TIMINGS (ensaiar intervalos)
//                 SET_POINTER (seta, laser, caneta, marca-texto, oculto) · SET_SCREEN (tela preta/branca) · ANNOTATE · CLEAR_ANNOTATIONS · KEEP_ANNOTATIONS
//   Mídia:        MEDIA_SETTINGS (cortar, volume, iniciar, repetir, entre slides, tela cheia, ocultar, esmaecer)
//   Saída:        HANDOUT_LAYOUT (folhetos 1–9 por página, com notas) · OUTLINE (estrutura de tópicos) · EXPORT_SLIDE_IMAGES
//   Reutilizar:   REUSE_SLIDES (de outra apresentação, mantendo ou não a formatação) · MERGE_PRESENTATION
import type { DocumentModel, EditorNode } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { clone, fail } from '../util.ts';
import { cloneSubtree, createNode, insertSubtree } from './basic.ts';
import { textOf } from './text.ts';
import { readDocument } from '../io/model.ts';
import { slideSvg } from '../io/svg.ts';
import { pointsPath } from '../io/shapes.ts';
import { masterOf } from '../io/master.ts';
export { masterOf, footerItems } from '../io/master.ts';

const settings = (e: Engine) => (e.touch('document', 'info') as any).settings as Record<string, any>;
const deck = (e: Engine) => { if (e.doc.document.application !== 'PRESENTATION_EDITOR') fail('INVALID_OPERATION', 'Vale para apresentações.'); };
export const slidesOf = (doc: DocumentModel) => {
  const out: EditorNode[] = [];
  const walk = (id: string) => { const n = doc.nodes[id]; if (!n) return; if (n.type === 'SURFACE' && n.data.surfaceType === 'SLIDE') out.push(n); n.children.forEach(walk); };
  walk(doc.document.rootId);
  return out;
};
const slide = (e: Engine, id: string | null | undefined) => { const n = e.get(id ?? e.state.activeSurface); if (n.data.surfaceType !== 'SLIDE') fail('INVALID_OPERATION', `${n.id} não é um slide.`); return n; };
const titleOf = (doc: DocumentModel, s: EditorNode) => {
  const walk = (id: string): EditorNode | undefined => { const n = doc.nodes[id]; if (!n) return; if (n.type === 'TEXT' && /TITLE|HEADING_1/.test(n.data.textType ?? '')) return n; for (const c of n.children) { const f = walk(c); if (f) return f; } };
  const t = walk(s.id);
  return t ? textOf(t) : String(s.data.title ?? '');
};
const now = (e: Engine) => ((e.services.now?.() as Date | undefined) ?? new Date()).getTime();

export const presentationHandlers: Record<string, Handler> = {
  // ---------------------------------------------------------------- seções
  /** ADD_SLIDE_SECTION { name, startSlideId? (padrão: slide ativo) } — a seção vai do slide inicial até a próxima seção. */
  ADD_SLIDE_SECTION: (e, op) => {
    deck(e);
    const name = String(op.payload?.name ?? '').trim() || 'Seção sem título';
    const start = slide(e, op.payload?.startSlideId).id;
    const st = settings(e);
    const list: any[] = st.slideSections ?? [];
    if (list.some((s) => s.startSlideId === start)) fail('VALIDATION', 'Já existe uma seção começando neste slide.');
    const id = e.newId('SECSLIDE');
    st.slideSections = [...list, { id, name, startSlideId: start, collapsed: false }];
    return id;
  },
  RENAME_SLIDE_SECTION: (e, op) => {
    const st = settings(e); const s = (st.slideSections ?? []).find((x: any) => x.id === op.payload?.id) ?? fail('NOT_FOUND', 'Seção não encontrada.');
    if (op.payload?.name !== undefined) s.name = String(op.payload.name).trim() || s.name;
    if (op.payload?.collapsed !== undefined) s.collapsed = Boolean(op.payload.collapsed);
    return clone(s);
  },
  /** Remove a seção (e, com deleteSlides: true, os slides dela). */
  REMOVE_SLIDE_SECTION: (e, op) => {
    const groups = presentationHandlers.LIST_SLIDE_SECTIONS(e, { type: 'LIST_SLIDE_SECTIONS' }) as unknown as any[];
    const g = groups.find((x) => x.id === op.payload?.id) ?? fail('NOT_FOUND', 'Seção não encontrada.');
    if (op.payload?.deleteSlides) for (const sid of g.slideIds) e.run({ type: 'DELETE', targetId: sid });
    const st = settings(e); st.slideSections = (st.slideSections ?? []).filter((x: any) => x.id !== g.id);
    return true;
  },
  /** Move a seção inteira (com os slides) para outra posição na lista de seções. */
  MOVE_SLIDE_SECTION: (e, op) => {
    const groups = presentationHandlers.LIST_SLIDE_SECTIONS(e, { type: 'LIST_SLIDE_SECTIONS' }) as unknown as any[];
    const from = groups.findIndex((x) => x.id === op.payload?.id);
    if (from < 0) fail('NOT_FOUND', 'Seção não encontrada.');
    const to = Math.max(0, Math.min(groups.length - 1, Number(op.payload?.toIndex ?? 0)));
    const [g] = groups.splice(from, 1); groups.splice(to, 0, g);
    const order = groups.flatMap((x) => x.slideIds);
    const root = e.touchNode(e.doc.document.rootId);
    const others = root.children.filter((c) => !order.includes(c));
    const firstSlide = root.children.findIndex((c) => order.includes(c));
    root.children = [...others.slice(0, firstSlide), ...order, ...others.slice(firstSlide)];
    e.normalizeOrder(root.id);
    return groups.map((x) => x.name);
  },
  LIST_SLIDE_SECTIONS: (e) => {
    const slides = slidesOf(e.doc), secs: any[] = (e.doc.document.settings as any).slideSections ?? [];
    const starts = new Map(secs.map((s) => [s.startSlideId, s]));
    const out: any[] = [];
    let cur: any = null;
    slides.forEach((s, i) => {
      const sec = starts.get(s.id);
      if (sec) { cur = { id: sec.id, name: sec.name, collapsed: Boolean(sec.collapsed), slideIds: [] }; out.push(cur); }
      else if (!cur) { cur = { id: null, name: 'Seção padrão', collapsed: false, slideIds: [] }; out.push(cur); }
      cur.slideIds.push(s.id);
      void i;
    });
    return out;
  },

  // ---------------------------------------------------------------- slide mestre
  /** Cria (se preciso) o slide mestre e devolve o id; elementos fixos são inseridos nele com INSERT_CONTENT { parentId: mestre }. */
  ENSURE_MASTER: (e) => {
    deck(e);
    const m = masterOf(e.doc);
    if (m) return m.id;
    const size = e.doc.document.settings.slide ?? { width: 1280, height: 720 };
    const n = createNode(e, { parentId: e.doc.document.rootId, nodeType: 'SURFACE', data: { surfaceType: 'MASTER', title: 'Slide mestre', footer: null }, layout: { mode: 'ABSOLUTE', width: size.width, height: size.height } });
    e.touchNode(n.id).metadata.visible = false;   // não aparece como slide; os slides é que mostram o que tem nele
    return n.id;
  },
  /** SET_MASTER { background?, fonts?: { heading, body }, colors?: { … }, footer?: { text, slideNumber, date, dateText, hideOnTitleSlide, startAt } | null } */
  SET_MASTER: (e, op) => {
    const id = presentationHandlers.ENSURE_MASTER(e, { type: 'ENSURE_MASTER' }) as string;
    const p = op.payload ?? {};
    const t = e.touchNode(id);
    if (p.background !== undefined) { if (p.background !== null && !/^#[0-9a-f]{3,8}$/i.test(p.background?.color ?? p.background)) fail('VALIDATION', 'Fundo do mestre: cor #RRGGBB.'); t.data.background = p.background === null ? null : { color: p.background.color ?? p.background }; }
    if (p.fonts !== undefined) t.data.fonts = { ...(t.data.fonts ?? {}), ...p.fonts };
    if (p.colors !== undefined) t.data.colors = { ...(t.data.colors ?? {}), ...p.colors };
    if (p.footer !== undefined) t.data.footer = p.footer === null ? null : { ...(t.data.footer ?? {}), ...p.footer };
    // fundo do mestre vale para os slides sem fundo próprio
    return { id, background: t.data.background ?? null, footer: t.data.footer ?? null, fonts: t.data.fonts ?? null, colors: t.data.colors ?? null };
  },
  /** SET_SLIDE_MASTER { hideMaster } — "Ocultar gráficos de fundo" neste slide. */
  SET_SLIDE_MASTER: (e, op) => { const s = slide(e, op.targetId); e.touchNode(s.id).data.hideMaster = Boolean(op.payload?.hideMaster); return Boolean(op.payload?.hideMaster); },

  // ---------------------------------------------------------------- notas
  SET_SPEAKER_NOTES: (e, op) => { const s = slide(e, op.targetId); e.assertEditable(s.id); e.touchNode(s.id).data.notes = String(op.payload?.notes ?? ''); return s.data.notes; },
  LIST_NOTES: (e) => slidesOf(e.doc).map((s, i) => ({ slideId: s.id, index: i + 1, title: titleOf(e.doc, s), notes: String(s.data.notes ?? '') })),

  // ---------------------------------------------------------------- apresentador
  /** Modo do apresentador: slide atual, próximo, notas, tempo decorrido, tempo no slide e a marcação ativa. */
  PRESENTER_VIEW: (e) => {
    const p = e.state.present ?? fail('INVALID_OPERATION', 'Nenhuma apresentação em andamento.');
    const pr = p as any;
    const t = now(e);
    pr.startedAt ??= t;
    if (pr.slideShownId !== p!.slideIds[p!.index]) { pr.slideShownId = p!.slideIds[p!.index]; pr.slideShownAt = t; }
    const cur = e.get(p!.slideIds[p!.index]), next = p!.slideIds[p!.index + 1] ? e.get(p!.slideIds[p!.index + 1]) : null;
    const pres = e.services.presenter ?? {};
    return {
      current: { id: cur.id, index: p!.index + 1, title: titleOf(e.doc, cur) }, next: next ? { id: next.id, index: p!.index + 2, title: titleOf(e.doc, next) } : null,
      total: p!.slideIds.length, notes: String(cur.data.notes ?? ''),
      elapsedSeconds: Math.round((t - pr.startedAt) / 1000), slideSeconds: Math.round((t - pr.slideShownAt) / 1000),
      plannedSeconds: cur.data.timing?.seconds ?? null, pointer: pres.pointer ?? 'ARROW', screen: pres.screen ?? 'NONE',
      annotations: (pres.annotations?.[cur.id] ?? []).length,
    };
  },
  /** Ensaiar intervalos: guarda quanto tempo o slide ficou na tela (avanço automático usa esse tempo). */
  RECORD_SLIDE_TIME: (e, op) => {
    const s = slide(e, op.targetId); const sec = Number(op.payload?.seconds);
    if (!(sec >= 0 && sec <= 36000)) fail('VALIDATION', 'Tempo do slide: de 0 a 36000 segundos.');
    e.touchNode(s.id).data.timing = { seconds: Math.round(sec * 10) / 10, autoAdvance: op.payload?.autoAdvance !== false };
    return e.get(s.id).data.timing;
  },
  /** SET_SLIDE_TIMINGS { use: true|false } — usar ou não os tempos ensaiados; { clear: true } apaga todos. */
  SET_SLIDE_TIMINGS: (e, op) => {
    deck(e);
    if (op.payload?.clear) for (const s of slidesOf(e.doc)) if (s.data.timing) delete e.touchNode(s.id).data.timing;
    if (op.payload?.use !== undefined) settings(e).useTimings = Boolean(op.payload.use);
    return { useTimings: e.doc.document.settings.useTimings !== false, total: slidesOf(e.doc).reduce((a, s) => a + (s.data.timing?.seconds ?? 0), 0) };
  },
  /** Ponteiro durante a apresentação: ARROW, LASER, PEN, HIGHLIGHTER, ERASER ou HIDDEN (com cor da caneta). */
  SET_POINTER: (e, op) => {
    const mode = op.payload?.mode;
    if (!['ARROW', 'LASER', 'PEN', 'HIGHLIGHTER', 'ERASER', 'HIDDEN'].includes(mode)) fail('VALIDATION', 'Ponteiro: ARROW, LASER, PEN, HIGHLIGHTER, ERASER ou HIDDEN.');
    const pres = (e.services.presenter ??= {});
    pres.pointer = mode; if (op.payload?.color) pres.color = op.payload.color;
    e.emit('presenter', { ...pres });
    return mode;
  },
  /** Tela preta (B) ou branca (W) durante a apresentação: SET_SCREEN { mode: BLACK|WHITE|NONE }. */
  SET_SCREEN: (e, op) => {
    const mode = op.payload?.mode ?? 'NONE';
    if (!['BLACK', 'WHITE', 'NONE'].includes(mode)) fail('VALIDATION', 'Tela: BLACK, WHITE ou NONE.');
    const pres = (e.services.presenter ??= {}); pres.screen = mode;
    e.emit('presenter', { ...pres });
    return mode;
  },
  /** Marcação com caneta/marca-texto no slide atual: ANNOTATE { points: [[x,y]…] (px do slide), tool, color, width }. Fica fora do documento até "manter". */
  ANNOTATE: (e, op) => {
    const s = slide(e, op.targetId ?? e.state.present?.slideIds[e.state.present.index]);
    const pts = op.payload?.points;
    if (!Array.isArray(pts) || pts.length < 2) fail('VALIDATION', 'Marcação: pelo menos 2 pontos.');
    const pres = (e.services.presenter ??= {}); pres.annotations ??= {};
    const tool = op.payload?.tool ?? 'PEN';
    (pres.annotations[s.id] ??= []).push({ points: pts, tool, color: op.payload?.color ?? (tool === 'HIGHLIGHTER' ? '#FFE08A' : '#FF0000'), width: op.payload?.width ?? (tool === 'HIGHLIGHTER' ? 16 : 3) });
    e.emit('presenter', { annotations: s.id });
    return pres.annotations[s.id].length;
  },
  CLEAR_ANNOTATIONS: (e, op) => { const pres = e.services.presenter ?? {}; if (op.targetId) delete pres.annotations?.[op.targetId]; else pres.annotations = {}; return true; },
  /** "Manter anotações": vira forma livre (linha) de verdade em cada slide marcado. */
  KEEP_ANNOTATIONS: (e) => {
    const pres = e.services.presenter ?? {};
    let count = 0;
    for (const [sid, list] of Object.entries<any[]>(pres.annotations ?? {})) {
      if (!e.find(sid)) continue;
      for (const a of list) {
        const xs = a.points.map((p: number[]) => p[0]), ys = a.points.map((p: number[]) => p[1]);
        const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(1, Math.max(...xs) - x), h = Math.max(1, Math.max(...ys) - y);
        const path = pointsPath(a.points.map((p: number[]) => [((p[0] - x) / w) * 100, ((p[1] - y) / h) * 100] as [number, number]), false);
        const n = createNode(e, { parentId: sid, nodeType: 'SHAPE', data: { shapeType: 'CUSTOM', path, annotation: a.tool }, layout: { mode: 'ABSOLUTE', x, y, width: w, height: h } });
        e.touchNode(n.id).styleOverrides = { fill: 'none', stroke: a.color, strokeWidth: a.width, ...(a.tool === 'HIGHLIGHTER' ? { opacity: 0.5 } : {}) };
        count++;
      }
    }
    pres.annotations = {};
    return count;
  },

  // ---------------------------------------------------------------- mídia
  /** MEDIA_SETTINGS { trimStart, trimEnd (s), volume (0–1), start: AUTO|CLICK, loop, playAcrossSlides, rewind, fullScreen, hideWhenNotPlaying, fadeIn, fadeOut, poster } */
  MEDIA_SETTINGS: (e, op) => {
    const n = e.get(op.targetId);
    if (n.type !== 'AUDIO' && n.type !== 'VIDEO') fail('INVALID_OPERATION', `${n.id} não é áudio nem vídeo.`);
    e.assertEditable(n.id);
    const p = op.payload ?? {}, t = e.touchNode(n.id);
    for (const k of ['trimStart', 'trimEnd', 'fadeIn', 'fadeOut'] as const) if (p[k] !== undefined) { if (typeof p[k] !== 'number' || p[k] < 0) fail('VALIDATION', `${k}: segundos ≥ 0.`); t.data[k] = p[k]; }
    if (t.data.trimStart !== undefined && t.data.trimEnd !== undefined && t.data.trimEnd <= t.data.trimStart) fail('VALIDATION', 'O fim do corte precisa vir depois do início.');
    if (p.volume !== undefined) { if (typeof p.volume !== 'number' || p.volume < 0 || p.volume > 1) fail('VALIDATION', 'Volume: de 0 a 1.'); t.data.volume = p.volume; }
    if (p.start !== undefined) { if (!['AUTO', 'CLICK', 'SEQUENCE'].includes(p.start)) fail('VALIDATION', 'Início: AUTO, CLICK ou SEQUENCE.'); t.data.start = p.start; t.data.autoplay = p.start === 'AUTO'; }
    for (const k of ['loop', 'playAcrossSlides', 'rewind', 'fullScreen', 'hideWhenNotPlaying', 'muted'] as const) if (p[k] !== undefined) t.data[k] = Boolean(p[k]);
    if (p.poster !== undefined) t.data.poster = p.poster;
    if (n.type === 'AUDIO' && (p.fullScreen || p.poster)) fail('VALIDATION', 'Tela cheia e capa são do vídeo.');
    return { trimStart: t.data.trimStart ?? 0, trimEnd: t.data.trimEnd ?? null, volume: t.data.volume ?? 1, start: t.data.start ?? (t.data.autoplay ? 'AUTO' : 'CLICK'), loop: Boolean(t.data.loop), playAcrossSlides: Boolean(t.data.playAcrossSlides) };
  },

  // ---------------------------------------------------------------- saída
  /** Folhetos: HANDOUT_LAYOUT { perPage: 1|2|3|4|6|9, notes?, orientation? } → páginas com a posição de cada slide (e linhas para anotar no de 3). */
  HANDOUT_LAYOUT: (e, op) => {
    deck(e);
    const per = Number(op.payload?.perPage ?? 6);
    if (![1, 2, 3, 4, 6, 9].includes(per)) fail('VALIDATION', 'Slides por página: 1, 2, 3, 4, 6 ou 9.');
    const land = op.payload?.orientation === 'LANDSCAPE';
    const W = land ? 1123 : 794, H = land ? 794 : 1123, M = 48;
    const grid: Record<number, [number, number]> = { 1: [1, 1], 2: [1, 2], 3: [1, 3], 4: [2, 2], 6: [2, 3], 9: [3, 3] };
    const [cols, rows] = land && per !== 3 ? [grid[per][1], grid[per][0]] : grid[per];
    const slides = slidesOf(e.doc).filter((s) => s.metadata.visible !== false);
    const size = e.doc.document.settings.slide ?? { width: 1280, height: 720 };
    const cellW = (per === 3 ? (W - 2 * M) / 2 : (W - 2 * M) / cols) - 16, cellH = (H - 2 * M - 40) / rows - 16;
    const k = Math.min(cellW / size.width, cellH / size.height);
    const pages: any[] = [];
    slides.forEach((s, i) => {
      const pi = Math.floor(i / per), j = i % per;
      pages[pi] ??= { index: pi + 1, width: W, height: H, slides: [], noteLines: per === 3 };
      const c = j % cols, r = Math.floor(j / cols);
      pages[pi].slides.push({ slideId: s.id, number: i + 1, x: Math.round(M + c * (cellW + 16)), y: Math.round(M + 40 + r * (cellH + 16)), width: Math.round(size.width * k), height: Math.round(size.height * k), ...(op.payload?.notes ? { notes: String(s.data.notes ?? '') } : {}) });
    });
    return { perPage: per, pages };
  },
  /** Estrutura de tópicos: título e textos de cada slide (para revisar o roteiro ou exportar). */
  OUTLINE: (e) => slidesOf(e.doc).map((s, i) => {
    const texts: string[] = [];
    const walk = (id: string) => { const n = e.doc.nodes[id]; if (!n) return; if (n.type === 'TEXT' && !/TITLE|HEADING_1/.test(n.data.textType ?? '')) { const t = textOf(n).trim(); if (t) texts.push(t); } n.children.forEach(walk); };
    s.children.forEach(walk);
    return { index: i + 1, slideId: s.id, title: titleOf(e.doc, s), points: texts, hidden: s.metadata.visible === false };
  }),
  /** Exporta cada slide como imagem SVG (com o mestre e o rodapé). */
  EXPORT_SLIDE_IMAGES: (e, op) => {
    deck(e);
    const only: string[] | undefined = op.payload?.slideIds;
    return slidesOf(e.doc).filter((s) => !only || only.includes(s.id)).map((s) => {
      const m = readDocument(e, s.id);
      return { slideId: s.id, name: `slide-${slidesOf(e.doc).indexOf(s) + 1}.svg`, mime: 'image/svg+xml', data: slideSvg(m.slides![0], m.slideSize!) };
    });
  },

  // ---------------------------------------------------------------- reutilizar e mesclar
  /** REUSE_SLIDES { from: DocumentModel, slideIds?, index?, keepFormatting? } — copia slides de outra apresentação para esta. */
  REUSE_SLIDES: (e, op) => {
    deck(e);
    const src = op.payload?.from as DocumentModel | undefined;
    if (!src?.nodes || !src.document) fail('INVALID_PAYLOAD', 'Informe a apresentação de origem (from).');
    const chosen = slidesOf(src!).filter((s) => !op.payload?.slideIds || op.payload.slideIds.includes(s.id));
    if (!chosen.length) fail('NOT_FOUND', 'Nenhum slide para reutilizar.');
    const root = e.doc.document.rootId;
    let index = op.payload?.index ?? (e.state.activeSurface ? e.get(root).children.indexOf(e.state.activeSurface) + 1 : e.get(root).children.length);
    const ids: string[] = [];
    // imagens da outra apresentação vêm junto
    for (const a of Object.values(src!.assets ?? {})) if (!e.doc.assets[a.id]) e.put('assets', a.id, clone(a));
    for (const s of chosen) {
      const sub = cloneSubtree(e, src!.nodes, s.id);
      if (!op.payload?.keepFormatting) for (const n of sub.nodes) { n.styleId = n.styleId && e.doc.styles[n.styleId] ? n.styleId : null; }
      else for (const n of sub.nodes) if (n.styleId && !e.doc.styles[n.styleId] && src!.styles[n.styleId]) e.put('styles', n.styleId, clone(src!.styles[n.styleId]));
      const placed = insertSubtree(e, sub, root, index++);
      ids.push(placed.id);
    }
    return ids;
  },
  /** Junta todos os slides de outra apresentação no fim desta (as seções dela viram seções aqui). */
  MERGE_PRESENTATION: (e, op) => {
    const src = op.payload?.from as DocumentModel;
    const ids = presentationHandlers.REUSE_SLIDES(e, { type: 'REUSE_SLIDES', payload: { from: src, index: e.get(e.doc.document.rootId).children.length, keepFormatting: op.payload?.keepFormatting } }) as string[];
    const srcSlides = slidesOf(src);
    const st = settings(e);
    for (const sec of (src.document.settings as any).slideSections ?? []) {
      const i = srcSlides.findIndex((s) => s.id === sec.startSlideId);
      if (i >= 0) st.slideSections = [...(st.slideSections ?? []), { id: e.newId('SECSLIDE'), name: sec.name, startSlideId: ids[i], collapsed: false }];
    }
    if (op.payload?.sectionName) st.slideSections = [...(st.slideSections ?? []).filter((s: any) => s.startSlideId !== ids[0]), { id: e.newId('SECSLIDE'), name: op.payload.sectionName, startSlideId: ids[0], collapsed: false }];
    return ids;
  },
};
