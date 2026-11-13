// Tabelas e dados (Camada 9). Um núcleo tabular, duas estruturas:
//   TABLE (documentos e slides): linhas, colunas e células explícitas — data.rows[].cells[], data.columns[].
//   SHEET (planilhas, SURFACE com surfaceType SHEET): só as células usadas, por endereço — data.cells['A1'].
// As mesmas operações servem às duas; a implementação interna muda. Endereços sempre em A1 (ou { row, col }
// começando em 1). Fórmulas: o motor tabular guarda fórmula e resultado; o FormulaService calcula.
import type { EditorNode } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import type { SheetCell, ValidationRule } from '../formula/service.ts';
import type { Scalar } from '../formula/functions.ts';
import { formulas, isSheet, moveReferences } from '../formula/service.ts';
import { evaluate } from '../formula/evaluate.ts';
import { err, ERROR_MESSAGES, isErr } from '../formula/functions.ts';
import { colToIndex, indexToCol, parse, parseAddress, parseRange, toAddress } from '../formula/parse.ts';
import { createNode } from './basic.ts';
import { validateProps } from './format.ts';
import { clone, fail, merge } from '../util.ts';

// ---------------------------------------------------------------- TABLE: estrutura

export interface TableCell { id: string; value: Scalar; formula?: string | null; calculatedValue?: Scalar; error?: { code: string; message: string } | null; span?: { rows: number; columns: number }; mergedInto?: string; styleOverrides?: Record<string, unknown>; validation?: ValidationRule | null }
export interface TableData { columns: { id: string; width: number }[]; rows: { id: string; height?: number; cells: TableCell[] }[]; header: boolean; filter?: FilterSpec | null }
interface FilterSpec { column: number; rule: FilterRule; range?: string }
type FilterRule = { type: 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'EMPTY' | 'NOT_EMPTY'; value?: Scalar } | { type: 'VALUES'; values: Scalar[] };

const newCell = (e: Engine, value: Scalar = null): TableCell => ({ id: e.newId('CELL'), value });

/** Monta uma tabela: { rows, columns } vazios ou { values: [[...], ...] } já preenchidos. */
export function buildTableData(e: Engine, input: Record<string, any>): TableData {
  const values: Scalar[][] | undefined = input.values;
  const rows = values?.length ?? input.rows ?? 3;
  const cols = values ? Math.max(...values.map((r) => r.length)) : input.columns ?? 3;
  if (rows < 1 || cols < 1 || rows > 1000 || cols > 100) fail('VALIDATION', 'Tabela: de 1 a 1000 linhas e de 1 a 100 colunas.');
  const width = input.columnWidth ?? 120;
  return {
    columns: Array.from({ length: cols }, () => ({ id: e.newId('COL'), width })),
    rows: Array.from({ length: rows }, (_, r) => ({ id: e.newId('ROW'), cells: Array.from({ length: cols }, (_, c) => {
      const v = values?.[r]?.[c] ?? null;
      if (typeof v === 'string' && v.trim().startsWith('=') && v.trim().length > 1) { checkFormula(v); return { ...newCell(e), formula: v.trim() }; }
      return newCell(e, coerceInput(v));
    }) })),
    header: input.header ?? true,
    filter: null,
  };
}

export function validateTableData(d: Record<string, any>) {
  if (!Array.isArray(d.rows) || !Array.isArray(d.columns) || !d.rows.length || !d.columns.length) fail('VALIDATION', 'Tabela precisa de linhas e colunas.');
  const ids = new Set<string>();
  for (const r of d.rows) {
    if (r.cells.length !== d.columns.length) fail('INTEGRITY', `A linha ${r.id} tem ${r.cells.length} células para ${d.columns.length} colunas.`);
    for (const c of r.cells) { if (ids.has(c.id)) fail('INTEGRITY', `Célula repetida: ${c.id}.`); ids.add(c.id); }
  }
}

// ---------------------------------------------------------------- endereços

/** Posição a partir de { cell: 'B2' }, { row, col } ou { cellId } (tabela). */
function posOf(n: EditorNode, p: Record<string, any>): { row: number; col: number } {
  if (p.cell) return parseAddress(p.cell);
  if (p.row && p.col) return { row: Number(p.row), col: typeof p.col === 'string' ? colToIndex(p.col) : Number(p.col) };
  if (p.cellId && n.type === 'TABLE') {
    for (const [r, row] of (n.data as TableData).rows.entries()) { const c = row.cells.findIndex((x) => x.id === p.cellId); if (c >= 0) return { row: r + 1, col: c + 1 }; }
    fail('NOT_FOUND', `Célula ${p.cellId} não existe.`);
  }
  return fail('INVALID_PAYLOAD', 'Informe a célula: cell ("B2"), row/col ou cellId.');
}

function rangeOf(n: EditorNode, p: Record<string, any>) {
  if (p.range) return parseRange(String(p.range).replace(/^.*!/, ''));
  const a = posOf(n, p);
  return { r1: a.row, c1: a.col, r2: a.row, c2: a.col };
}

function target(e: Engine, id: string | null | undefined, editable = true) {
  const n = e.get(id);
  if (n.type !== 'TABLE' && !isSheet(n)) fail('INVALID_OPERATION', `${n.id} não é uma tabela nem uma planilha.`);
  if (editable) { e.assertEditable(n.id); return e.touchNode(n.id); }
  return n;
}

function tableCell(t: EditorNode, row: number, col: number): TableCell {
  const d = t.data as TableData;
  if (row < 1 || col < 1 || row > d.rows.length || col > d.columns.length) fail('NOT_FOUND', `${toAddress({ row, col })} está fora da tabela (${d.rows.length}×${d.columns.length}).`);
  return d.rows[row - 1].cells[col - 1];
}

const cellsMap = (s: EditorNode) => (s.data.cells ??= {}) as Record<string, SheetCell>;

// ---------------------------------------------------------------- validação de entrada

function checkRule(rule: ValidationRule | null | undefined, v: Scalar) {
  if (!rule || v === null || v === '') return;
  const bad = (msg: string) => fail('VALIDATION', msg);
  if (rule.type === 'LIST' && !rule.values.map(String).includes(String(v))) bad(`Escolha um destes valores: ${rule.values.join(', ')}.`);
  if (rule.type === 'NUMBER' || rule.type === 'DATE') {
    const x = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    if (Number.isNaN(x)) bad('Digite um número.');
    if (rule.type === 'NUMBER' && rule.integer && !Number.isInteger(x)) bad('Digite um número inteiro.');
    if (rule.min !== undefined && x < rule.min) bad(`O valor mínimo é ${rule.min}.`);
    if (rule.max !== undefined && x > rule.max) bad(`O valor máximo é ${rule.max}.`);
  }
  if (rule.type === 'TEXT_LENGTH') {
    const len = String(v).length;
    if (rule.min !== undefined && len < rule.min) bad(`Use pelo menos ${rule.min} caracteres.`);
    if (rule.max !== undefined && len > rule.max) bad(`Use no máximo ${rule.max} caracteres.`);
  }
}

/** Texto digitado vira número/booleano quando for o caso ("12,5" → 12.5, "VERDADEIRO" → true). */
export function coerceInput(v: unknown): Scalar {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  const t = s.trim();
  if (t === '') return null;
  if (/^-?\d+([.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^(verdadeiro|true)$/i.test(t)) return true;
  if (/^(falso|false)$/i.test(t)) return false;
  return s;
}

function checkFormula(f: string) {
  try { parse(f); } catch (ex) { fail('VALIDATION', `Fórmula inválida: ${(ex as Error).message}`); }
}

// ---------------------------------------------------------------- fórmulas dentro de TABLE

/** Recalcula as fórmulas de uma tabela de documento (referências A1 dentro da própria tabela). */
export function recalcTable(e: Engine, t: EditorNode) {
  const d = t.data as TableData;
  const fs = formulas(e);
  const state = new Map<string, 'busy' | 'done'>();
  const value = (r: number, c: number): Scalar => {
    const cell = d.rows[r - 1]?.cells[c - 1];
    if (!cell) return err('#REF!');
    if (!cell.formula) return cell.value ?? null;
    compute(r, c);
    return cell.error ? err(cell.error.code as any) : cell.calculatedValue ?? null;
  };
  const compute = (r: number, c: number) => {
    const cell = d.rows[r - 1].cells[c - 1];
    const k = `${r},${c}`;
    if (state.get(k) === 'done') return;
    if (state.get(k) === 'busy') { cell.error = { code: '#CYCLE!', message: ERROR_MESSAGES['#CYCLE!'] }; cell.calculatedValue = null; return; }
    state.set(k, 'busy');
    const ast = fs.parseCached(cell.formula!);
    const v = ast instanceof Error ? err('#ERROR!') : evaluate(ast, {
      getCell: (sheet, rr, cc) => (sheet ? err('#REF!') : value(rr, cc)),
      getRange: (sheet, r1, c1, r2, c2) => { const m: Scalar[][] = []; for (let rr = r1; rr <= Math.min(r2, d.rows.length); rr++) { const line: Scalar[] = []; for (let cc = c1; cc <= Math.min(c2, d.columns.length); cc++) line.push(sheet ? err('#REF!') : value(rr, cc)); m.push(line); } return m; },
      getName: () => null,
      functions: fs.registry,
      now: fs.now,
    });
    if (cell.error?.code === '#CYCLE!' && state.get(k) === 'busy') { state.set(k, 'done'); return; }
    if (isErr(v)) { cell.calculatedValue = null; cell.error = { code: v.error, message: ERROR_MESSAGES[v.error] }; }
    else { cell.calculatedValue = v; cell.error = null; }
    state.set(k, 'done');
  };
  d.rows.forEach((row, r) => row.cells.forEach((cell, c) => { if (cell.formula) compute(r + 1, c + 1); }));
}

// ---------------------------------------------------------------- escrita de células

function writeCell(e: Engine, n: EditorNode, row: number, col: number, input: unknown, opts: { formula?: string } = {}) {
  const raw = opts.formula ?? input;
  const isFormula = typeof raw === 'string' && raw.trim().startsWith('=') && raw.trim().length > 1;
  if (isFormula) checkFormula(raw as string);
  const value = isFormula ? null : coerceInput(raw);
  if (n.type === 'TABLE') {
    const c = tableCell(n, row, col);
    if (c.mergedInto) fail('INVALID_OPERATION', 'Essa célula está mesclada; escreva na primeira célula da mesclagem.');
    if (!isFormula) checkRule(c.validation, value);
    c.value = value;
    if (isFormula) c.formula = (raw as string).trim(); else { delete c.formula; delete c.calculatedValue; delete c.error; }
    return;
  }
  const addr = toAddress({ row, col });
  const cells = cellsMap(n);
  const prev = cells[addr] ?? {};
  if ((n.data.merges as string[] ?? []).some((m) => { const r = parseRange(m); return row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2 && (row !== r.r1 || col !== r.c1); })) fail('INVALID_OPERATION', 'Essa célula está mesclada; escreva na primeira célula da mesclagem.');
  if (!isFormula) checkRule(prev.validation, value);
  const next: SheetCell = { ...prev, value };
  if (isFormula) { next.formula = (raw as string).trim(); next.calculationState = 'PENDING'; } else { delete next.formula; delete next.calculatedValue; delete next.error; delete next.calculationState; }
  const empty = next.value === null && !next.formula && !next.styleOverrides && !next.validation;
  if (empty) delete cells[addr]; else cells[addr] = next;
}

/** Depois de escrever: recalcula (tabela inteira ou só o que depende das células alteradas na planilha). */
function afterWrite(e: Engine, n: EditorNode, changed: string[]) {
  if (n.type === 'TABLE') recalcTable(e, n);
  else formulas(e).recalc(changed.map((addr) => ({ sheetId: n.id, addr })));
}

export function readCell(e: Engine, n: EditorNode, row: number, col: number) {
  if (n.type === 'TABLE') {
    const c = tableCell(n, row, col);
    return { address: toAddress({ row, col }), value: c.value ?? null, formula: c.formula ?? null, calculatedValue: c.calculatedValue ?? null, error: c.error ?? null, display: c.formula ? (c.error ? c.error.code : c.calculatedValue) : c.value };
  }
  const c = cellsMap(n)[toAddress({ row, col })] ?? {};
  return { address: toAddress({ row, col }), value: c.value ?? null, formula: c.formula ?? null, calculatedValue: c.calculatedValue ?? null, error: c.error ?? null, display: c.formula ? (c.error ? c.error.code : c.calculatedValue ?? null) : c.value ?? null };
}

const visible = (v: unknown) => (isErr(v) ? v.error : v);

// ---------------------------------------------------------------- linhas e colunas

function splitMergesTouching(n: EditorNode, axis: 'row' | 'col', at: number) {
  if (n.type === 'TABLE') {
    const d = n.data as TableData;
    d.rows.forEach((row, r) => row.cells.forEach((c, k) => {
      if (!c.span) return;
      const [lo, hi] = axis === 'row' ? [r + 1, r + c.span.rows] : [k + 1, k + c.span.columns];
      if (at > lo && at <= hi) unmergeTable(d, r + 1, k + 1);
    }));
  } else {
    n.data.merges = (n.data.merges as string[] ?? []).filter((m) => { const r = parseRange(m); const [lo, hi] = axis === 'row' ? [r.r1, r.r2] : [r.c1, r.c2]; return !(at > lo && at <= hi); });
  }
}

function unmergeTable(d: TableData, row: number, col: number) {
  const anchor = d.rows[row - 1].cells[col - 1];
  if (!anchor.span) return;
  for (let r = row; r < row + anchor.span.rows; r++) for (let c = col; c < col + anchor.span.columns; c++) delete d.rows[r - 1].cells[c - 1].mergedInto;
  delete anchor.span;
}

function insertLines(e: Engine, n: EditorNode, axis: 'row' | 'col', at: number, count: number) {
  if (count < 1) fail('INVALID_PAYLOAD', 'Quantidade precisa ser pelo menos 1.');
  splitMergesTouching(n, axis, at);
  if (n.type === 'TABLE') {
    const d = n.data as TableData;
    const max = axis === 'row' ? d.rows.length + 1 : d.columns.length + 1;
    if (at < 1 || at > max) fail('INVALID_PAYLOAD', `Posição fora da tabela (1 a ${max}).`);
    if (axis === 'row') d.rows.splice(at - 1, 0, ...Array.from({ length: count }, () => ({ id: e.newId('ROW'), cells: d.columns.map(() => newCell(e)) })));
    else {
      const w = d.columns[Math.min(at - 1, d.columns.length - 1)]?.width ?? 120;
      d.columns.splice(at - 1, 0, ...Array.from({ length: count }, () => ({ id: e.newId('COL'), width: w })));
      for (const row of d.rows) row.cells.splice(at - 1, 0, ...Array.from({ length: count }, () => newCell(e)));
    }
    recalcTable(e, n);
    return;
  }
  shiftSheet(n, axis, at, count);
  const fs = formulas(e);
  fs.adjustReferences(n.id, axis, at, count);
  fs.recalc([], true);
}

function deleteLines(e: Engine, n: EditorNode, axis: 'row' | 'col', at: number, count: number) {
  if (count < 1) fail('INVALID_PAYLOAD', 'Quantidade precisa ser pelo menos 1.');
  if (n.type === 'TABLE') {
    const d = n.data as TableData;
    const total = axis === 'row' ? d.rows.length : d.columns.length;
    if (at < 1 || at + count - 1 > total) fail('INVALID_PAYLOAD', 'Posição fora da tabela.');
    if (count >= total) fail('INVALID_OPERATION', `A tabela precisa de pelo menos uma ${axis === 'row' ? 'linha' : 'coluna'}. Para remover tudo, exclua a tabela.`);
    for (let i = at; i < at + count; i++) splitMergesTouching(n, axis, i);
    d.rows.forEach((row, r) => row.cells.forEach((_, c) => { const cell = d.rows[r].cells[c]; if (cell.span && (axis === 'row' ? r + 1 >= at && r + 1 < at + count : c + 1 >= at && c + 1 < at + count)) unmergeTable(d, r + 1, c + 1); }));
    if (axis === 'row') d.rows.splice(at - 1, count);
    else { d.columns.splice(at - 1, count); for (const row of d.rows) row.cells.splice(at - 1, count); }
    recalcTable(e, n);
    return;
  }
  shiftSheet(n, axis, at, -count);
  const fs = formulas(e);
  fs.adjustReferences(n.id, axis, at, -count);
  fs.recalc([], true);
}

/** Desloca as células da planilha (count < 0 apaga as linhas/colunas [at, at-count-1]). */
function shiftSheet(s: EditorNode, axis: 'row' | 'col', at: number, count: number) {
  const cells = cellsMap(s);
  const out: Record<string, SheetCell> = {};
  for (const [addr, c] of Object.entries(cells)) {
    const p = parseAddress(addr);
    const v = axis === 'row' ? p.row : p.col;
    if (count < 0 && v >= at && v < at - count) continue;
    const nv = v >= at ? v + count : v;
    out[toAddress(axis === 'row' ? { row: nv, col: p.col } : { row: p.row, col: nv })] = c;
  }
  s.data.cells = out;
  const sizes = (axis === 'row' ? s.data.rowHeights : s.data.colWidths) ?? {};
  const moved: Record<string, number> = {};
  for (const [k, v] of Object.entries<number>(sizes)) {
    const i = axis === 'row' ? Number(k) : colToIndex(k);
    if (count < 0 && i >= at && i < at - count) continue;
    const ni = i >= at ? i + count : i;
    moved[axis === 'row' ? String(ni) : indexToCol(ni)] = v;
  }
  if (axis === 'row') s.data.rowHeights = moved; else s.data.colWidths = moved;
  s.data.merges = (s.data.merges as string[] ?? []).flatMap((m) => {
    const r = parseRange(m);
    const [lo, hi] = axis === 'row' ? [r.r1, r.r2] : [r.c1, r.c2];
    if (count < 0 && hi >= at && lo < at - count) return [];   // mesclagem atingida pela exclusão: desfaz
    const sh = (v: number) => (v >= at ? v + count : v);
    const a = axis === 'row' ? { row: sh(r.r1), col: r.c1 } : { row: r.r1, col: sh(r.c1) };
    const b = axis === 'row' ? { row: sh(r.r2), col: r.c2 } : { row: r.r2, col: sh(r.c2) };
    return [`${toAddress(a)}:${toAddress(b)}`];
  });
}

const lineIndex = (p: Record<string, any>, axis: 'row' | 'col') => {
  const v = p.index ?? (axis === 'row' ? p.row : p.col);
  if (v === undefined) fail('INVALID_PAYLOAD', 'Informe index (a partir de 1).');
  return typeof v === 'string' && axis === 'col' && /^[A-Za-z]+$/.test(v) ? colToIndex(v) : Number(v);
};

// ---------------------------------------------------------------- ordenar e filtrar

const blank = (v: Scalar) => v === null || v === '';
/** Ordena com a direção pedida, mas vazios ficam sempre no fim (como nas planilhas). */
const sortCmp = (dir: number) => (a: Scalar, b: Scalar) => (blank(a) || blank(b) ? Number(blank(a)) - Number(blank(b)) : dir * cmp(a, b));
function cmp(a: Scalar, b: Scalar) {
  const rank = (v: Scalar) => (v === null || v === '' ? 3 : typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === 'string') return a.localeCompare(b as string, 'pt-BR', { numeric: true, sensitivity: 'base' });
  return Number(a) - Number(b);
}

function passes(rule: FilterRule, v: Scalar) {
  const val = visible(v) as Scalar;
  switch (rule.type) {
    case 'EQUALS': return String(val ?? '').toLowerCase() === String(rule.value ?? '').toLowerCase();
    case 'NOT_EQUALS': return String(val ?? '').toLowerCase() !== String(rule.value ?? '').toLowerCase();
    case 'CONTAINS': return String(val ?? '').toLowerCase().includes(String(rule.value ?? '').toLowerCase());
    case 'GT': return typeof val === 'number' && val > Number(rule.value);
    case 'GTE': return typeof val === 'number' && val >= Number(rule.value);
    case 'LT': return typeof val === 'number' && val < Number(rule.value);
    case 'LTE': return typeof val === 'number' && val <= Number(rule.value);
    case 'EMPTY': return val === null || val === '';
    case 'NOT_EMPTY': return !(val === null || val === '');
    case 'VALUES': return rule.values.map(String).includes(String(val));
  }
}

/** Linhas que o filtro deixa visíveis (a linha de cabeçalho sempre aparece). */
export function visibleRows(e: Engine, n: EditorNode): number[] {
  const f: FilterSpec | null | undefined = n.data.filter;
  if (n.type === 'TABLE') {
    const d = n.data as TableData;
    return d.rows.map((_, i) => i + 1).filter((r) => !f || (d.header && r === 1) || passes(f.rule, readCell(e, n, r, f.column).display as Scalar));
  }
  const used = formulas(e).usedBounds(n);
  const all = Array.from({ length: used.rows }, (_, i) => i + 1);
  if (!f) return all;
  const r = parseRange(f.range ?? `A1:${indexToCol(Math.max(1, used.cols))}${Math.max(1, used.rows)}`);
  return all.filter((row) => row < r.r1 || row > r.r2 || row === r.r1 || passes(f.rule, readCell(e, n, row, f.column).display as Scalar));
}

// ---------------------------------------------------------------- operações

export const tableHandlers: Record<string, Handler> = {
  /** SET_CELL { cell: 'B2', value } — texto começando com "=" vira fórmula. */
  SET_CELL: (e, op) => {
    const n = target(e, op.targetId);
    const p = posOf(n, op.payload ?? {});
    writeCell(e, n, p.row, p.col, op.payload?.value);
    afterWrite(e, n, [toAddress(p)]);
    return readCell(e, n, p.row, p.col);
  },

  /** Vários valores de uma vez (colar dados): SET_CELLS { start: 'A1', values: [[…], […]] }. */
  SET_CELLS: (e, op) => {
    const n = target(e, op.targetId);
    const start = parseAddress(op.payload?.start ?? 'A1');
    const values: unknown[][] = op.payload?.values ?? fail('INVALID_PAYLOAD', 'Informe values (linhas × colunas).');
    const changed: string[] = [];
    values.forEach((line, r) => line.forEach((v, c) => { writeCell(e, n, start.row + r, start.col + c, v); changed.push(toAddress({ row: start.row + r, col: start.col + c })); }));
    afterWrite(e, n, changed);
    return changed.length;
  },

  /** SET_FORMULA { cell, formula } — rejeita fórmula com erro de escrita (VALIDATE_FORMULA). */
  SET_FORMULA: (e, op) => {
    const n = target(e, op.targetId);
    const p = posOf(n, op.payload ?? {});
    const f = String(op.payload?.formula ?? '').trim();
    writeCell(e, n, p.row, p.col, null, { formula: f.startsWith('=') ? f : `=${f}` });
    afterWrite(e, n, [toAddress(p)]);
    return readCell(e, n, p.row, p.col);
  },

  GET_CELL: (e, op) => { const n = target(e, op.targetId, false); const p = posOf(n, op.payload ?? {}); return readCell(e, n, p.row, p.col); },

  /** Valores de um intervalo (já calculados), para a interface e os gráficos. */
  GET_RANGE: (e, op) => {
    const n = target(e, op.targetId, false);
    const r = rangeOf(n, op.payload ?? {});
    const out: unknown[][] = [];
    for (let row = r.r1; row <= r.r2; row++) { const line: unknown[] = []; for (let col = r.c1; col <= r.c2; col++) line.push(visible(readCell(e, n, row, col).display)); out.push(line); }
    return out;
  },

  /** CLEAR_CELL { range | cell, all? } — limpa conteúdo (com all: também formatação e validação). */
  CLEAR_CELL: (e, op) => {
    const n = target(e, op.targetId);
    const r = rangeOf(n, op.payload ?? {});
    const changed: string[] = [];
    for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) {
      if (n.type === 'TABLE') {
        const c = tableCell(n, row, col);
        c.value = null; delete c.formula; delete c.calculatedValue; delete c.error;
        if (op.payload?.all) { delete c.styleOverrides; delete c.validation; }
      } else {
        const addr = toAddress({ row, col }), cells = cellsMap(n);
        if (!cells[addr]) continue;
        if (op.payload?.all || (!cells[addr].styleOverrides && !cells[addr].validation)) delete cells[addr];
        else { cells[addr] = { styleOverrides: cells[addr].styleOverrides, validation: cells[addr].validation, value: null }; }
      }
      changed.push(toAddress({ row, col }));
    }
    afterWrite(e, n, changed);
    return changed.length;
  },

  INSERT_ROW: (e, op) => { const n = target(e, op.targetId); insertLines(e, n, 'row', lineIndex(op.payload ?? {}, 'row'), op.payload?.count ?? 1); return true; },
  DELETE_ROW: (e, op) => { const n = target(e, op.targetId); deleteLines(e, n, 'row', lineIndex(op.payload ?? {}, 'row'), op.payload?.count ?? 1); return true; },
  INSERT_COLUMN: (e, op) => { const n = target(e, op.targetId); insertLines(e, n, 'col', lineIndex(op.payload ?? {}, 'col'), op.payload?.count ?? 1); return true; },
  DELETE_COLUMN: (e, op) => { const n = target(e, op.targetId); deleteLines(e, n, 'col', lineIndex(op.payload ?? {}, 'col'), op.payload?.count ?? 1); return true; },

  /** Mescla um retângulo: o conteúdo fica na primeira célula; as outras são esvaziadas. */
  MERGE_CELLS: (e, op) => {
    const n = target(e, op.targetId);
    const r = rangeOf(n, op.payload ?? {});
    if (r.r1 === r.r2 && r.c1 === r.c2) fail('INVALID_PAYLOAD', 'Selecione pelo menos duas células para mesclar.');
    if (n.type === 'TABLE') {
      const d = n.data as TableData;
      for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) { const c = tableCell(n, row, col); if (c.span || c.mergedInto) fail('INVALID_OPERATION', 'Parte dessas células já está mesclada. Divida antes.'); }
      const anchor = tableCell(n, r.r1, r.c1);
      anchor.span = { rows: r.r2 - r.r1 + 1, columns: r.c2 - r.c1 + 1 };
      for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) {
        if (row === r.r1 && col === r.c1) continue;
        const c = d.rows[row - 1].cells[col - 1];
        c.value = null; delete c.formula; delete c.calculatedValue; c.mergedInto = anchor.id;
      }
      recalcTable(e, n);
    } else {
      const merges: string[] = (n.data.merges ??= []);
      if (merges.some((m) => { const q = parseRange(m); return q.r1 <= r.r2 && q.r2 >= r.r1 && q.c1 <= r.c2 && q.c2 >= r.c1; })) fail('INVALID_OPERATION', 'Parte dessas células já está mesclada. Divida antes.');
      merges.push(`${toAddress({ row: r.r1, col: r.c1 })}:${toAddress({ row: r.r2, col: r.c2 })}`);
      const cells = cellsMap(n), changed: string[] = [];
      for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) { if (row === r.r1 && col === r.c1) continue; const a = toAddress({ row, col }); if (cells[a]) { delete cells[a]; changed.push(a); } }
      afterWrite(e, n, changed);
    }
    return true;
  },

  SPLIT_CELLS: (e, op) => {
    const n = target(e, op.targetId);
    const p = rangeOf(n, op.payload ?? {});
    if (n.type === 'TABLE') {
      const d = n.data as TableData;
      const c = tableCell(n, p.r1, p.c1);
      if (c.mergedInto) { for (const [ri, row] of d.rows.entries()) { const ci = row.cells.findIndex((x) => x.id === c.mergedInto); if (ci >= 0) { unmergeTable(d, ri + 1, ci + 1); break; } } }
      else unmergeTable(d, p.r1, p.c1);
    } else {
      n.data.merges = (n.data.merges as string[] ?? []).filter((m) => { const q = parseRange(m); return !(p.r1 >= q.r1 && p.r1 <= q.r2 && p.c1 >= q.c1 && p.c1 <= q.c2); });
    }
    return true;
  },

  RESIZE_ROW: (e, op) => {
    const n = target(e, op.targetId);
    const i = lineIndex(op.payload ?? {}, 'row'), h = Number(op.payload?.height);
    if (!(h > 0)) fail('VALIDATION', 'A altura precisa ser maior que zero.');
    if (n.type === 'TABLE') { const row = (n.data as TableData).rows[i - 1] ?? fail('NOT_FOUND', `Linha ${i} não existe.`); row!.height = h; }
    else (n.data.rowHeights ??= {})[String(i)] = h;
    return h;
  },
  RESIZE_COLUMN: (e, op) => {
    const n = target(e, op.targetId);
    const i = lineIndex(op.payload ?? {}, 'col'), w = Number(op.payload?.width);
    if (!(w > 0)) fail('VALIDATION', 'A largura precisa ser maior que zero.');
    if (n.type === 'TABLE') { const col = (n.data as TableData).columns[i - 1] ?? fail('NOT_FOUND', `Coluna ${i} não existe.`); col!.width = w; }
    else (n.data.colWidths ??= {})[indexToCol(i)] = w;
    return w;
  },

  /** Tabela: colunas com a mesma largura (ou linhas com a mesma altura), mantendo o total. */
  DISTRIBUTE_COLUMNS: (e, op) => {
    const n = target(e, op.targetId);
    if (n.type !== 'TABLE') fail('INVALID_OPERATION', 'Distribuir colunas vale para tabelas.');
    const d = n.data as TableData;
    const w = d.columns.reduce((s, c) => s + c.width, 0) / d.columns.length;
    d.columns.forEach((c) => { c.width = w; });
    return w;
  },
  DISTRIBUTE_ROWS: (e, op) => {
    const n = target(e, op.targetId);
    if (n.type !== 'TABLE') fail('INVALID_OPERATION', 'Distribuir linhas vale para tabelas.');
    const d = n.data as TableData;
    const h = d.rows.reduce((s, r) => s + (r.height ?? 32), 0) / d.rows.length;
    d.rows.forEach((r) => { r.height = h; });
    return h;
  },

  /** SORT { column: 'B' | 2, direction: ASC|DESC, header?, range? (planilha) } */
  SORT: (e, op) => {
    const n = target(e, op.targetId);
    const p = op.payload ?? {};
    const col = typeof p.column === 'string' ? colToIndex(p.column) : Number(p.column ?? 1);
    const dir = p.direction === 'DESC' ? -1 : 1;
    if (n.type === 'TABLE') {
      const d = n.data as TableData;
      if (d.rows.some((r) => r.cells.some((c) => c.span || c.mergedInto))) fail('INVALID_OPERATION', 'Divida as células mescladas antes de ordenar.');
      const header = p.header ?? d.header;
      const head = header ? d.rows.slice(0, 1) : [];
      const body = (header ? d.rows.slice(1) : d.rows).map((row, i) => ({ row, i, key: readCell(e, n, i + 1 + (header ? 1 : 0), col).display as Scalar }));
      body.sort((a, b) => sortCmp(dir)(a.key, b.key) || a.i - b.i);
      d.rows = [...head, ...body.map((x) => x.row)];
      recalcTable(e, n);
      return d.rows.length;
    }
    const used = formulas(e).usedBounds(n);
    const r = parseRange(p.range ?? `A1:${indexToCol(Math.max(1, used.cols))}${Math.max(1, used.rows)}`);
    if ((n.data.merges as string[] ?? []).some((m) => { const q = parseRange(m); return q.r1 <= r.r2 && q.r2 >= r.r1 && q.c1 <= r.c2 && q.c2 >= r.c1; })) fail('INVALID_OPERATION', 'Divida as células mescladas antes de ordenar.');
    const first = p.header ? r.r1 + 1 : r.r1;
    const cells = cellsMap(n), fs = formulas(e);
    const rows = [];
    for (let row = first; row <= r.r2; row++) {
      const line: Record<number, SheetCell | undefined> = {};
      for (let c = r.c1; c <= r.c2; c++) line[c] = cells[toAddress({ row, col: c })];
      rows.push({ row, line, key: readCell(e, n, row, col).display as Scalar });
    }
    rows.sort((a, b) => sortCmp(dir)(visible(a.key) as Scalar, visible(b.key) as Scalar) || a.row - b.row);
    rows.forEach((item, i) => {
      const to = first + i;
      for (let c = r.c1; c <= r.c2; c++) {
        const addr = toAddress({ row: to, col: c });
        const cell = item.line[c] ? clone(item.line[c]!) : undefined;
        if (cell?.formula) cell.formula = fs.shift(cell.formula, to - item.row, 0);   // a fórmula vai junto com a linha
        if (cell) cells[addr] = cell; else delete cells[addr];
      }
    });
    fs.recalc([], true);
    return rows.length;
  },

  /** FILTER { column, rule: { type, value | values }, range? } — não apaga nada, só define o que fica visível. */
  FILTER: (e, op) => {
    const n = target(e, op.targetId);
    const p = op.payload ?? {};
    const col = typeof p.column === 'string' ? colToIndex(p.column) : Number(p.column);
    if (!col || !p.rule?.type) fail('INVALID_PAYLOAD', 'Informe column e rule { type, value }.');
    n.data.filter = { column: col, rule: p.rule, ...(p.range ? { range: p.range } : {}) };
    return visibleRows(e, n);
  },
  CLEAR_FILTER: (e, op) => { const n = target(e, op.targetId); n.data.filter = null; return true; },
  FILTERED_ROWS: (e, op) => visibleRows(e, target(e, op.targetId, false)),

  /** Regras de entrada (inclui lista suspensa: { type: 'LIST', values }). Devolve as células que já violam a regra. */
  SET_VALIDATION: (e, op) => {
    const n = target(e, op.targetId);
    const r = rangeOf(n, op.payload ?? {});
    const rule: ValidationRule | null = op.payload?.rule ?? null;
    if (rule && !['LIST', 'NUMBER', 'TEXT_LENGTH', 'DATE'].includes(rule.type)) fail('INVALID_PAYLOAD', 'Regra: LIST, NUMBER, TEXT_LENGTH ou DATE.');
    const invalid: string[] = [];
    for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) {
      const addr = toAddress({ row, col });
      if (n.type === 'TABLE') { const c = tableCell(n, row, col); c.validation = rule; try { checkRule(rule, c.value); } catch { invalid.push(addr); } }
      else {
        const cells = cellsMap(n);
        if (!rule && !cells[addr]) continue;
        cells[addr] = { ...(cells[addr] ?? { value: null }), validation: rule };
        try { checkRule(rule, cells[addr].value ?? null); } catch { invalid.push(addr); }
      }
    }
    return { invalid };
  },

  /** Formatação de células (fonte, cor, preenchimento, bordas, alinhamento…). */
  FORMAT_CELLS: (e, op) => {
    const n = target(e, op.targetId);
    const r = rangeOf(n, op.payload ?? {});
    const props = op.payload?.properties ?? fail('INVALID_PAYLOAD', 'Informe properties.');
    validateProps('TABLE', props);
    let k = 0;
    for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) {
      if (n.type === 'TABLE') { const c = tableCell(n, row, col); c.styleOverrides = merge(c.styleOverrides ?? {}, props); }
      else { const cells = cellsMap(n), a = toAddress({ row, col }); cells[a] = { ...(cells[a] ?? { value: null }), styleOverrides: merge(cells[a]?.styleOverrides ?? {}, props) }; }
      k++;
    }
    return k;
  },

  /** COPY_FORMULA { from: 'A1', to: 'B3' | range } — referências relativas andam junto. */
  COPY_FORMULA: (e, op) => {
    const n = target(e, op.targetId);
    const from = parseAddress(op.payload?.from ?? fail('INVALID_PAYLOAD', 'Informe from.'));
    const src = readCell(e, n, from.row, from.col);
    if (!src.formula) fail('INVALID_OPERATION', `${toAddress(from)} não tem fórmula.`);
    const to = parseRange(op.payload?.to ?? fail('INVALID_PAYLOAD', 'Informe to.'));
    const changed: string[] = [];
    for (let row = to.r1; row <= to.r2; row++) for (let col = to.c1; col <= to.c2; col++) {
      writeCell(e, n, row, col, null, { formula: formulas(e).shift(src.formula!, row - from.row, col - from.col) });
      changed.push(toAddress({ row, col }));
    }
    afterWrite(e, n, changed);
    return changed.length;
  },

  /** FILL { range, direction: DOWN|RIGHT }: repete a primeira linha/coluna no resto (fórmulas ajustadas). */
  FILL: (e, op) => {
    const n = target(e, op.targetId);
    const r = rangeOf(n, op.payload ?? {});
    const down = (op.payload?.direction ?? 'DOWN') === 'DOWN';
    const changed: string[] = [];
    for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) {
      if (down ? row === r.r1 : col === r.c1) continue;
      const src = readCell(e, n, down ? r.r1 : row, down ? col : r.c1);
      if (src.formula) writeCell(e, n, row, col, null, { formula: formulas(e).shift(src.formula, down ? row - r.r1 : 0, down ? 0 : col - r.c1) });
      else writeCell(e, n, row, col, src.value);
      changed.push(toAddress({ row, col }));
    }
    afterWrite(e, n, changed);
    return changed.length;
  },

  /** Intervalo nomeado: DEFINE_NAME { name: 'VENDAS', range: 'Planilha1!B2:B13' } → =SOMA(VENDAS). */
  DEFINE_NAME: (e, op) => {
    const name = String(op.payload?.name ?? '').toUpperCase();
    if (!/^[A-ZÀ-Ý_][A-ZÀ-Ý0-9_.]*$/.test(name) || /^[A-Z]{1,3}\d+$/.test(name)) fail('VALIDATION', 'Nome inválido (use letras, números e _; não pode parecer um endereço como A1).');
    const range = String(op.payload?.range ?? '');
    if (!range.includes('!')) fail('VALIDATION', 'Informe a planilha no intervalo, ex.: Planilha1!A1:B10.');
    checkFormula(`=${range}`);
    (e.touch('document', 'info') as any).settings.names[name] = range;
    formulas(e).recalc([], true);
    return name;
  },
  DELETE_NAME: (e, op) => {
    const name = String(op.payload?.name ?? '').toUpperCase();
    delete (e.touch('document', 'info') as any).settings.names[name];
    formulas(e).recalc([], true);
    return name;
  },

  /** Recalcula tudo (manual): planilhas e tabelas com fórmulas. */
  RECALCULATE: (e) => {
    for (const n of Object.values(e.doc.nodes)) if (n.type === 'TABLE' && n.data.rows?.some((r: any) => r.cells.some((c: any) => c.formula))) recalcTable(e, e.touchNode(n.id));
    return formulas(e).recalc([], true);
  },

  /** Lista os erros de cálculo do documento (revisão: "identificar erros em fórmulas"). */
  FORMULA_ERRORS: (e) => {
    const out: { nodeId: string; cell: string; code: string; message: string }[] = [];
    for (const n of Object.values(e.doc.nodes)) {
      if (isSheet(n)) for (const [a, c] of Object.entries<SheetCell>(n.data.cells ?? {})) { if (c.error) out.push({ nodeId: n.id, cell: a, ...c.error }); }
      if (n.type === 'TABLE') (n.data as TableData).rows.forEach((row, r) => row.cells.forEach((c, k) => { if (c.error) out.push({ nodeId: n.id, cell: toAddress({ row: r + 1, col: k + 1 }), ...c.error }); }));
    }
    return out;
  },

  /** Parágrafos de texto → tabela (cada parágrafo é uma linha; colunas separadas por tab, ";" ou ","). */
  TEXT_TO_TABLE: (e, op) => {
    const ids: string[] = op.targetIds?.length ? op.targetIds : op.targetId ? [op.targetId] : e.state.selection.selectedIds;
    if (!ids.length) fail('INVALID_PAYLOAD', 'Selecione os parágrafos.');
    const sep = op.payload?.separator ?? '\t';
    const nodes = ids.map((id) => e.get(id)).sort((a, b) => a.order - b.order);
    if (nodes.some((x) => x.type !== 'TEXT') || new Set(nodes.map((x) => x.parentId)).size > 1) fail('INVALID_OPERATION', 'Selecione parágrafos seguidos de texto.');
    const values = nodes.map((x) => (x.data.runs ?? []).map((r: any) => r.text).join('').split(sep).map(coerceInput));
    const parentId = nodes[0].parentId!, index = nodes[0].order;
    nodes.forEach((x) => e.assertEditable(x.id));
    for (const x of nodes) { const p = e.touchNode(parentId); p.children = p.children.filter((c: string) => c !== x.id); e.del('nodes', x.id); }
    e.normalizeOrder(parentId);
    const t = createNode(e, { parentId, nodeType: 'TABLE', data: buildTableData(e, { values, header: op.payload?.header ?? true }), layout: { mode: 'FLOW' }, index });
    return t.id;
  },

  /** Tabela → parágrafos (cada linha vira um parágrafo, colunas separadas por tab). */
  TABLE_TO_TEXT: (e, op) => {
    const t = e.get(op.targetId);
    if (t.type !== 'TABLE') fail('INVALID_OPERATION', `${t.id} não é uma tabela.`);
    e.assertEditable(t.id);
    const sep = op.payload?.separator ?? '\t';
    const lines = (t.data as TableData).rows.map((row, r) => row.cells.map((_, c) => { const v = visible(readCell(e, t, r + 1, c + 1).display); return v === null ? '' : String(v); }).join(sep));
    const parentId = t.parentId!, index = t.order;
    const p = e.touchNode(parentId);
    p.children = p.children.filter((c: string) => c !== t.id);
    e.del('nodes', t.id);
    e.normalizeOrder(parentId);
    return lines.map((text, i) => createNode(e, { parentId, nodeType: 'TEXT', data: { textType: 'PARAGRAPH', runs: [{ id: e.newId('RUN'), text, format: {} }] }, layout: { mode: 'FLOW' }, index: index + i }).id);
  },
};

tableHandlers.UPDATE_CELL = tableHandlers.SET_CELL;   // nome usado na especificação

// ---------------------------------------------------------------- copiar e colar células

function snapshotCells(e: Engine, n: EditorNode, r: { r1: number; c1: number; r2: number; c2: number }) {
  const matrix = [];
  for (let row = r.r1; row <= r.r2; row++) {
    const line = [];
    for (let col = r.c1; col <= r.c2; col++) {
      const c = readCell(e, n, row, col);
      const style = n.type === 'TABLE' ? tableCell(n, row, col).styleOverrides : cellsMap(n)[toAddress({ row, col })]?.styleOverrides;
      line.push({ value: c.value, formula: c.formula, display: visible(c.display), ...(style ? { styleOverrides: clone(style) } : {}) });
    }
    matrix.push(line);
  }
  return matrix;
}

function copyCells(e: Engine, op: any, operation: 'COPY' | 'CUT') {
  const n = target(e, op.targetId, false);
  const r = rangeOf(n, op.payload ?? {});
  e.state.clipboard = { operation, sourceParentId: n.id, items: [], cells: { sourceId: n.id, origin: { row: r.r1, col: r.c1 }, matrix: snapshotCells(e, n, r) } };
  e.emit('clipboard', { operation, cells: (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) });
  return { rows: r.r2 - r.r1 + 1, columns: r.c2 - r.c1 + 1 };
}

const quoteSheetName = (name: string) => (/^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

Object.assign(tableHandlers, {
  /** Copia um intervalo de células (valores, fórmulas e formatação). */
  COPY_CELLS: (e: Engine, op: any) => copyCells(e, op, 'COPY'),
  /** Recorta: as células de origem só são limpas quando a colagem dá certo. */
  CUT_CELLS: (e: Engine, op: any) => copyCells(e, op, 'CUT'),

  /**
   * PASTE_CELLS { cell, mode?, transpose? } no destino (targetId):
   *   ALL (padrão): valores, fórmulas (referências relativas ajustadas) e formatação
   *   VALUES: só os resultados · FORMULAS: fórmulas e valores, sem formatação · FORMAT_ONLY: só a formatação
   *   LINK: fórmulas que apontam para as células de origem (=Planilha1!A1), só de planilha para planilha
   *   transpose: true troca linhas por colunas.
   */
  PASTE_CELLS: (e: Engine, op: any) => {
    const cb = e.state.clipboard?.cells ?? fail('EMPTY_CLIPBOARD', 'Copie células primeiro.');
    const n = target(e, op.targetId ?? cb!.sourceId);
    const start = posOf(n, op.payload ?? { cell: 'A1' });
    const mode = op.payload?.mode ?? 'ALL';
    if (!['ALL', 'VALUES', 'FORMULAS', 'FORMAT_ONLY', 'LINK'].includes(mode)) fail('INVALID_PAYLOAD', 'Modo: ALL, VALUES, FORMULAS, FORMAT_ONLY ou LINK.');
    const transpose = Boolean(op.payload?.transpose);
    const source = e.get(cb!.sourceId);
    if (mode === 'LINK' && (!isSheet(source) || !isSheet(n))) fail('INVALID_OPERATION', 'Colar como vínculo vale entre planilhas.');
    const fs = formulas(e);
    const changed: string[] = [];
    cb!.matrix.forEach((line, i) => line.forEach((src, j) => {
      const row = start.row + (transpose ? j : i), col = start.col + (transpose ? i : j);
      const from = { row: cb!.origin.row + i, col: cb!.origin.col + j };
      if (mode === 'FORMAT_ONLY' || mode === 'ALL') {
        const style = src.styleOverrides ?? null;
        if (n.type === 'TABLE') { const c = tableCell(n, row, col); if (style) c.styleOverrides = clone(style); else delete c.styleOverrides; }
        else if (style || mode === 'FORMAT_ONLY') { const cells = cellsMap(n), a = toAddress({ row, col }); cells[a] = { ...(cells[a] ?? { value: null }), ...(style ? { styleOverrides: clone(style) } : {}) }; }
      }
      if (mode === 'FORMAT_ONLY') return;
      if (mode === 'LINK') writeCell(e, n, row, col, null, { formula: `=${quoteSheetName(String(source.data.name))}!${toAddress(from)}` });
      else if (mode === 'VALUES') writeCell(e, n, row, col, src.display as Scalar);
      else if (src.formula) writeCell(e, n, row, col, null, { formula: fs.shift(src.formula, row - from.row, col - from.col) });
      else writeCell(e, n, row, col, src.value as Scalar);
      changed.push(toAddress({ row, col }));
    }));
    // recorte concluído: limpa a origem (o que não foi sobrescrito pelo próprio destino)
    if (e.state.clipboard!.operation === 'CUT' && mode === 'ALL') {
      const src = e.touchNode(cb!.sourceId);
      cb!.matrix.forEach((line, i) => line.forEach((_, j) => {
        const row = cb!.origin.row + i, col = cb!.origin.col + j;
        if (src.id === n.id && changed.includes(toAddress({ row, col }))) return;
        if (src.type === 'TABLE') { const c = tableCell(src, row, col); c.value = null; delete c.formula; delete c.calculatedValue; delete c.error; delete c.styleOverrides; }
        else delete cellsMap(src)[toAddress({ row, col })];
        if (src.id === n.id) changed.push(toAddress({ row, col }));
      }));
      // quem apontava para as células recortadas passa a apontar para o novo lugar
      if (isSheet(src) && isSheet(n) && !transpose) {
        const rect = { r1: cb!.origin.row, c1: cb!.origin.col, r2: cb!.origin.row + cb!.matrix.length - 1, c2: cb!.origin.col + cb!.matrix[0].length - 1 };
        moveReferences(fs, e, src.id, rect, n.id, start.row - cb!.origin.row, start.col - cb!.origin.col);
      }
      if (src.id !== n.id) afterWrite(e, src, cb!.matrix.flatMap((line, i) => line.map((_, j) => toAddress({ row: cb!.origin.row + i, col: cb!.origin.col + j }))));
      e.state.clipboard = null;
    }
    afterWrite(e, n, changed);
    return { rows: transpose ? cb!.matrix[0].length : cb!.matrix.length, columns: transpose ? cb!.matrix.length : cb!.matrix[0].length };
  },
});
