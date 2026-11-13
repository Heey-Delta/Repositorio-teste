// Visão de planilha: barra de fórmulas, grade com seleção de célula/intervalo, edição no lugar,
// teclado (setas, Enter, Tab, Delete, F2) e abas das planilhas.
import type { Engine, EditorNode } from '../editor-core/index.ts';
import { formatValue } from '../editor-core/formula/number-format.ts';
import { h, toast } from './dom.ts';
import { parseAddress, toAddress, indexToCol } from '../editor-core/formula/parse.ts';

export class SheetView {
  e: Engine;
  host: HTMLElement;
  bar: HTMLElement;
  nameBox: HTMLInputElement;
  formula: HTMLInputElement;
  grid: HTMLElement;
  tabs: HTMLElement;
  anchor: string | null = null;   // início da seleção de intervalo (Shift)
  onSelect: () => void = () => {};
  private editingCell: string | null = null;

  constructor(e: Engine, host: HTMLElement) {
    this.e = e; this.host = host;
    this.nameBox = h('input', { class: 'sh-name', 'aria-label': 'Célula', onkeydown: (ev: KeyboardEvent) => { if (ev.key === 'Enter') { const r = e.execute({ type: 'GO_TO', payload: { cell: this.nameBox.value } }); if (!r.ok) toast(r.error.message, 'error'); this.anchor = null; this.render(); this.grid.focus(); } } });
    this.formula = h('input', { class: 'sh-formula', 'aria-label': 'Conteúdo ou fórmula da célula', placeholder: 'Valor ou =fórmula', onkeydown: (ev: KeyboardEvent) => { if (ev.key === 'Enter') { this.commit(this.active(), this.formula.value); this.move(1, 0); this.grid.focus(); } if (ev.key === 'Escape') { this.render(); this.grid.focus(); } } });
    this.bar = h('div', { class: 'sh-bar' }, this.nameBox, h('span', { class: 'sh-fx', 'aria-hidden': 'true' }, 'fx'), this.formula);
    this.grid = h('div', { class: 'sh-grid', tabindex: '0', role: 'grid', 'aria-label': 'Planilha' });
    this.tabs = h('div', { class: 'sh-tabs', role: 'tablist' });
    host.replaceChildren(this.bar, this.grid, this.tabs);
    this.grid.addEventListener('keydown', (ev) => this.key(ev));
    this.grid.addEventListener('mousedown', (ev) => this.click(ev));
    this.grid.addEventListener('dblclick', (ev) => { const td = (ev.target as HTMLElement).closest<HTMLElement>('[data-cell]'); if (td) this.edit(td.dataset.cell!); });
    if (!e.state.activeCell) e.state.activeCell = 'A1';
    this.render();
  }

  sheet(): EditorNode | undefined { const s = this.e.find(this.e.state.activeSurface); return s?.data.surfaceType === 'SHEET' ? s : Object.values(this.e.doc.nodes).find((n) => n.data.surfaceType === 'SHEET'); }
  sheets() { return Object.values(this.e.doc.nodes).filter((n) => n.data.surfaceType === 'SHEET').sort((a, b) => a.order - b.order); }
  active() { return this.e.state.activeCell ?? 'A1'; }
  /** Intervalo selecionado ("B2:D5") ou a célula. */
  range() {
    if (!this.anchor || this.anchor === this.active()) return this.active();
    const a = parseAddress(this.anchor), b = parseAddress(this.active());
    return `${toAddress({ row: Math.min(a.row, b.row), col: Math.min(a.col, b.col) })}:${toAddress({ row: Math.max(a.row, b.row), col: Math.max(a.col, b.col) })}`;
  }
  run(op: any) { const r = this.e.execute(op); if (!r.ok) toast(r.error.message, 'error'); return r; }

  render() {
    const s = this.sheet();
    if (!s) return;
    if (this.e.state.activeSurface !== s.id) this.e.state.activeSurface = s.id;
    const cells: Record<string, any> = s.data.cells ?? {};
    let R = 1, C = 1;
    for (const a of Object.keys(cells)) { const p = parseAddress(a); R = Math.max(R, p.row); C = Math.max(C, p.col); }
    const act = parseAddress(this.active());
    R = Math.max(R + 20, act.row + 10, 60); C = Math.max(C + 4, act.col + 3, 18);
    const looks = (this.e.execute({ type: 'CONDITIONAL_STYLES', targetId: s.id }).value ?? {}) as Record<string, any>;
    const rr = this.range().includes(':') ? (() => { const [a, b] = this.range().split(':').map(parseAddress); return { r1: a.row, c1: a.col, r2: b.row, c2: b.col }; })() : null;
    const colW = (c: number) => Number(s.data.columns?.[c]?.width ?? s.data.colWidths?.[c] ?? 100);
    const t = h('table', { class: 'sh-table' });
    t.append(h('tr', {}, h('th', { class: 'sh-corner' }), ...Array.from({ length: C }, (_, i) => h('th', { scope: 'col', style: `width:${colW(i + 1)}px`, class: i + 1 === act.col ? 'is-active' : '' }, indexToCol(i + 1)))));
    for (let r = 1; r <= R; r++) {
      const tr = h('tr', {}, h('th', { scope: 'row', class: r === act.row ? 'is-active' : '' }, String(r)));
      for (let c = 1; c <= C; c++) {
        const addr = toAddress({ row: r, col: c });
        const cell = cells[addr];
        const shown = cell ? (cell.error ? cell.error.code : cell.calculatedValue ?? cell.value ?? '') : '';
        const td = h('td', { 'data-cell': addr, role: 'gridcell', 'aria-selected': addr === this.active() ? 'true' : null });
        // formato numérico da célula (moeda, data, %, máscaras…), com a cor que o formato pedir ([Vermelho])
        const fmt = cell?.error ? null : formatValue(shown, (cell?.styleOverrides as any)?.numberFormat);
        td.textContent = fmt ? fmt.text : String(shown);
        if (fmt?.color) td.style.color = fmt.color;
        if (typeof shown === 'number') td.classList.add('is-num');
        if (cell?.error) td.classList.add('is-err');
        const st = { ...(cell?.styleOverrides ?? {}), ...(looks[addr]?.style ?? {}) };
        if (st.bold) td.style.fontWeight = '700';
        if (st.italic) td.style.fontStyle = 'italic';
        if (st.color) td.style.color = st.color;
        if (st.fill) td.style.background = st.fill;
        if (st.align) td.style.textAlign = String(st.align).toLowerCase();
        if (looks[addr]?.dataBar) td.style.backgroundImage = `linear-gradient(90deg, ${looks[addr].dataBar.color}55 ${looks[addr].dataBar.ratio * 100}%, transparent 0)`;
        if (looks[addr]?.icon) td.prepend(h('span', { class: 'sh-icon' }, looks[addr].icon + ' '));
        if (addr === this.active()) td.classList.add('is-active');
        if (rr && r >= rr.r1 && r <= rr.r2 && c >= rr.c1 && c <= rr.c2) td.classList.add('in-range');
        tr.append(td);
      }
      t.append(tr);
    }
    this.grid.replaceChildren(t);
    this.grid.querySelector('.is-active[data-cell]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const cur = cells[this.active()];
    this.nameBox.value = this.range();
    this.formula.value = cur ? String(cur.formula ?? cur.value ?? '') : '';
    // abas
    this.tabs.replaceChildren(...this.sheets().map((x) => h('button', { type: 'button', role: 'tab', class: `sh-tab${x.id === s.id ? ' is-active' : ''}`, 'aria-selected': String(x.id === s.id), onclick: () => { this.run({ type: 'SET_ACTIVE_SURFACE', targetId: x.id }); this.anchor = null; this.render(); this.onSelect(); }, ondblclick: () => { const name = prompt('Nome da planilha:', x.data.name); if (name) { this.run({ type: 'UPDATE', targetId: x.id, payload: { data: { name } } }); this.render(); } } }, String(x.data.name ?? 'Planilha'))),
      h('button', { type: 'button', class: 'sh-tab sh-add', 'aria-label': 'Nova planilha', onclick: () => { const r = this.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SHEET', name: `Planilha${this.sheets().length + 1}` } }); if (r.ok) { this.run({ type: 'SET_ACTIVE_SURFACE', targetId: r.value }); this.render(); } } }, '+'));
  }

  commit(addr: string, raw: string) {
    const s = this.sheet()!;
    const v = raw.trim() === '' ? null : raw;
    const old = s.data.cells?.[addr];
    if ((old?.formula ?? old?.value ?? null) === v || (v === null && !old)) return;
    this.run(v === null ? { type: 'CLEAR_CELL', targetId: s.id, payload: { cell: addr } } : { type: 'SET_CELL', targetId: s.id, payload: { cell: addr, value: v } });
  }

  private edit(addr: string, initial?: string) {
    const td = this.grid.querySelector<HTMLElement>(`[data-cell="${addr}"]`);
    if (!td) return;
    const cell = this.sheet()!.data.cells?.[addr];
    const input = h('input', { class: 'sh-edit', value: initial ?? String(cell?.formula ?? cell?.value ?? ''), 'aria-label': `Editar ${addr}` });
    td.replaceChildren(input);
    this.editingCell = addr;
    input.focus();
    if (initial === undefined) input.select(); else input.setSelectionRange(input.value.length, input.value.length);
    let done = false;
    const finish = (save: boolean, dr = 0, dc = 0) => { if (done) return; done = true; this.editingCell = null; if (save) this.commit(addr, input.value); this.move(dr, dc); this.grid.focus(); };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true, ev.shiftKey ? -1 : 1, 0); }
      else if (ev.key === 'Tab') { ev.preventDefault(); finish(true, 0, ev.shiftKey ? -1 : 1); }
      else if (ev.key === 'Escape') finish(false);
    });
    input.addEventListener('input', () => { this.formula.value = input.value; });
    input.addEventListener('blur', () => finish(true));
  }

  move(dr: number, dc: number, extend = false) {
    const p = parseAddress(this.active());
    if (extend) this.anchor ??= this.active(); else this.anchor = null;
    this.e.state.activeCell = toAddress({ row: Math.max(1, p.row + dr), col: Math.max(1, p.col + dc) });
    this.render(); this.onSelect();
  }

  private click(ev: MouseEvent) {
    const td = (ev.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!td || this.editingCell) return;
    ev.preventDefault();
    this.grid.focus();
    if (ev.shiftKey) this.anchor ??= this.active(); else this.anchor = null;
    this.e.state.activeCell = td.dataset.cell!;
    this.render(); this.onSelect();
  }

  private key(ev: KeyboardEvent) {
    if (this.editingCell) return;
    const d: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (d[ev.key]) { ev.preventDefault(); this.move(d[ev.key][0], d[ev.key][1], ev.shiftKey); return; }
    if (ev.key === 'Enter') { ev.preventDefault(); this.move(ev.shiftKey ? -1 : 1, 0); return; }
    if (ev.key === 'Tab') { ev.preventDefault(); this.move(0, ev.shiftKey ? -1 : 1); return; }
    if (ev.key === 'F2') { ev.preventDefault(); this.edit(this.active()); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.run({ type: 'CLEAR_CELL', targetId: this.sheet()!.id, payload: { range: this.range() } }); this.render(); return; }
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); this.edit(this.active(), ev.key); }
  }

  /** Formatação das células selecionadas. */
  format(props: Record<string, unknown>) { this.run({ type: 'FORMAT_CELLS', targetId: this.sheet()!.id, payload: { range: this.range(), properties: props } }); this.render(); }
}
