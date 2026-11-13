// Visão de apresentação: miniaturas, palco com posicionamento livre (arrastar, redimensionar, editar texto no
// lugar) e modo de apresentação em tela cheia, passo a passo com as animações.
import type { Engine, EditorNode } from '../editor-core/index.ts';
import { h, runsHtml, toast } from './dom.ts';
import { resolveStyle } from '../editor-core/ops/format.ts';
import { chartData } from '../editor-core/charts/chart.ts';
import { chartSvg, diagramSvg, slideSvg } from '../editor-core/io/svg.ts';
import { readDocument } from '../editor-core/io/model.ts';
import katex from 'katex';
import { shapeSvg } from '../editor-core/io/shapes.ts';
import { imageClip, imageFilter, tableCellLook } from '../editor-core/ops/objects.ts';

const BASE: Record<string, number> = { TITLE: 44, SUBTITLE: 28, HEADING_1: 36, HEADING_2: 30, HEADING_3: 26 };
const textOf = (n: EditorNode) => (n.data.runs ?? []).map((r: any) => r.text).join('');

/** Desenha um elemento do slide (usado no palco e na apresentação). */
export function slideItem(e: Engine, n: EditorNode): HTMLElement {
  const L = n.layout, st = resolveStyle(e, n.id) as Record<string, any>;
  const el = h('div', { class: `sl-item sl-${n.type.toLowerCase()}`, 'data-node-id': n.id });
  Object.assign(el.style, { left: `${L.x ?? 0}px`, top: `${L.y ?? 0}px`, width: `${L.width ?? 200}px`, height: `${L.height ?? 60}px`, transform: L.rotation ? `rotate(${L.rotation}deg)` : '', zIndex: String(L.zIndex ?? n.order), opacity: st.opacity !== undefined ? String(st.opacity) : '' });
  const text = () => { const t = h('div', { class: 'sl-text', html: runsHtml(n.data.runs) || '' }); t.style.fontSize = `${typeof st.fontSize === 'number' && n.type !== 'TEXT' ? st.fontSize * 1.333 : BASE[n.data.textType] ?? (typeof st.fontSize === 'number' ? st.fontSize * 1.6 : 22)}px`; if (st.color) t.style.color = String(st.color); if (st.align) t.style.textAlign = String(st.align).toLowerCase(); if (st.bold) t.style.fontWeight = '700'; return t; };
  switch (n.type) {
    case 'TEXT': el.append(text()); if (st.fill && n.styleOverrides.fill) el.style.background = String(st.fill); break;
    case 'SHAPE': {
      // desenho da biblioteca de formas do motor (também nas formas combinadas e de pontos editados)
      const w = Math.max(1, Number(L.width ?? 200)), hh = Math.max(1, Number(L.height ?? 60));
      const dash = st.strokeStyle === 'DASHED' ? '8 5' : st.strokeStyle === 'DOTTED' ? '2 4' : undefined;
      el.innerHTML = `<svg class="sl-shape-svg" width="100%" height="100%" viewBox="0 0 ${w} ${hh}" preserveAspectRatio="none" overflow="visible">${shapeSvg(n.data, w, hh, { fill: String(n.styleOverrides.fill ?? st.fill ?? '#4472C4'), stroke: st.stroke ? String(st.stroke) : undefined, strokeWidth: Number(st.strokeWidth ?? 2), dash })}</svg>`;
      if (n.data.runs) { const t = text(); t.classList.add('sl-center'); el.append(t); }
      break;
    }
    case 'IMAGE': {
      const a = e.doc.assets[n.data.assetId];
      if (!a) { el.append(h('div', { class: 'sl-missing' }, 'imagem')); break; }
      const img = h('img', { src: a.source, alt: n.data.alt ?? '', draggable: 'false' }) as HTMLImageElement;
      const adj = n.data.adjust;
      img.style.filter = imageFilter(adj);
      if (adj?.transparency) img.style.opacity = String(1 - adj.transparency);
      img.style.clipPath = imageClip(n.data.crop);
      if (L.flipH || L.flipV) img.style.transform = `scale(${L.flipH ? -1 : 1},${L.flipV ? -1 : 1})`;
      el.append(img); break;
    }
    case 'LINE': el.innerHTML = `<svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 ${Math.max(1, Number(L.width ?? 1))} ${Math.max(1, Number(L.height ?? 1))}"><line x1="0" y1="0" x2="${L.width ?? 1}" y2="${L.height ?? 1}" stroke="${st.stroke ?? '#404040'}" stroke-width="${st.strokeWidth ?? 3}"/></svg>`; break;
    case 'TABLE': {
      const t = h('table', { class: 'sl-table' });
      (n.data.rows ?? []).forEach((row: any, i: number) => t.append(h('tr', {}, ...row.cells.map((c: any, ci: number) => {
        const cell = h(i === 0 && n.data.header !== false ? 'th' : 'td', {}, String(c.error?.code ?? c.calculatedValue ?? c.value ?? ''));
        const lk = tableCellLook(n.data, i, ci);
        if (lk.fill) cell.style.background = lk.fill;
        if (lk.ink) cell.style.color = lk.ink;
        if (lk.bold) cell.style.fontWeight = '700';
        return cell;
      }))));
      el.append(t); break;
    }
    case 'CHART': el.innerHTML = chartSvg(chartData(e, n), String(n.data.title?.text ?? ''), Number(L.width ?? 600), Number(L.height ?? 360)); break;
    case 'DIAGRAM': el.innerHTML = diagramSvg(n.data); el.querySelector('svg')?.setAttribute('width', '100%'); el.querySelector('svg')?.setAttribute('height', '100%'); break;
    case 'EQUATION': try { el.innerHTML = katex.renderToString(String(n.data.latex ?? ''), { throwOnError: false, displayMode: true }); } catch { el.textContent = n.data.latex; } break;
    case 'GROUP': for (const c of n.children) { const child = slideItem(e, e.get(c)); child.style.left = `${Number(e.get(c).layout.x ?? 0) - Number(L.x ?? 0)}px`; child.style.top = `${Number(e.get(c).layout.y ?? 0) - Number(L.y ?? 0)}px`; el.append(child); } break;
    default: el.append(h('div', { class: 'sl-missing' }, n.type));
  }
  return el;
}

export function slideBackground(e: Engine, s: EditorNode) {
  const bg = s.data.background;
  return bg?.color ?? (bg?.gradient ? `linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.from}, ${bg.gradient.to})` : String(s.styleOverrides.fill ?? '#FFFFFF'));
}

export class SlideView {
  e: Engine;
  host: HTMLElement;
  rail: HTMLElement;
  stage: HTMLElement;
  canvas: HTMLElement;
  onSelect: () => void = () => {};
  private editing: string | null = null;
  private lastDown: { id: string; at: number } | null = null;

  constructor(e: Engine, host: HTMLElement) {
    this.e = e; this.host = host;
    this.rail = h('nav', { class: 'sl-rail', 'aria-label': 'Slides' });
    this.canvas = h('div', { class: 'sl-canvas', tabindex: '0', 'aria-label': 'Slide atual' });
    this.stage = h('div', { class: 'sl-stage' }, this.canvas);
    host.replaceChildren(this.rail, this.stage);
    this.canvas.addEventListener('pointerdown', (ev) => this.pointerDown(ev));
    this.canvas.addEventListener('keydown', (ev) => this.key(ev));
    new ResizeObserver(() => this.fit()).observe(this.stage);
    this.render();
  }

  get size() { return this.e.doc.document.settings.slide ?? { width: 1280, height: 720 }; }
  slides() { const out: EditorNode[] = []; const walk = (id: string) => { const n = this.e.doc.nodes[id]; if (!n) return; if (n.type === 'SURFACE' && n.data.surfaceType === 'SLIDE') out.push(n); n.children.forEach(walk); }; walk(this.e.doc.document.rootId); return out; }
  current() { const id = this.e.state.activeSurface; const n = id ? this.e.find(id) : undefined; return n?.data.surfaceType === 'SLIDE' ? n : this.slides()[0]; }

  run(op: any) { const r = this.e.execute(op); if (!r.ok) { toast(r.error.message, 'error'); this.render(); } return r; }

  private fit() {
    const k = this.e.state.zoom / 100;
    const auto = Math.min((this.stage.clientWidth - 48) / this.size.width, (this.stage.clientHeight - 48) / this.size.height);
    const scale = this.e.state.view?.fullscreen ? auto : Math.min(auto, 1) * k;
    this.canvas.style.transform = `scale(${Math.max(0.05, scale)})`;
    this.canvas.style.margin = `${Math.max(16, (this.stage.clientHeight - this.size.height * scale) / 2)}px 0 0 ${Math.max(16, (this.stage.clientWidth - this.size.width * scale) / 2)}px`;
    this.stage.style.setProperty('--sl-scale', String(scale));
    (this as any).scale = scale;
  }

  render() {
    if (this.editing) return;   // não redesenha enquanto o texto está sendo editado no lugar
    const cur = this.current();
    if (cur && this.e.state.activeSurface !== cur.id) this.e.state.activeSurface = cur.id;
    // miniaturas
    const size = this.size;
    this.rail.replaceChildren(...this.slides().map((s, i) => {
      const m = readDocument(this.e, s.id).slides?.[0];
      const thumb = h('button', { class: `sl-thumb${s.id === cur?.id ? ' is-active' : ''}${s.metadata.visible === false ? ' is-hidden' : ''}`, type: 'button', 'aria-label': `Slide ${i + 1}`, 'aria-current': s.id === cur?.id ? 'true' : null, onclick: () => { this.e.state.activeSurface = s.id; this.e.state.selection = { selectedIds: [], primaryId: null, mode: 'NONE' }; this.render(); this.onSelect(); } },
        h('span', { class: 'sl-num' }, String(i + 1)), h('span', { class: 'sl-mini', html: m ? slideSvg(m, size) : '' }));
      return thumb;
    }), h('button', { class: 'ed-btn sl-add', type: 'button', onclick: () => this.addSlide() }, '+ Slide'));
    // palco
    Object.assign(this.canvas.style, { width: `${size.width}px`, height: `${size.height}px`, background: cur ? slideBackground(this.e, cur) : '#fff' });
    const sel = new Set(this.e.state.selection.selectedIds);
    this.canvas.replaceChildren(...(cur ? cur.children.map((c) => this.e.get(c)).filter((n) => n.metadata.visible !== false).map((n) => {
      const el = slideItem(this.e, n);
      if (sel.has(n.id)) { el.classList.add('is-selected'); if (sel.size === 1 && !n.metadata.locked) el.append(h('span', { class: 'sl-handle', 'data-handle': 'se', 'aria-hidden': 'true' })); }
      if (n.metadata.locked) el.classList.add('is-locked');
      return el;
    }) : []));
    this.fit();
  }

  addSlide() {
    const cur = this.current();
    const r = this.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SLIDE', index: cur ? cur.order + 1 : undefined } });
    if (r.ok) {
      this.e.state.activeSurface = r.value as string;
      this.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: r.value, data: { textType: 'TITLE', text: 'Título' }, layout: { x: 80, y: 60, width: this.size.width - 160, height: 90 } } });
      this.render();
    }
  }

  /** Insere um elemento no centro do slide atual. */
  insert(contentType: string, data: Record<string, unknown>, size: [number, number]) {
    const cur = this.current();
    if (!cur) return;
    const [w, hgt] = size;
    const r = this.run({ type: 'INSERT_CONTENT', payload: { contentType, parentId: cur.id, data, layout: { x: Math.round((this.size.width - w) / 2), y: Math.round((this.size.height - hgt) / 2), width: w, height: hgt } } });
    if (r.ok) { this.e.state.selection = { selectedIds: [r.value.id], primaryId: r.value.id, mode: 'SINGLE' }; this.render(); this.onSelect(); }
  }

  // ---------------------------------------------------------------- arrastar e redimensionar

  private pointerDown(ev: PointerEvent) {
    if (this.editing) return;
    const target = ev.target as HTMLElement;
    const itemEl = target.closest<HTMLElement>('.sl-item');
    const scale = (this as any).scale ?? 1;
    if (!itemEl) { this.e.state.selection = { selectedIds: [], primaryId: null, mode: 'NONE' }; this.render(); this.onSelect(); return; }
    const id = itemEl.dataset.nodeId!;
    // duplo clique feito à mão: o redesenho troca o elemento entre os cliques e o navegador não dispara dblclick
    const now = performance.now();
    const onHandle = target.dataset.handle === 'se';
    if (!onHandle && this.lastDown && this.lastDown.id === id && now - this.lastDown.at < 400) { this.lastDown = null; ev.preventDefault(); this.startEdit(ev); return; }
    this.lastDown = null;   // só um toque parado (sem arrastar, fora da alça) conta para o duplo clique
    const sel = this.e.state.selection;
    if (ev.shiftKey) sel.selectedIds = sel.selectedIds.includes(id) ? sel.selectedIds.filter((x) => x !== id) : [...sel.selectedIds, id];
    else if (!sel.selectedIds.includes(id)) sel.selectedIds = [id];
    sel.primaryId = id; sel.mode = sel.selectedIds.length > 1 ? 'MULTIPLE' : 'SINGLE';
    this.render(); this.onSelect();
    const n = this.e.get(id);
    if (n.metadata.locked) return;
    const resizing = target.dataset.handle === 'se';
    const startX = ev.clientX, startY = ev.clientY;
    const els = sel.selectedIds.map((x) => this.canvas.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(x)}"]`)).filter(Boolean) as HTMLElement[];
    let dx = 0, dy = 0;
    this.canvas.setPointerCapture(ev.pointerId);
    const move = (m: PointerEvent) => {
      dx = (m.clientX - startX) / scale; dy = (m.clientY - startY) / scale;
      if (resizing) { const el = els[0]; el.style.width = `${Math.max(10, Number(n.layout.width) + dx)}px`; el.style.height = `${Math.max(10, Number(n.layout.height) + dy)}px`; }
      else for (const el of els) el.style.translate = `${dx}px ${dy}px`;
    };
    const up = () => {
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) { if (!resizing) this.lastDown = { id, at: now }; return; }
      const snap = Boolean(this.e.doc.document.settings.grid?.snap && this.e.doc.document.settings.grid?.enabled);
      if (resizing) this.run({ type: 'RESIZE', targetId: id, payload: { width: Math.round(Number(n.layout.width) + dx), height: Math.round(Number(n.layout.height) + dy) } });
      else this.run({ type: 'RUN_SCRIPT', payload: { steps: sel.selectedIds.map((x) => { const l = this.e.get(x).layout; return { op: { type: 'SET_POSITION', targetId: x, payload: { x: Math.round(Number(l.x ?? 0) + dx), y: Math.round(Number(l.y ?? 0) + dy), snap } } }; }) } });
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
  }

  private key(ev: KeyboardEvent) {
    if (this.editing) return;
    const sel = this.e.state.selection.selectedIds;
    if (!sel.length) return;
    const step = ev.shiftKey ? 10 : 1;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (d[ev.key]) {
      ev.preventDefault();
      this.run({ type: 'RUN_SCRIPT', payload: { steps: sel.map((x) => { const l = this.e.get(x).layout; return { op: { type: 'SET_POSITION', targetId: x, payload: { x: Number(l.x ?? 0) + d[ev.key][0], y: Number(l.y ?? 0) + d[ev.key][1] } } }; }) } });
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.run({ type: 'DELETE', targetIds: sel }); }
    else if (ev.key === 'Enter') { const el = this.canvas.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(sel[0])}"]`); if (el) this.startEdit({ target: el } as any); }
  }

  // ---------------------------------------------------------------- texto no lugar

  private startEdit(ev: MouseEvent) {
    // com o ponteiro capturado (arrastar), o duplo clique chega no palco: acha o elemento pela posição
    const hit = ev.clientX !== undefined ? document.elementFromPoint(ev.clientX, ev.clientY) : null;
    const itemEl = ((hit as HTMLElement | null) ?? (ev.target as HTMLElement)).closest<HTMLElement>('.sl-item') ?? (ev.target as HTMLElement).closest<HTMLElement>('.sl-item');
    const n = itemEl && this.e.find(itemEl.dataset.nodeId);
    if (!n || !Array.isArray(n.data.runs) && n.type !== 'SHAPE' || n.metadata.locked) return;
    if (!n.data.runs) this.run({ type: 'UPDATE', targetId: n.id, payload: { data: { runs: [{ id: 'r', text: '', format: {} }] } } });
    this.render();
    const el = this.canvas.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(n.id)}"] .sl-text`);
    if (!el) return;
    this.editing = n.id;
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    el.focus();
    document.getSelection()?.selectAllChildren(el);
    const finish = () => {
      el.removeEventListener('blur', finish);
      const id = this.editing!; this.editing = null;
      const before = textOf(this.e.get(id)), after = (el.innerText ?? '').replace(/\n$/, '');
      if (before !== after) {
        let a = 0; while (a < before.length && a < after.length && before[a] === after[a]) a++;
        let z = 0; while (z < before.length - a && z < after.length - a && before[before.length - 1 - z] === after[after.length - 1 - z]) z++;
        this.run({ type: 'TEXT_SPLICE', targetId: id, payload: { start: a, end: before.length - z, text: after.slice(a, after.length - z) } });
      }
      this.render();
    };
    el.addEventListener('blur', finish);
    el.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Escape') el.blur(); });
  }
}

// ---------------------------------------------------------------- apresentação em tela cheia

export function present(e: Engine, from: 'start' | 'current' = 'start') {
  const r = e.execute({ type: 'PRESENT_START', payload: from === 'current' ? { current: true } : {} });
  if (!r.ok) return toast(r.error.message, 'error');
  const size = e.doc.document.settings.slide ?? { width: 1280, height: 720 };
  const stage = h('div', { class: 'pr-slide' });
  const counter = h('div', { class: 'pr-count', 'aria-live': 'polite' });
  const overlay = h('div', { class: 'pr-overlay', role: 'dialog', 'aria-label': 'Apresentação', tabindex: '-1' }, stage, counter);
  document.body.append(overlay);
  overlay.requestFullscreen?.().catch(() => {});
  let lastSlide = '';
  const draw = (st: any) => {
    if (!st) return;
    const slide = e.get(st.slideId);
    const k = Math.min(window.innerWidth / size.width, window.innerHeight / size.height);
    Object.assign(stage.style, { width: `${size.width}px`, height: `${size.height}px`, transform: `scale(${k})`, background: slideBackground(e, slide) });
    if (lastSlide !== st.slideId) {
      stage.replaceChildren(...slide.children.map((c) => e.get(c)).filter((n) => n.metadata.visible !== false).map((n) => slideItem(e, n)));
      if (st.transition) { stage.animate([{ opacity: 0, translate: st.transition.effect === 'PUSH' ? '40px 0' : '0 0' }, { opacity: 1, translate: '0 0' }], { duration: st.transition.duration ?? 600, easing: 'ease-out' }); }
      lastSlide = st.slideId;
    }
    const hidden = new Set(st.hidden as string[]);
    for (const el of stage.querySelectorAll<HTMLElement>('.sl-item')) {
      const was = el.style.visibility === 'hidden', now = hidden.has(el.dataset.nodeId!);
      el.style.visibility = now ? 'hidden' : 'visible';
      if (was && !now) el.animate([{ opacity: 0, transform: `${el.style.transform} scale(.96)` }, { opacity: 1, transform: el.style.transform || 'none' }], { duration: 450, easing: 'ease-out' });
    }
    counter.textContent = `${st.index + 1} / ${st.slides}`;
  };
  const end = () => { e.execute({ type: 'PRESENT_END' }); overlay.remove(); document.removeEventListener('keydown', key, true); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); e.emit('view', {}); };
  const next = () => { const s = e.execute({ type: 'PRESENT_NEXT' }); if (s.ok) { if ((s.value as any).ended) end(); else draw(s.value); } };
  const prev = () => { const s = e.execute({ type: 'PRESENT_PREV' }); if (s.ok) draw(s.value); };
  const key = (ev: KeyboardEvent) => {
    ev.stopPropagation();
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(ev.key)) { ev.preventDefault(); next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(ev.key)) { ev.preventDefault(); prev(); }
    else if (ev.key === 'Escape') end();
  };
  document.addEventListener('keydown', key, true);
  overlay.addEventListener('click', next);
  overlay.addEventListener('contextmenu', (ev) => { ev.preventDefault(); prev(); });
  window.addEventListener('resize', () => { lastSlide = ''; draw(e.execute({ type: 'PRESENT_STATE' }).value); });
  overlay.focus();
  draw(r.value);
}
