// Visão de documento: fluxo de texto editável. Um único contenteditable; cada parágrafo tem data-text-id e a
// digitação NUNCA altera o DOM direto — vira operação do motor (TEXT_SPLICE, TEXT_SPLIT, TEXT_MERGE_PREV…),
// e a tela é redesenhada a partir do documento. Assim desfazer, colaboração e controle de alterações valem igual.
import type { Engine, EditorNode } from '../editor-core/index.ts';
import { h, esc, runsHtml, offsetIn, placeCaret, toast } from './dom.ts';
import { chartData } from '../editor-core/charts/chart.ts';
import { chartSvg, diagramSvg } from '../editor-core/io/svg.ts';
import katex from 'katex';
import { slideItem } from './slide-view.ts';
import { listLabelsIn } from '../editor-core/ops/word.ts';
import { imageClip, imageFilter, tableCellLook } from '../editor-core/ops/objects.ts';

export interface TextPoint { id: string; offset: number }
export interface TextRange { start: TextPoint; end: TextPoint; collapsed: boolean }

const textOf = (n: EditorNode) => (n.data.runs ?? []).map((r: any) => r.text).join('');
const LEVEL: Record<string, number> = { TITLE: 0, HEADING_1: 1, HEADING_2: 2, HEADING_3: 3, HEADING_4: 4, HEADING_5: 5, HEADING_6: 6 };

export class DocView {
  e: Engine;
  root: HTMLElement;
  /** onde o cursor deve ficar depois do próximo redesenho */
  pending: { id: string; start: number; end?: number } | null = null;
  last: TextRange | null = null;
  onSelect: (r: TextRange | null) => void = () => {};
  /** duplo clique num gráfico ou diagrama (a casca abre a janela de edição) */
  onEditBlock: (n: EditorNode) => void = () => {};
  private composing = false;

  constructor(e: Engine, host: HTMLElement) {
    this.e = e;
    this.root = h('div', { class: 'ed-page', contenteditable: 'true', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Documento' });
    host.replaceChildren(this.root);
    this.root.addEventListener('beforeinput', (ev) => this.beforeInput(ev as InputEvent));
    this.root.addEventListener('compositionstart', () => { this.composing = true; });
    this.root.addEventListener('compositionend', () => { this.composing = false; this.syncFromDom(); });
    this.root.addEventListener('paste', (ev) => this.paste(ev));
    this.root.addEventListener('keydown', (ev) => this.keydown(ev));
    document.addEventListener('selectionchange', () => { const r = this.range(); if (r) { this.last = r; this.onSelect(r); } });
    this.render();
  }

  // ---------------------------------------------------------------- desenho

  render() {
    const e = this.e, doc = e.doc;
    // sem destino combinado, o cursor fica onde estava (redesenhos vindos de fora: salvar, colaborador, painel)
    if (!this.pending && document.activeElement === this.root) { const r = this.range(); if (r) this.pending = { id: r.start.id, start: r.start.offset, end: r.start.id === r.end.id ? r.end.offset : undefined }; }
    const out: Node[] = [];
    const page = e.doc.document.settings.page;
    this.root.style.setProperty('--ed-page-w', `${page?.width ?? 794}px`);
    // marca d'água e borda da página (B3)
    const st = e.doc.document.settings as Record<string, any>;
    const wm = st.watermark, pb = st.pageBorder;
    this.root.style.setProperty('--ed-wm', wm?.text ? `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><text x='300' y='300' text-anchor='middle' dominant-baseline='middle' font-family='Arial' font-weight='700' font-size='${wm.fontSize ?? 72}' fill='${wm.color}' fill-opacity='${wm.opacity}'${wm.diagonal ? " transform='rotate(-45 300 300)'" : ''}>${esc(wm.text)}</text></svg>`)}")` : wm?.assetId && doc.assets[wm.assetId] ? `url("${doc.assets[wm.assetId].source}")` : 'none');
    this.root.style.setProperty('--ed-wm-op', wm?.assetId ? String(wm.opacity ?? 0.15) : '1');
    this.root.style.outline = pb ? `${pb.width}px ${({ DOUBLE: 'double', DASHED: 'dashed', DOTTED: 'dotted' } as Record<string, string>)[pb.style] ?? 'solid'} ${pb.color}` : '';
    this.root.style.outlineOffset = pb ? `-${pb.offset ?? 24}px` : '';
    this.root.classList.toggle('has-wm', Boolean(wm));
    this.root.toggleAttribute('data-final', Boolean(st.final || st.protection));
    let hideUntil: number | null = null;
    const block = (n: EditorNode, into: Node[]) => {
      if (n.metadata.visible === false) return;
      if (n.type === 'TEXT') {
        const lvl = LEVEL[n.data.textType];
        if (hideUntil !== null) { if (lvl !== undefined && lvl <= hideUntil) hideUntil = null; else return; }
        const el = h('div', { class: `ed-p ed-${String(n.data.textType ?? 'PARAGRAPH').toLowerCase()}`, 'data-text-id': n.id, html: runsHtml(n.data.runs) || '<br>' });
        if (n.styleOverrides.align) el.style.textAlign = String(n.styleOverrides.align).toLowerCase();
        if (lvl !== undefined) {
          const btn = h('button', { class: 'ed-fold', contenteditable: 'false', type: 'button', title: n.metadata.collapsed ? 'Expandir seção' : 'Recolher seção', 'aria-expanded': String(!n.metadata.collapsed), onclick: () => e.execute({ type: n.metadata.collapsed ? 'EXPAND' : 'COLLAPSE', targetId: n.id }) }, n.metadata.collapsed ? '▸' : '▾');
          into.push(h('div', { class: 'ed-heading-row' }, btn, el));
          if (n.metadata.collapsed) hideUntil = lvl;
        } else into.push(el);
        return;
      }
      if (hideUntil !== null) return;
      switch (n.type) {
        case 'SECTION': case 'BLOCK': case 'GROUP': n.children.forEach((c) => block(doc.nodes[c], into)); return;
        case 'REGION': {
          const box: Node[] = [];
          n.children.forEach((c) => block(doc.nodes[c], box));
          into.push(h('div', { class: `ed-region ed-region-${String(n.data.regionType).toLowerCase()}`, 'data-label': n.data.regionType === 'HEADER' ? 'Cabeçalho' : n.data.regionType === 'FOOTER' ? 'Rodapé' : 'Área' }, ...box));
          return;
        }
        case 'LIST': {
          const tag = n.data.listType === 'NUMBERED' ? 'ol' : 'ul';
          const list = document.createElement(tag);
          list.className = 'ed-list';
          const labels = listLabelsIn(doc, n.id);
          for (const iid of n.children) {
            const it = doc.nodes[iid];
            // o rótulo vem do motor (1., a), IV., 1.2., •…): a lista do navegador não sabe continuar nem usar formatos por nível
            const li = h('li', { style: `margin-left:${(it.data.level ?? 0) * 24}px;list-style:none`, 'data-label': labels[iid] ?? '' });
            const kids: Node[] = [];
            it.children.forEach((c) => block(doc.nodes[c], kids));
            li.append(...kids);
            list.append(li);
          }
          into.push(list);
          return;
        }
        case 'TABLE': into.push(this.table(n)); return;
        case 'IMAGE': {
          const a = doc.assets[n.data.assetId];
          const img = a ? h('img', { src: a.source, alt: n.data.alt ?? '', style: n.layout.width ? `width:${n.layout.width}px` : '' }) as HTMLImageElement : null;
          if (img) {
            // recorte, ajustes (brilho, contraste, cinza…), transparência, giro e espelhamento vindos do motor
            img.style.filter = imageFilter(n.data.adjust);
            img.style.clipPath = imageClip(n.data.crop);
            if (n.data.adjust?.transparency) img.style.opacity = String(1 - n.data.adjust.transparency);
            const tf = [n.layout.rotation ? `rotate(${n.layout.rotation}deg)` : '', n.layout.flipH || n.layout.flipV ? `scale(${n.layout.flipH ? -1 : 1},${n.layout.flipV ? -1 : 1})` : ''].filter(Boolean).join(' ');
            if (tf) img.style.transform = tf;
          }
          into.push(h('figure', { class: 'ed-obj', contenteditable: 'false', 'data-node-id': n.id }, img ?? h('span', {}, '[imagem sem arquivo]')));
          return;
        }
        case 'EQUATION': {
          const span = h('div', { class: 'ed-obj ed-eq', contenteditable: 'false', 'data-node-id': n.id, title: 'Duplo clique para editar a equação', ondblclick: () => { const v = prompt('Equação (LaTeX):', n.data.latex ?? ''); if (v !== null) this.run({ type: 'UPDATE_CONTENT', targetId: n.id, payload: { data: { latex: v } } }); } });
          try { span.innerHTML = katex.renderToString(String(n.data.latex ?? ''), { displayMode: n.data.display !== 'INLINE', throwOnError: false, output: 'html' }); } catch { span.textContent = n.data.latex; }
          into.push(span);
          return;
        }
        case 'CHART': into.push(h('div', { class: 'ed-obj', contenteditable: 'false', 'data-node-id': n.id, title: 'Duplo clique para editar', ondblclick: () => this.onEditBlock(n), html: chartSvg(chartData(e, n), String(n.data.title?.text ?? ''), 600, 340) })); return;
        case 'DIAGRAM': into.push(h('div', { class: 'ed-obj', contenteditable: 'false', 'data-node-id': n.id, title: 'Duplo clique para editar', ondblclick: () => this.onEditBlock(n), html: diagramSvg(n.data) })); return;
        case 'SHAPE': {
          // forma no fluxo do texto (círculo, retângulo…): mesmo desenho dos slides, centralizada na linha
          const shape = slideItem(e, n);
          Object.assign(shape.style, { position: 'relative', left: '', top: '', margin: '0 auto' });
          into.push(h('div', { class: 'ed-obj ed-shape', contenteditable: 'false', 'data-node-id': n.id }, shape));
          return;
        }
        case 'BREAK': into.push(h('div', { class: 'ed-break', contenteditable: 'false' }, n.data.breakType === 'COLUMN' ? 'quebra de coluna' : n.data.breakType === 'SECTION' ? 'quebra de seção' : 'quebra de página')); return;
        case 'LINK': into.push(h('div', { class: 'ed-p' }, h('a', { href: n.data.url ?? '#', contenteditable: 'false', target: '_blank', rel: 'noopener', html: runsHtml(n.data.runs) }))); return;
        case 'FIELD': {
          if (Array.isArray(n.data.entries)) into.push(h('div', { class: 'ed-obj ed-field', contenteditable: 'false' }, n.data.title ? h('strong', {}, n.data.title) : null, ...n.data.entries.map((x: any) => h('div', { style: `padding-left:${((x.level ?? 1) - 1) * 16}px` }, `${x.text ?? x.term ?? x.label ?? ''}${x.page ? ` … ${x.page}` : x.pages ? ` … ${x.pages.join(', ')}` : ''}`))));
          else into.push(h('span', { class: 'ed-field', contenteditable: 'false' }, String(n.data.value ?? '')));
          return;
        }
        case 'NOTE': case 'CAPTION': case 'CITATION': into.push(h('div', { class: 'ed-p ed-caption', 'data-text-id': n.id, html: runsHtml(n.data.runs) || '<br>' })); return;
        default: into.push(h('div', { class: 'ed-obj ed-unknown', contenteditable: 'false' }, n.type));
      }
    };
    block(doc.nodes[doc.document.rootId], out);
    this.root.replaceChildren(...out);
    // documento sem parágrafo: um provisório (a primeira tecla cria o parágrafo de verdade no modelo)
    if (!this.root.querySelector('[data-text-id]')) this.root.append(h('div', { class: 'ed-p ed-placeholder', 'data-text-id': '__new__', 'data-hint': 'Comece a escrever…', html: '<br>' }));
    if (this.pending) { const p = this.pending; this.pending = null; this.focusText(p.id, p.start, p.end); }
  }

  private table(n: EditorNode) {
    const t = h('table', { class: 'ed-table', contenteditable: 'false', 'data-node-id': n.id, style: n.data.align === 'CENTER' ? 'margin-inline:auto' : n.data.align === 'RIGHT' ? 'margin-left:auto' : '' });
    (n.data.rows ?? []).forEach((row: any, r: number) => {
      const tr = h('tr');
      row.cells.forEach((c: any, k: number) => {
        if (c.merged || c.mergedInto) return;
        const addr = `${String.fromCharCode(65 + k)}${r + 1}`;
        const shown = c.error ? c.error.code : c.calculatedValue ?? c.value ?? '';
        const td = h(r === 0 && n.data.header ? 'th' : 'td', { title: c.formula ?? '', tabindex: '0', ondblclick: () => this.editCell(td, n.id, addr, c.formula ?? c.value ?? ''), onkeydown: (ev: KeyboardEvent) => { if (ev.key === 'Enter') { ev.preventDefault(); this.editCell(td, n.id, addr, c.formula ?? c.value ?? ''); } } }, String(shown));
        const rs = c.span?.rows ?? c.rowSpan, cs = c.span?.columns ?? c.colSpan;
        if (rs > 1) td.setAttribute('rowspan', String(rs));
        if (cs > 1) td.setAttribute('colspan', String(cs));
        const lk = tableCellLook(n.data, r, k);
        if (lk.fill) td.style.background = lk.fill;
        if (lk.ink) td.style.color = lk.ink;
        if (lk.bold) td.style.fontWeight = '700';
        tr.append(td);
      });
      t.append(tr);
    });
    return t;
  }

  private editCell(td: HTMLElement, tableId: string, cell: string, value: unknown) {
    const input = h('input', { class: 'ed-cell-input', value: String(value ?? ''), 'aria-label': `Célula ${cell}` });
    td.replaceChildren(input);
    input.focus(); input.select();
    let done = false;
    const commit = (save: boolean) => { if (done) return; done = true; if (save) this.run({ type: 'SET_CELL', targetId: tableId, payload: { cell, value: input.value } }); else this.render(); };
    input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') commit(true); if (ev.key === 'Escape') commit(false); });
    input.addEventListener('blur', () => commit(true));
  }

  // ---------------------------------------------------------------- cursor e seleção

  private point(node: Node | null, offset: number): TextPoint | null {
    const el = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-text-id]');
    if (!el || !this.root.contains(el)) return null;
    return { id: el.dataset.textId!, offset: offsetIn(el, node!, offset) };
  }
  range(): TextRange | null {
    const s = window.getSelection();
    if (!s || !s.rangeCount || !this.root.contains(s.anchorNode)) return null;
    const r = s.getRangeAt(0);
    const a = this.point(r.startContainer, r.startOffset), b = this.point(r.endContainer, r.endOffset);
    if (!a || !b) return null;
    return { start: a, end: b, collapsed: a.id === b.id && a.offset === b.offset };
  }
  /** Ids dos parágrafos na ordem da tela. */
  textIds() { return [...this.root.querySelectorAll<HTMLElement>('[data-text-id]')].map((x) => x.dataset.textId!); }
  focusText(id: string, start: number, end = start) {
    const el = this.root.querySelector<HTMLElement>(`[data-text-id="${CSS.escape(id)}"]`);
    if (!el) return;
    this.root.focus({ preventScroll: true });
    placeCaret(el, start, end);
    el.scrollIntoView({ block: 'nearest' });
  }

  /** Executa e redesenha na hora (a próxima tecla precisa ler o cursor já no lugar certo). */
  run(op: any) {
    const r = this.e.execute(op);
    if (!r.ok) toast(r.error.message, 'error');
    this.render();
    return r;
  }

  /** Apaga a seleção (mesmo atravessando parágrafos) e devolve onde o cursor fica. */
  private deleteRange(r: TextRange): TextPoint {
    if (r.start.id === r.end.id) {
      if (r.start.offset !== r.end.offset) this.run({ type: 'TEXT_SPLICE', targetId: r.start.id, payload: { start: r.start.offset, end: r.end.offset, text: '' } });
      return r.start;
    }
    const ids = this.textIds();
    const i = ids.indexOf(r.start.id), j = ids.indexOf(r.end.id);
    const steps: any[] = [
      { op: { type: 'TEXT_SPLICE', targetId: r.end.id, payload: { start: 0, end: r.end.offset, text: '' } } },
      ...ids.slice(i + 1, j).map((id) => ({ op: { type: 'DELETE', targetId: id } })),
      { op: { type: 'TEXT_SPLICE', targetId: r.start.id, payload: { start: r.start.offset, text: '' } } },
      { op: { type: 'TEXT_MERGE_PREV', targetId: r.end.id } },
    ];
    // o fim do primeiro parágrafo vai junto (start..fim do texto)
    const first = this.e.get(r.start.id);
    steps[2].op.payload.end = textOf(first).length;
    this.run({ type: 'RUN_SCRIPT', payload: { steps } });
    return r.start;
  }

  private beforeInput(ev: InputEvent) {
    if ((ev.target as HTMLElement).closest?.('input, textarea, select')) return;   // célula de tabela sendo editada
    if (this.composing || ev.inputType === 'insertCompositionText') return;
    const r = this.range();
    if (!r) { ev.preventDefault(); return; }
    ev.preventDefault();
    const t = ev.inputType;
    if (r.start.id === '__new__') {
      const area = this.e.state.activeSurface ?? this.e.doc.document.rootId;
      const text = t === 'insertText' || t === 'insertReplacementText' ? ev.data ?? '' : '';
      const res = this.e.execute({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: area, data: { text } } });
      if (res.ok) { this.pending = { id: res.value.id, start: text.length }; this.render(); } else toast(res.error.message, 'error');
      return;
    }
    if (t === 'insertText' || t === 'insertReplacementText') {
      const text = ev.data ?? ev.dataTransfer?.getData('text/plain') ?? '';
      const at = r.collapsed ? r.start : this.deleteRange(r);
      this.pending = { id: at.id, start: at.offset + text.length };
      this.run({ type: 'TEXT_SPLICE', targetId: at.id, payload: { start: at.offset, end: at.offset, text } });
    } else if (t === 'insertParagraph') {
      const at = r.collapsed ? r.start : this.deleteRange(r);
      const res = this.e.execute({ type: 'TEXT_SPLIT', targetId: at.id, payload: { offset: at.offset } });
      if (res.ok) this.pending = { id: res.value as string, start: 0 }; else toast(res.error.message, 'error');
      this.render();
    } else if (t === 'insertLineBreak') {
      const at = r.collapsed ? r.start : this.deleteRange(r);
      this.pending = { id: at.id, start: at.offset + 1 };
      this.run({ type: 'TEXT_SPLICE', targetId: at.id, payload: { start: at.offset, text: '\n' } });
    } else if (t.startsWith('delete')) {
      if (!r.collapsed) { const at = this.deleteRange(r); this.pending = { id: at.id, start: at.offset }; this.render(); return; }
      const back = t === 'deleteContentBackward' || t === 'deleteWordBackward';
      const p = r.start;
      const txt = textOf(this.e.get(p.id));
      if (back && p.offset === 0) {
        const res = this.e.execute({ type: 'TEXT_MERGE_PREV', targetId: p.id });
        if (res.ok && res.value) { const v = res.value as { id: string; offset: number }; this.pending = { id: v.id, start: v.offset }; this.render(); }
        return;
      }
      if (!back && p.offset >= txt.length) {
        const ids = this.textIds(), next = ids[ids.indexOf(p.id) + 1];
        if (next) { this.pending = { id: p.id, start: p.offset }; this.run({ type: 'TEXT_MERGE_PREV', targetId: next }); }
        return;
      }
      let a = p.offset, b = p.offset;
      if (t === 'deleteWordBackward') { a = txt.slice(0, p.offset).replace(/\S+\s*$|\s+$/, '').length; }
      else if (t === 'deleteWordForward') { b = p.offset + (txt.slice(p.offset).match(/^\s*\S+|^\s+/)?.[0].length ?? 1); }
      else if (back) a = p.offset - 1; else b = p.offset + 1;
      this.pending = { id: p.id, start: a };
      this.run({ type: 'TEXT_SPLICE', targetId: p.id, payload: { start: a, end: b, text: '' } });
    } else if (t === 'formatBold') this.toggle('bold');
    else if (t === 'formatItalic') this.toggle('italic');
    else if (t === 'formatUnderline') this.toggle('underline');
    else if (t === 'historyUndo') this.run({ type: 'UNDO' });
    else if (t === 'historyRedo') this.run({ type: 'REDO' });
  }

  /** Teclado do navegador que mudou o DOM sem passar pelo beforeinput (IME): compara e converte em operação. */
  private syncFromDom() {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-text-id]')) {
      const id = el.dataset.textId!, n = this.e.find(id);
      if (!n) continue;
      const model = textOf(n), dom = el.textContent ?? '';
      if (model === dom) continue;
      let a = 0; while (a < model.length && a < dom.length && model[a] === dom[a]) a++;
      let z = 0; while (z < model.length - a && z < dom.length - a && model[model.length - 1 - z] === dom[dom.length - 1 - z]) z++;
      this.pending = { id, start: dom.length - z };
      this.run({ type: 'TEXT_SPLICE', targetId: id, payload: { start: a, end: model.length - z, text: dom.slice(a, dom.length - z) } });
    }
  }

  private paste(ev: ClipboardEvent) {
    if ((ev.target as HTMLElement).closest?.('input, textarea')) return;
    ev.preventDefault();
    const r = this.range();
    if (!r) return;
    const text = (ev.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n');
    const at = r.collapsed ? r.start : this.deleteRange(r);
    const lines = text.split('\n');
    if (lines.length === 1) { this.pending = { id: at.id, start: at.offset + text.length }; this.run({ type: 'TEXT_SPLICE', targetId: at.id, payload: { start: at.offset, text } }); return; }
    // várias linhas: escreve a linha, divide e segue no parágrafo novo (tudo numa ação só)
    const steps: any[] = [{ set: 'cur', value: at.id }];
    lines.slice(0, -1).forEach((line, k) => {
      const off = k === 0 ? at.offset : 0;
      steps.push({ op: { type: 'TEXT_SPLICE', targetId: '{{cur}}', payload: { start: off, text: line } } });
      steps.push({ op: { type: 'TEXT_SPLIT', targetId: '{{cur}}', payload: { offset: off + line.length } }, saveAs: 'cur' });
    });
    steps.push({ op: { type: 'TEXT_SPLICE', targetId: '{{cur}}', payload: { start: 0, text: lines.at(-1) } } });
    const res = this.run({ type: 'RUN_SCRIPT', payload: { steps } });
    if (res.ok) { this.pending = { id: (res.value as any).variables.cur, start: lines.at(-1)!.length }; this.render(); }
  }

  private keydown(ev: KeyboardEvent) {
    if (ev.key === 'Tab') {
      const r = this.range();
      const n = r && this.e.find(r.start.id);
      const item = n && this.e.find(n.parentId);
      if (item?.type === 'LIST_ITEM') {
        ev.preventDefault();
        this.pending = { id: r!.start.id, start: r!.start.offset };
        this.run({ type: 'SET_LIST_LEVEL', targetId: item.id, payload: { level: Math.max(0, Math.min(8, (item.data.level ?? 0) + (ev.shiftKey ? -1 : 1))) } });
      }
    }
  }

  // ---------------------------------------------------------------- formatação

  /** Aplica formatação no trecho selecionado (vários parágrafos numa ação só). */
  format(fmt: Record<string, unknown>) {
    const r = this.range() ?? this.last;
    if (!r) return toast('Selecione um trecho de texto.', 'error');
    const ids = this.textIds();
    const i = ids.indexOf(r.start.id), j = ids.indexOf(r.end.id);
    const steps = ids.slice(i, j + 1).map((id, k) => {
      const len = textOf(this.e.get(id)).length;
      const start = k === 0 ? r.start.offset : 0, end = id === r.end.id ? r.end.offset : len;
      return { op: { type: 'TEXT_FORMAT', targetId: id, payload: { start: r.collapsed ? 0 : start, end: r.collapsed ? len : end, format: fmt } } };
    });
    this.pending = { id: r.start.id, start: r.start.offset, end: r.end.id === r.start.id ? r.end.offset : undefined };
    this.run({ type: 'RUN_SCRIPT', payload: { steps } });
  }
  /** Liga/desliga (negrito, itálico…): se tudo no trecho já tem, tira. */
  toggle(prop: string) {
    const r = this.range() ?? this.last;
    if (!r) return;
    const n = this.e.get(r.start.id);
    let acc = 0, all = true;
    for (const run of n.data.runs ?? []) { const s = acc, en = acc + run.text.length; acc = en; if (en > r.start.offset && s < (r.start.id === r.end.id ? r.end.offset : Infinity) && !run.format?.[prop]) all = false; }
    this.format({ [prop]: all ? null : true });
  }
  /** Tipo do parágrafo (título, citação…) e alinhamento. */
  setType(textType: string) { const r = this.range() ?? this.last; if (r) { this.pending = { id: r.start.id, start: r.start.offset }; this.run({ type: 'CONVERT_CONTENT', targetId: r.start.id, payload: { to: textType } }); } }
  align(a: string) { const r = this.range() ?? this.last; if (r) { this.pending = { id: r.start.id, start: r.start.offset }; this.run({ type: 'FORMAT', targetIds: [...new Set([r.start.id, r.end.id])], payload: { align: a } }); } }

  /** Insere um bloco depois do parágrafo do cursor (ou no fim). */
  insert(contentType: string, data: Record<string, unknown>, layout?: Record<string, unknown>) {
    const r = this.range() ?? this.last;
    const ref = r ? this.e.find(r.end.id) : null;
    const parentId = ref?.parentId && this.e.get(ref.parentId).type !== 'LIST_ITEM' ? ref.parentId : this.e.state.activeSurface;
    const index = ref && ref.parentId === parentId ? ref.order + 1 : undefined;
    return this.run(contentType === 'LIST' || contentType === 'BREAK'
      ? { type: 'INSERT_STRUCTURE', payload: { structureType: contentType, parentId, index, ...data } }
      : { type: 'INSERT_CONTENT', payload: { contentType, parentId, index, data, ...(layout ? { layout } : {}) } });
  }
}
