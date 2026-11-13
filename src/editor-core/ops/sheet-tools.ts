// C2 · Grade, tabelas estruturadas e análise de dados nas planilhas (o que faltava em relação ao Excel).
//   Grade:     FREEZE_PANES · HIDE_ROWS/SHOW_ROWS · HIDE_COLUMNS/SHOW_COLUMNS · GROUP_LINES/UNGROUP_LINES/COLLAPSE_GROUP/EXPAND_GROUP
//              AUTOFIT_COLUMNS · SUBTOTALS
//   Planilhas: SHEET_PROPERTIES (ocultar, cor da guia) · PROTECT_SHEET/UNPROTECT_SHEET · LOCK_CELLS
//   Tabela:    CREATE_SHEET_TABLE (nome, estilo, linha de totais; nomes por coluna) · REMOVE_DUPLICATES
//   Análise:   PIVOT_TABLE/REFRESH_PIVOT · GOAL_SEEK · ADD_SCENARIO/APPLY_SCENARIO/SCENARIO_SUMMARY · DATA_TABLE
//              DESCRIPTIVE_STATS · REGRESSION · FORECAST_SERIES · TRACE_PRECEDENTS/TRACE_DEPENDENTS
//   Dados:     TRANSFORM_DATA (etapas no estilo do Power Query) · FLASH_FILL
import type { EditorNode } from '../types.ts';
import type { CommitHook, Engine, Handler } from '../engine.ts';
import { clone, fail } from '../util.ts';
import { colToIndex, collectRefs, indexToCol, parse, parseAddress, parseRange, toAddress } from '../formula/parse.ts';
import { sha256 } from './document-tools.ts';

type Cell = string | number | boolean | null;
const sheetOf = (e: Engine, id: string | null | undefined) => {
  const n = e.get(id ?? e.state.activeSurface);
  if (n.type !== 'SURFACE' || n.data.surfaceType !== 'SHEET') fail('INVALID_OPERATION', `${n.id} não é uma planilha.`);
  return n;
};
const read = (e: Engine, sh: string, range: string) => e.run({ type: 'GET_RANGE', targetId: sh, payload: { range } }) as Cell[][];
const cellValue = (e: Engine, sh: string, cell: string) => (e.run({ type: 'GET_CELL', targetId: sh, payload: { cell } }) as any).display as Cell;
const write = (e: Engine, sh: string, start: string, values: Cell[][]) => { if (values.length) e.run({ type: 'SET_CELLS', targetId: sh, payload: { start, values } }); };
const clearRange = (e: Engine, sh: string, range: string) => e.run({ type: 'CLEAR_CELL', targetId: sh, payload: { range } });
const rangeText = (r1: number, c1: number, r2: number, c2: number) => `${toAddress({ row: r1, col: c1 })}:${toAddress({ row: r2, col: c2 })}`;
const num = (v: Cell) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : null);
const colIndex = (head: Cell[], c: string | number) => {
  if (typeof c === 'number') return c;
  const i = head.findIndex((h) => String(h).toLowerCase() === c.toLowerCase());
  if (i >= 0) return i;
  if (/^[A-Z]{1,3}$/i.test(c)) return colToIndex(c) - 1;
  return fail('VALIDATION', `Coluna "${c}" não encontrada.`);
};

// ---------------------------------------------------------------- agregações (tabela dinâmica, subtotais, transformar)
export const AGGREGATES: Record<string, { label: string; fn: (xs: Cell[]) => Cell }> = {
  SUM: { label: 'Soma', fn: (xs) => xs.map(num).filter((x): x is number => x !== null).reduce((s, x) => s + x, 0) },
  COUNT: { label: 'Contagem', fn: (xs) => xs.filter((x) => x !== null && x !== '').length },
  COUNT_NUMBERS: { label: 'Contagem de números', fn: (xs) => xs.filter((x) => num(x) !== null).length },
  AVERAGE: { label: 'Média', fn: (xs) => { const n = xs.map(num).filter((x): x is number => x !== null); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : null; } },
  MIN: { label: 'Mínimo', fn: (xs) => { const n = xs.map(num).filter((x): x is number => x !== null); return n.length ? Math.min(...n) : null; } },
  MAX: { label: 'Máximo', fn: (xs) => { const n = xs.map(num).filter((x): x is number => x !== null); return n.length ? Math.max(...n) : null; } },
  DISTINCT: { label: 'Contagem distinta', fn: (xs) => new Set(xs.filter((x) => x !== null && x !== '').map(String)).size },
};
const agg = (name: string) => AGGREGATES[name] ?? fail('VALIDATION', `Resumo: ${Object.keys(AGGREGATES).join(', ')}.`);

/** Etapas de transformação de dados (Power Query): recebem e devolvem a tabela com cabeçalho na primeira linha. */
function applyStep(t: Cell[][], s: Record<string, any>): Cell[][] {
  const [head, ...body] = t;
  const ci = (c: string | number) => colIndex(head, c);
  switch (s.op) {
    case 'SELECT_COLUMNS': { const idx = (s.columns as any[]).map(ci); return t.map((r) => idx.map((i) => r[i] ?? null)); }
    case 'REMOVE_COLUMNS': { const drop = new Set((s.columns as any[]).map(ci)); return t.map((r) => r.filter((_, i) => !drop.has(i))); }
    case 'RENAME_COLUMN': { const i = ci(s.column); return [head.map((h, k) => (k === i ? s.to : h)), ...body]; }
    case 'FILTER_ROWS': {
      const i = ci(s.column), v = s.value;
      const test = (x: Cell) => { const a = num(x), b = typeof v === 'number' ? v : num(v); switch (s.operator ?? '=') { case '>': return a !== null && b !== null && a > b; case '<': return a !== null && b !== null && a < b; case '>=': return a !== null && b !== null && a >= b; case '<=': return a !== null && b !== null && a <= b; case '<>': return String(x) !== String(v); case 'CONTAINS': return String(x ?? '').toLowerCase().includes(String(v).toLowerCase()); case 'NOT_EMPTY': return x !== null && x !== ''; default: return String(x) === String(v); } };
      return [head, ...body.filter((r) => test(r[i]))];
    }
    case 'REMOVE_ROWS': { const top = s.top ?? 0, bottom = s.bottom ?? 0; return [head, ...body.slice(top, body.length - bottom)]; }
    case 'REMOVE_EMPTY_ROWS': return [head, ...body.filter((r) => r.some((x) => x !== null && x !== ''))];
    case 'REPLACE_VALUES': { const i = s.column !== undefined ? ci(s.column) : null; return [head, ...body.map((r) => r.map((x, k) => ((i === null || k === i) && String(x) === String(s.find) ? s.replace : x)))]; }
    case 'SPLIT_COLUMN': {
      const i = ci(s.column), d = String(s.delimiter ?? ','), parts = body.map((r) => String(r[i] ?? '').split(d));
      const w = Math.max(1, ...parts.map((p) => p.length));
      const names = Array.from({ length: w }, (_, k) => `${head[i]}.${k + 1}`);
      return [[...head.slice(0, i), ...names, ...head.slice(i + 1)], ...body.map((r, k) => [...r.slice(0, i), ...Array.from({ length: w }, (_, j) => parts[k][j]?.trim() ?? null), ...r.slice(i + 1)])];
    }
    case 'MERGE_COLUMNS': { const idx = (s.columns as any[]).map(ci); const keep = head.map((_, k) => k).filter((k) => !idx.includes(k)); return [[...keep.map((k) => head[k]), s.name ?? 'Mesclado'], ...body.map((r) => [...keep.map((k) => r[k]), idx.map((k) => r[k] ?? '').join(s.separator ?? ' ')])]; }
    case 'ADD_COLUMN': {
      // coluna personalizada: modelo com {Coluna} (texto) ou condicional { if: { column, operator, value }, then, else }
      const val = (r: Cell[]): Cell => {
        if (s.if) { const k = ci(s.if.column); const ok = applyStep([head, r], { op: 'FILTER_ROWS', column: k, operator: s.if.operator, value: s.if.value }).length > 1; return ok ? s.then : s.else ?? null; }
        const txt = String(s.template ?? '').replace(/\{([^}]+)\}/g, (_, c) => String(r[ci(c)] ?? ''));
        return num(txt) ?? txt;
      };
      return [[...head, s.name ?? 'Personalizada'], ...body.map((r) => [...r, val(r)])];
    }
    case 'CHANGE_TYPE': { const i = ci(s.column); const conv = (x: Cell): Cell => (s.type === 'NUMBER' ? num(x) : s.type === 'TEXT' ? (x === null ? null : String(x)) : s.type === 'BOOLEAN' ? Boolean(x) && x !== 'FALSO' && x !== 'false' && x !== 0 : x); return [head, ...body.map((r) => r.map((x, k) => (k === i ? conv(x) : x)))]; }
    case 'FILL_DOWN': { const idx = (s.columns as any[]).map(ci); const last: Record<number, Cell> = {}; return [head, ...body.map((r) => r.map((x, k) => { if (!idx.includes(k)) return x; if (x === null || x === '') return last[k] ?? null; last[k] = x; return x; }))]; }
    case 'SORT': { const i = ci(s.column), dir = s.order === 'DESC' ? -1 : 1; return [head, ...[...body].sort((a, b) => { const x = num(a[i]), y = num(b[i]); return (x !== null && y !== null ? x - y : String(a[i] ?? '').localeCompare(String(b[i] ?? ''), 'pt-BR')) * dir; })]; }
    case 'REMOVE_DUPLICATES': { const idx = s.columns ? (s.columns as any[]).map(ci) : head.map((_, k) => k); const seen = new Set<string>(); return [head, ...body.filter((r) => { const k = JSON.stringify(idx.map((i) => String(r[i] ?? '').toLowerCase())); if (seen.has(k)) return false; seen.add(k); return true; })]; }
    case 'TRANSPOSE': return t[0].map((_, j) => t.map((r) => r[j] ?? null));
    case 'GROUP_BY': {
      const keys = (s.columns as any[]).map(ci), aggs = (s.aggregations as { column: any; fn: string; name?: string }[]);
      const groups = new Map<string, Cell[][]>();
      for (const r of body) { const k = JSON.stringify(keys.map((i) => r[i])); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
      return [[...keys.map((i) => head[i]), ...aggs.map((a) => a.name ?? `${agg(a.fn).label} de ${head[ci(a.column)]}`)], ...[...groups.entries()].map(([k, rs]) => [...JSON.parse(k), ...aggs.map((a) => agg(a.fn).fn(rs.map((r) => r[ci(a.column)])))])];
    }
    case 'UNPIVOT': {
      const keep = (s.keep as any[]).map(ci), rest = head.map((_, k) => k).filter((k) => !keep.includes(k));
      return [[...keep.map((k) => head[k]), s.attribute ?? 'Atributo', s.value ?? 'Valor'], ...body.flatMap((r) => rest.map((k) => [...keep.map((i) => r[i]), head[k], r[k]]))];
    }
    case 'PIVOT': {
      const rk = ci(s.rows), ck = ci(s.columns), vk = ci(s.values), f = agg(s.fn ?? 'SUM');
      const cols = [...new Set(body.map((r) => String(r[ck])))], rows = [...new Set(body.map((r) => String(r[rk])))];
      return [[head[rk], ...cols], ...rows.map((rv) => [rv, ...cols.map((cv) => f.fn(body.filter((r) => String(r[rk]) === rv && String(r[ck]) === cv).map((r) => r[vk])))])];
    }
    case 'APPEND': { const other = s.rows as Cell[][]; const [oh, ...ob] = other; return [head, ...body, ...ob.map((r) => head.map((h) => r[oh.findIndex((x) => String(x) === String(h))] ?? null))]; }
    case 'MERGE_QUERY': {
      // junção (como "Mesclar consultas"): LEFT ou INNER pela coluna-chave
      const other = s.rows as Cell[][]; const [oh, ...ob] = other; const k1 = ci(s.key), k2 = oh.findIndex((x) => String(x) === String(s.otherKey ?? s.key));
      if (k2 < 0) fail('VALIDATION', 'Chave não encontrada na outra tabela.');
      const extra = oh.map((_, k) => k).filter((k) => k !== k2);
      const out = body.flatMap((r) => { const m = ob.filter((o) => String(o[k2]) === String(r[k1])); return m.length ? m.map((o) => [...r, ...extra.map((k) => o[k])]) : s.kind === 'INNER' ? [] : [[...r, ...extra.map(() => null)]]; });
      return [[...head, ...extra.map((k) => oh[k])], ...out];
    }
    default: return fail('VALIDATION', `Etapa desconhecida: ${s.op}.`);
  }
}
export const TRANSFORM_STEPS = ['SELECT_COLUMNS', 'REMOVE_COLUMNS', 'RENAME_COLUMN', 'FILTER_ROWS', 'REMOVE_ROWS', 'REMOVE_EMPTY_ROWS', 'REPLACE_VALUES', 'SPLIT_COLUMN', 'MERGE_COLUMNS', 'ADD_COLUMN', 'CHANGE_TYPE', 'FILL_DOWN', 'SORT', 'REMOVE_DUPLICATES', 'TRANSPOSE', 'GROUP_BY', 'UNPIVOT', 'PIVOT', 'APPEND', 'MERGE_QUERY'];

// ---------------------------------------------------------------- preenchimento relâmpago
const FLASH: { name: string; fn: (s: string) => string }[] = [
  { name: 'primeira palavra', fn: (s) => s.trim().split(/\s+/)[0] ?? '' },
  { name: 'última palavra', fn: (s) => s.trim().split(/\s+/).at(-1) ?? '' },
  { name: 'iniciais', fn: (s) => s.trim().split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('') },
  { name: 'maiúsculas', fn: (s) => s.toLocaleUpperCase('pt-BR') }, { name: 'minúsculas', fn: (s) => s.toLocaleLowerCase('pt-BR') },
  { name: 'primeira letra maiúscula', fn: (s) => s.toLocaleLowerCase('pt-BR').replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('pt-BR')) },
  { name: 'só dígitos', fn: (s) => s.replace(/\D/g, '') },
  { name: 'antes do @', fn: (s) => s.split('@')[0] }, { name: 'depois do @', fn: (s) => s.split('@')[1] ?? '' },
  { name: 'sobrenome, nome', fn: (s) => { const w = s.trim().split(/\s+/); return w.length > 1 ? `${w.at(-1)}, ${w.slice(0, -1).join(' ')}` : s; } },
  { name: 'nome + inicial do sobrenome', fn: (s) => { const w = s.trim().split(/\s+/); return w.length > 1 ? `${w[0]} ${w.at(-1)![0]}.` : s; } },
];

// ---------------------------------------------------------------- proteção de planilha
/** Planilha protegida: só as células desbloqueadas (locked: false) podem mudar. */
export const sheetProtectionHook: CommitHook = (e, { type, changes, remote }) => {
  if (remote || ['UNPROTECT_SHEET', 'PROTECT_SHEET', 'LOCK_CELLS'].includes(type)) return;
  for (const c of changes) {
    if (c.collection !== 'nodes') continue;
    const before = c.before as EditorNode | undefined, after = c.after as EditorNode | undefined;
    const prot = (before?.data?.protection ?? after?.data?.protection);
    if (!prot || before?.data?.surfaceType !== 'SHEET') continue;
    const bc = before.data.cells ?? {}, ac = after?.data?.cells ?? {};
    for (const addr of new Set([...Object.keys(bc), ...Object.keys(ac)])) {
      if (JSON.stringify(bc[addr]) === JSON.stringify(ac[addr])) continue;
      if ((bc[addr]?.styleOverrides?.locked ?? true) !== false) fail('LOCKED', `A planilha "${before.data.name}" está protegida (célula ${addr} bloqueada).`);
    }
    for (const k of ['rowHeights', 'colWidths', 'merges', 'hiddenRows', 'hiddenColumns'] as const)
      if (!prot.allow?.includes(k) && JSON.stringify(before.data[k]) !== JSON.stringify(after?.data?.[k])) fail('LOCKED', `A planilha "${before.data.name}" está protegida (estrutura).`);
  }
};
export function installSheetProtection(e: Engine) { e.commitHooks.unshift(sheetProtectionHook); }

const linesOf = (spec: string | number[] | undefined, axis: 'row' | 'col'): number[] => {
  if (Array.isArray(spec)) return spec;
  const [a, b = a] = String(spec ?? '').split(':');
  const conv = (x: string) => (axis === 'col' && /^[A-Z]+$/i.test(x) ? colToIndex(x) : Number(x));
  const lo = conv(a), hi = conv(b);
  if (!(lo >= 1 && hi >= lo)) fail('VALIDATION', axis === 'row' ? 'Linhas: "3" ou "3:7".' : 'Colunas: "B" ou "B:D".');
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
};

export const sheetToolHandlers: Record<string, Handler> = {
  // ---------------------------------------------------------------- grade
  /** Congelar painéis: FREEZE_PANES { rows, columns } (0/0 ou null descongela). */
  FREEZE_PANES: (e, op) => {
    const s = sheetOf(e, op.targetId); e.assertEditable(s.id);
    const rows = op.payload?.rows ?? 0, columns = op.payload?.columns ?? 0;
    if (!(Number.isInteger(rows) && rows >= 0 && Number.isInteger(columns) && columns >= 0)) fail('VALIDATION', 'Linhas e colunas congeladas: inteiros ≥ 0.');
    const t = e.touchNode(s.id);
    if (!rows && !columns) delete t.data.frozen; else t.data.frozen = { rows, columns };
    return t.data.frozen ?? null;
  },
  HIDE_ROWS: (e, op) => { const t = e.touchNode(sheetOf(e, op.targetId).id); t.data.hiddenRows = [...new Set([...(t.data.hiddenRows ?? []), ...linesOf(op.payload?.rows, 'row')])].sort((a, b) => a - b); return t.data.hiddenRows; },
  SHOW_ROWS: (e, op) => { const t = e.touchNode(sheetOf(e, op.targetId).id); const show = new Set(op.payload?.rows ? linesOf(op.payload.rows, 'row') : t.data.hiddenRows ?? []); t.data.hiddenRows = (t.data.hiddenRows ?? []).filter((r: number) => !show.has(r)); return t.data.hiddenRows; },
  HIDE_COLUMNS: (e, op) => { const t = e.touchNode(sheetOf(e, op.targetId).id); t.data.hiddenColumns = [...new Set([...(t.data.hiddenColumns ?? []), ...linesOf(op.payload?.columns, 'col')])].sort((a, b) => a - b); return t.data.hiddenColumns; },
  SHOW_COLUMNS: (e, op) => { const t = e.touchNode(sheetOf(e, op.targetId).id); const show = new Set(op.payload?.columns ? linesOf(op.payload.columns, 'col') : t.data.hiddenColumns ?? []); t.data.hiddenColumns = (t.data.hiddenColumns ?? []).filter((c: number) => !show.has(c)); return t.data.hiddenColumns; },

  /** Agrupar (estrutura de tópicos): GROUP_LINES { axis: ROW|COLUMN, range: "3:7" | "B:D" }. */
  GROUP_LINES: (e, op) => {
    const axis = op.payload?.axis === 'COLUMN' ? 'col' : 'row';
    const t = e.touchNode(sheetOf(e, op.targetId).id);
    const lines = linesOf(op.payload?.range, axis);
    const key = axis === 'row' ? 'rowGroups' : 'colGroups';
    const groups: any[] = t.data[key] ?? [];
    const from = lines[0], to = lines.at(-1)!;
    const level = 1 + groups.filter((g) => g.from <= from && g.to >= to).length;
    if (level > 8) fail('VALIDATION', 'Até 8 níveis de agrupamento.');
    const id = e.newId('GROUP');
    t.data[key] = [...groups, { id, from, to, level, collapsed: false }];
    return id;
  },
  UNGROUP_LINES: (e, op) => {
    const t = e.touchNode(sheetOf(e, op.targetId).id);
    for (const key of ['rowGroups', 'colGroups']) t.data[key] = (t.data[key] ?? []).filter((g: any) => g.id !== op.payload?.groupId && !(op.payload?.all));
    return true;
  },
  /** Recolher/expandir um grupo: as linhas/colunas dele ficam ocultas/visíveis. */
  COLLAPSE_GROUP: (e, op) => toggleGroup(e, op.targetId, op.payload?.groupId, true),
  EXPAND_GROUP: (e, op) => toggleGroup(e, op.targetId, op.payload?.groupId, false),

  /** Autoajustar a largura das colunas pelo conteúdo: AUTOFIT_COLUMNS { columns: "A:D" }. */
  AUTOFIT_COLUMNS: (e, op) => {
    const s = sheetOf(e, op.targetId);
    const cols = linesOf(op.payload?.columns ?? 'A', 'col');
    const t = e.touchNode(s.id);
    const widths: Record<string, number> = {};
    for (const c of cols) {
      let w = 4;
      for (const [addr, cell] of Object.entries<any>(t.data.cells ?? {})) {
        const p = parseAddress(addr); if (p.col !== c) continue;
        const txt = (e.run({ type: 'GET_CELL', targetId: s.id, payload: { cell: addr } }) as any).text ?? '';
        w = Math.max(w, String(txt).length);
        void cell;
      }
      widths[c] = Math.min(400, Math.round(w * 7.5 + 16));
      (t.data.colWidths ??= {})[String(c)] = widths[c];
    }
    return widths;
  },

  /** Subtotais: SUBTOTALS { range (com cabeçalho), groupBy (coluna), fn, columns } — reescreve o intervalo com uma linha de total por grupo e o total geral. */
  SUBTOTALS: (e, op) => {
    const s = sheetOf(e, op.targetId); const p = op.payload ?? {};
    const r = parseRange(p.range ?? fail('INVALID_PAYLOAD', 'Informe range.'));
    const t = read(e, s.id, p.range);
    const [head, ...body] = t;
    const g = colIndex(head, p.groupBy), cols = (p.columns as any[]).map((c) => colIndex(head, c)), f = agg(p.fn ?? 'SUM');
    const out: Cell[][] = [head];
    const totals = (rows: Cell[][], label: string) => head.map((_, k) => (k === g ? label : cols.includes(k) ? f.fn(rows.map((x) => x[k])) : null));
    let start = 0;
    for (let i = 1; i <= body.length; i++) {
      if (i === body.length || String(body[i][g]) !== String(body[start][g])) {
        const grp = body.slice(start, i);
        out.push(...grp, totals(grp, `Total ${body[start][g]}`));
        start = i;
      }
    }
    out.push(totals(body, 'Total geral'));
    const extra = out.length - t.length;
    if (extra > 0) e.run({ type: 'INSERT_ROW', targetId: s.id, payload: { index: r.r2 + 1, count: extra } });
    write(e, s.id, toAddress({ row: r.r1, col: r.c1 }), out);
    // estrutura: cada grupo pode ser recolhido
    let row = r.r1 + 1;
    const groups: { from: number; to: number }[] = [];
    for (let i = 1; i < out.length - 1; i++) { if (String(out[i][g]).startsWith('Total ') && !String(out[i][g]).startsWith('Total geral')) { groups.push({ from: row, to: r.r1 + i - 1 }); row = r.r1 + i + 1; } }
    for (const gr of groups) e.run({ type: 'GROUP_LINES', targetId: s.id, payload: { axis: 'ROW', range: `${gr.from}:${gr.to}` } });
    return { rows: out.length, groups: groups.length };
  },

  // ---------------------------------------------------------------- planilha
  /** SHEET_PROPERTIES { hidden?, tabColor?, name? } */
  SHEET_PROPERTIES: (e, op) => {
    const s = sheetOf(e, op.targetId); const p = op.payload ?? {};
    const t = e.touchNode(s.id);
    if (p.hidden !== undefined) {
      if (p.hidden) { const visible = Object.values(e.doc.nodes).filter((n) => n.data.surfaceType === 'SHEET' && !n.data.hidden && n.id !== s.id); if (!visible.length) fail('INVALID_OPERATION', 'Pelo menos uma planilha precisa ficar visível.'); }
      t.data.hidden = Boolean(p.hidden);
    }
    if (p.tabColor !== undefined) { if (p.tabColor !== null && !/^#[0-9a-f]{6}$/i.test(p.tabColor)) fail('VALIDATION', 'Cor da guia: #RRGGBB.'); t.data.tabColor = p.tabColor; }
    if (p.name !== undefined) { const nm = String(p.name).trim(); if (!nm || /[\\/?*[\]:]/.test(nm) || nm.length > 31) fail('VALIDATION', 'Nome da planilha: até 31 caracteres, sem \\ / ? * [ ] :'); t.data.name = nm; }
    return { name: t.data.name, hidden: Boolean(t.data.hidden), tabColor: t.data.tabColor ?? null };
  },
  /** Proteger planilha: PROTECT_SHEET { password?, allow?: ['rowHeights','colWidths',…] }. Células com locked: false continuam editáveis. */
  PROTECT_SHEET: (e, op) => {
    const s = sheetOf(e, op.targetId);
    if (s.data.protection) fail('INVALID_OPERATION', 'A planilha já está protegida.');
    const pw = op.payload?.password;
    const salt = e.newId('SALT');
    e.touchNode(s.id).data.protection = { ...(pw ? { salt, hash: sha256(`${salt}:${pw}`) } : {}), allow: op.payload?.allow ?? [] };
    return true;
  },
  UNPROTECT_SHEET: (e, op) => {
    const s = sheetOf(e, op.targetId);
    const p = s.data.protection;
    if (!p) return false;
    if (p.hash && sha256(`${p.salt}:${op.payload?.password ?? ''}`) !== p.hash) fail('PERMISSION_DENIED', 'Senha incorreta.');
    delete e.touchNode(s.id).data.protection;
    return true;
  },
  /** Bloquear/desbloquear células (vale quando a planilha estiver protegida): LOCK_CELLS { range, locked, hideFormula? } */
  LOCK_CELLS: (e, op) => {
    const s = sheetOf(e, op.targetId);
    const r = parseRange(op.payload?.range ?? fail('INVALID_PAYLOAD', 'Informe range.'));
    const t = e.touchNode(s.id); const cells = (t.data.cells ??= {});
    let k = 0;
    for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) {
      const a = toAddress({ row, col });
      cells[a] = { ...(cells[a] ?? { value: null }), styleOverrides: { ...(cells[a]?.styleOverrides ?? {}), locked: op.payload?.locked !== false, ...(op.payload?.hideFormula !== undefined ? { hideFormula: Boolean(op.payload.hideFormula) } : {}) } };
      k++;
    }
    return k;
  },

  // ---------------------------------------------------------------- tabela estruturada
  /** CREATE_SHEET_TABLE { range, name, style?, totalRow?, totals?: { coluna: SUM|AVERAGE|… } } — cria nomes Tabela e Tabela_Coluna para as fórmulas. */
  CREATE_SHEET_TABLE: (e, op) => {
    const s = sheetOf(e, op.targetId); const p = op.payload ?? {};
    const name = String(p.name ?? `Tabela${Object.keys(s.data.tables ?? {}).length + 1}`).replace(/\s+/g, '_');
    if (!/^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*$/.test(name)) fail('VALIDATION', 'Nome da tabela: letras, números e _.');
    if (s.data.tables?.[name]) fail('VALIDATION', `Já existe a tabela ${name}.`);
    const r = parseRange(p.range ?? fail('INVALID_PAYLOAD', 'Informe range.'));
    const head = read(e, s.id, rangeText(r.r1, r.c1, r.r1, r.c2))[0];
    if (head.some((h) => h === null || h === '')) fail('VALIDATION', 'A primeira linha precisa ter o nome de todas as colunas.');
    const sheetName = s.data.name;
    const q = (x: string) => (/^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_.]*$/.test(x) ? x : `'${x}'`);
    e.run({ type: 'DEFINE_NAME', payload: { name, range: `${q(sheetName)}!${rangeText(r.r1 + 1, r.c1, r.r2, r.c2)}` } });
    head.forEach((h, i) => {
      const nm = `${name}_${String(h).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]/g, '_')}`;
      e.run({ type: 'DEFINE_NAME', payload: { name: nm, range: `${q(sheetName)}!${rangeText(r.r1 + 1, r.c1 + i, r.r2, r.c1 + i)}` } });
    });
    const t = e.touchNode(s.id);
    t.data.tables = { ...(t.data.tables ?? {}), [name]: { range: rangeText(r.r1, r.c1, r.r2, r.c2), columns: head, style: p.style ?? 'BLUE', totalRow: Boolean(p.totalRow), bandedRows: p.bandedRows !== false } };
    if (p.totalRow) {
      const totals = p.totals ?? {};
      const fns: Record<string, string> = { SUM: 'SOMA', AVERAGE: 'MÉDIA', COUNT: 'CONT.VALORES', MIN: 'MÍNIMO', MAX: 'MÁXIMO' };
      write(e, s.id, toAddress({ row: r.r2 + 1, col: r.c1 }), [head.map((h, i) => (i === 0 && !totals[String(h)] ? 'Total' : totals[String(h)] ? `=${fns[totals[String(h)]] ?? 'SOMA'}(${rangeText(r.r1 + 1, r.c1 + i, r.r2, r.c1 + i)})` : null))]);
    }
    return name;
  },
  /** Remover duplicatas: REMOVE_DUPLICATES { range, columns?, header? } — devolve quantas linhas saíram. */
  REMOVE_DUPLICATES: (e, op) => {
    const s = sheetOf(e, op.targetId); const p = op.payload ?? {};
    const r = parseRange(p.range ?? fail('INVALID_PAYLOAD', 'Informe range.'));
    const t = read(e, s.id, p.range);
    const header = p.header !== false;
    const full = header ? t : [t[0].map((_, i) => indexToCol(r.c1 + i)), ...t];
    const out = applyStep(full, { op: 'REMOVE_DUPLICATES', columns: p.columns });
    const kept = header ? out : out.slice(1);
    clearRange(e, s.id, p.range);
    write(e, s.id, toAddress({ row: r.r1, col: r.c1 }), kept);
    return t.length - kept.length;
  },

  // ---------------------------------------------------------------- análise
  /**
   * Tabela dinâmica: PIVOT_TABLE { source: "A1:D100", rows: [col], columns?: [col], values: [{ column, fn }], filters?: { col: [valores] }, dest: "G1", grandTotals? }.
   * Grava o resultado a partir de dest e guarda a definição para REFRESH_PIVOT.
   */
  PIVOT_TABLE: (e, op) => {
    const s = sheetOf(e, op.targetId); const p = clone(op.payload ?? {});
    const id = p.id ?? e.newId('PIVOT');
    const t = read(e, s.id, p.source ?? fail('INVALID_PAYLOAD', 'Informe source.'));
    const [head, ...all] = t;
    let body = all;
    for (const [c, vals] of Object.entries<any[]>(p.filters ?? {})) { const i = colIndex(head, c); body = body.filter((r) => vals.map(String).includes(String(r[i]))); }
    const rk = (p.rows as any[] ?? []).map((c) => colIndex(head, c)), ck = (p.columns as any[] ?? []).map((c) => colIndex(head, c));
    const vs = (p.values as { column: any; fn?: string }[]) ?? fail('INVALID_PAYLOAD', 'Informe values.');
    const key = (r: Cell[], idx: number[]) => idx.map((i) => String(r[i] ?? '(vazio)')).join(' · ');
    const rowKeys = [...new Set(body.map((r) => key(r, rk)))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    const colKeys = ck.length ? [...new Set(body.map((r) => key(r, ck)))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })) : [''];
    const header: Cell[] = [rk.map((i) => head[i]).join(' · ') || 'Rótulos'];
    for (const c of colKeys) for (const v of vs) header.push([c, `${agg(v.fn ?? 'SUM').label} de ${head[colIndex(head, v.column)]}`].filter(Boolean).join(' · '));
    const totals = p.grandTotals !== false;
    if (totals && ck.length) for (const v of vs) header.push(`Total · ${agg(v.fn ?? 'SUM').label} de ${head[colIndex(head, v.column)]}`);
    const cellFor = (rows: Cell[][], v: { column: any; fn?: string }) => agg(v.fn ?? 'SUM').fn(rows.map((r) => r[colIndex(head, v.column)]));
    const out: Cell[][] = [header];
    for (const rkey of rowKeys) {
      const rr = body.filter((r) => key(r, rk) === rkey);
      const line: Cell[] = [rkey || 'Total'];
      for (const c of colKeys) for (const v of vs) line.push(cellFor(ck.length ? rr.filter((r) => key(r, ck) === c) : rr, v));
      if (totals && ck.length) for (const v of vs) line.push(cellFor(rr, v));
      out.push(line);
    }
    if (totals && rk.length) {
      const line: Cell[] = ['Total geral'];
      for (const c of colKeys) for (const v of vs) line.push(cellFor(ck.length ? body.filter((r) => key(r, ck) === c) : body, v));
      if (ck.length) for (const v of vs) line.push(cellFor(body, v));
      out.push(line);
    }
    const dest = parseAddress(p.dest ?? fail('INVALID_PAYLOAD', 'Informe dest.'));
    const prev = s.data.pivots?.[id];
    if (prev?.size) clearRange(e, s.id, rangeText(dest.row, dest.col, dest.row + prev.size[0] - 1, dest.col + prev.size[1] - 1));
    write(e, s.id, p.dest, out);
    const tt = e.touchNode(s.id);
    tt.data.pivots = { ...(tt.data.pivots ?? {}), [id]: { ...p, id, size: [out.length, header.length] } };
    return { id, rows: out.length, columns: header.length };
  },
  REFRESH_PIVOT: (e, op) => {
    const s = sheetOf(e, op.targetId);
    const def = s.data.pivots?.[op.payload?.id] ?? fail('NOT_FOUND', 'Tabela dinâmica não encontrada.');
    return e.run({ type: 'PIVOT_TABLE', targetId: s.id, payload: { ...def, ...(op.payload?.changes ?? {}), id: def.id } });
  },

  /** Atingir meta: GOAL_SEEK { setCell, toValue, byChanging } — muda byChanging até setCell valer toValue. */
  GOAL_SEEK: (e, op) => {
    const s = sheetOf(e, op.targetId); const { setCell, toValue, byChanging } = op.payload ?? {};
    if (typeof toValue !== 'number') fail('VALIDATION', 'Informe o valor desejado (toValue).');
    const set = (v: number) => { e.run({ type: 'SET_CELL', targetId: s.id, payload: { cell: byChanging, value: v } }); const r = num(cellValue(e, s.id, setCell)); return r === null ? NaN : r - toValue; };
    let x0 = num(cellValue(e, s.id, byChanging)) ?? 0, x1 = x0 === 0 ? 1 : x0 * 1.1;
    let f0 = set(x0), f1 = set(x1);
    for (let i = 0; i < 100 && Number.isFinite(f1) && Math.abs(f1) > 1e-9; i++) {
      if (f1 === f0) { x1 += 1; f1 = set(x1); continue; }
      const x2 = x1 - (f1 * (x1 - x0)) / (f1 - f0);
      x0 = x1; f0 = f1; x1 = x2; f1 = set(x1);
    }
    if (!Number.isFinite(f1) || Math.abs(f1) > 1e-6) fail('NOT_FOUND', 'Não foi possível encontrar uma solução.');
    const val = Math.round(x1 * 1e9) / 1e9;
    set(val);
    return { value: val, result: cellValue(e, s.id, setCell) };
  },

  /** Cenários: ADD_SCENARIO { name, cells: { B1: 10, B2: 0.05 } }. */
  ADD_SCENARIO: (e, op) => {
    const s = sheetOf(e, op.targetId); const { name, cells } = op.payload ?? {};
    if (!name || !cells || !Object.keys(cells).length) fail('VALIDATION', 'Cenário: name e cells (endereço → valor).');
    const t = e.touchNode(s.id); t.data.scenarios = { ...(t.data.scenarios ?? {}), [name]: clone(cells) };
    return Object.keys(t.data.scenarios);
  },
  DELETE_SCENARIO: (e, op) => { const t = e.touchNode(sheetOf(e, op.targetId).id); const sc = { ...(t.data.scenarios ?? {}) }; delete sc[op.payload?.name]; t.data.scenarios = sc; return Object.keys(sc); },
  APPLY_SCENARIO: (e, op) => {
    const s = sheetOf(e, op.targetId);
    const sc = s.data.scenarios?.[op.payload?.name] ?? fail('NOT_FOUND', `Cenário ${op.payload?.name} não existe.`);
    for (const [cell, value] of Object.entries(sc)) e.run({ type: 'SET_CELL', targetId: s.id, payload: { cell, value } });
    return sc;
  },
  /** Resumo dos cenários: o valor das células de resultado em cada cenário (a planilha volta como estava). */
  SCENARIO_SUMMARY: (e, op) => {
    const s = sheetOf(e, op.targetId); const results: string[] = op.payload?.resultCells ?? fail('INVALID_PAYLOAD', 'Informe resultCells.');
    const scs = s.data.scenarios ?? {};
    const touched = [...new Set(Object.values<Record<string, Cell>>(scs).flatMap((c) => Object.keys(c)))];
    const original = Object.fromEntries(touched.map((c) => [c, (e.run({ type: 'GET_CELL', targetId: s.id, payload: { cell: c } }) as any)]));
    const out: Record<string, Record<string, Cell>> = { Atual: Object.fromEntries(results.map((c) => [c, cellValue(e, s.id, c)])) };
    for (const name of Object.keys(scs)) { e.run({ type: 'APPLY_SCENARIO', targetId: s.id, payload: { name } }); out[name] = Object.fromEntries(results.map((c) => [c, cellValue(e, s.id, c)])); }
    for (const [c, o] of Object.entries<any>(original)) e.run({ type: 'SET_CELL', targetId: s.id, payload: { cell: c, value: o.formula ?? o.value } });
    return out;
  },
  /** Tabela de dados (teste de hipóteses): DATA_TABLE { formulaCell, inputCell, values, inputCell2?, values2? } → resultados. */
  DATA_TABLE: (e, op) => {
    const s = sheetOf(e, op.targetId); const p = op.payload ?? {};
    const keep = (e.run({ type: 'GET_CELL', targetId: s.id, payload: { cell: p.inputCell } }) as any);
    const keep2 = p.inputCell2 ? (e.run({ type: 'GET_CELL', targetId: s.id, payload: { cell: p.inputCell2 } }) as any) : null;
    const result = (p.values as Cell[]).map((v) => {
      e.run({ type: 'SET_CELL', targetId: s.id, payload: { cell: p.inputCell, value: v } });
      if (!p.inputCell2) return [cellValue(e, s.id, p.formulaCell)];
      return (p.values2 as Cell[]).map((w) => { e.run({ type: 'SET_CELL', targetId: s.id, payload: { cell: p.inputCell2, value: w } }); return cellValue(e, s.id, p.formulaCell); });
    });
    e.run({ type: 'SET_CELL', targetId: s.id, payload: { cell: p.inputCell, value: keep.formula ?? keep.value } });
    if (keep2) e.run({ type: 'SET_CELL', targetId: s.id, payload: { cell: p.inputCell2, value: keep2.formula ?? keep2.value } });
    if (p.dest) write(e, s.id, p.dest, result);
    return result;
  },

  /** Estatística descritiva de um intervalo. */
  DESCRIPTIVE_STATS: (e, op) => {
    const s = sheetOf(e, op.targetId);
    const xs = read(e, s.id, op.payload?.range).flat().map(num).filter((x): x is number => x !== null).sort((a, b) => a - b);
    if (!xs.length) fail('VALIDATION', 'Nenhum número no intervalo.');
    const n = xs.length, sum = xs.reduce((a, b) => a + b, 0), mean = sum / n;
    const v = n > 1 ? xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1) : 0, sd = Math.sqrt(v);
    const counts = new Map<number, number>(); xs.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
    const [modeV, modeC] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const q = (k: number) => { const pos = (n - 1) * k, lo = Math.floor(pos); return xs[lo] + (xs[Math.min(lo + 1, n - 1)] - xs[lo]) * (pos - lo); };
    const skew = n > 2 && sd ? (n / ((n - 1) * (n - 2))) * xs.reduce((a, x) => a + ((x - mean) / sd) ** 3, 0) : null;
    const kurt = n > 3 && sd ? ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * xs.reduce((a, x) => a + ((x - mean) / sd) ** 4, 0) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3)) : null;
    return { count: n, sum, mean, median: q(0.5), mode: modeC > 1 ? modeV : null, stdev: sd, variance: v, min: xs[0], max: xs[n - 1], range: xs[n - 1] - xs[0], q1: q(0.25), q3: q(0.75), stderr: sd / Math.sqrt(n), skewness: skew, kurtosis: kurt };
  },
  /** Regressão linear simples: REGRESSION { y: "B2:B20", x: "A2:A20" } → inclinação, intercepto, R², erro e previsões. */
  REGRESSION: (e, op) => {
    const s = sheetOf(e, op.targetId);
    const ys = read(e, s.id, op.payload?.y).flat().map(num), xs = read(e, s.id, op.payload?.x).flat().map(num);
    const pts = ys.map((y, i) => [xs[i], y]).filter((p): p is [number, number] => p[0] !== null && p[1] !== null);
    if (pts.length < 3) fail('VALIDATION', 'São necessários pelo menos 3 pares de números.');
    const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0), sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0), syy = pts.reduce((a, p) => a + (p[1] - my) ** 2, 0);
    const slope = sxy / sxx, intercept = my - slope * mx;
    const sse = pts.reduce((a, [x, y]) => a + (y - (intercept + slope * x)) ** 2, 0);
    return { slope, intercept, r2: 1 - sse / syy, r: sxy / Math.sqrt(sxx * syy), standardError: Math.sqrt(sse / (n - 2)), n, predict: (op.payload?.predict as number[] | undefined)?.map((x) => intercept + slope * x) };
  },
  /** Previsão (planilha de previsão): FORECAST_SERIES { range, periods, method: LINEAR|EXPONENTIAL|MOVING_AVERAGE, alpha?, window? }. */
  FORECAST_SERIES: (e, op) => {
    const s = sheetOf(e, op.targetId); const p = op.payload ?? {};
    const ys = read(e, s.id, p.range).flat().map(num).filter((x): x is number => x !== null);
    const k = p.periods ?? 3, method = p.method ?? 'LINEAR';
    if (ys.length < 2) fail('VALIDATION', 'Pelo menos 2 valores para prever.');
    let out: number[];
    if (method === 'EXPONENTIAL') { const a = p.alpha ?? 0.3; let lvl = ys[0]; let trend = ys[1] - ys[0]; const b = p.beta ?? 0.1; for (const y of ys.slice(1)) { const prev = lvl; lvl = a * y + (1 - a) * (lvl + trend); trend = b * (lvl - prev) + (1 - b) * trend; } out = Array.from({ length: k }, (_, i) => lvl + trend * (i + 1)); }
    else if (method === 'MOVING_AVERAGE') { const w = p.window ?? 3; const hist = [...ys]; out = []; for (let i = 0; i < k; i++) { const v = hist.slice(-w).reduce((a, b) => a + b, 0) / Math.min(w, hist.length); out.push(v); hist.push(v); } }
    else { const n = ys.length, mx = (n + 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n; const sl = ys.reduce((a, y, i) => a + (i + 1 - mx) * (y - my), 0) / ys.reduce((a, _, i) => a + (i + 1 - mx) ** 2, 0); out = Array.from({ length: k }, (_, i) => my + sl * (n + i + 1 - mx)); }
    out = out.map((v) => Math.round(v * 1e6) / 1e6);
    if (p.dest) write(e, s.id, p.dest, out.map((v) => [v]));
    return out;
  },

  /** Rastrear precedentes: de quais células a fórmula depende. */
  TRACE_PRECEDENTS: (e, op) => {
    const s = sheetOf(e, op.targetId);
    const c = (e.run({ type: 'GET_CELL', targetId: s.id, payload: { cell: op.payload?.cell } }) as any);
    if (!c.formula) return [];
    return collectRefs(parse(c.formula)).map((r: any) => (r.k === 'ref' ? `${r.sheet ? `${r.sheet}!` : ''}${indexToCol(r.col)}${r.row}` : r.k === 'range' ? `${r.sheet ? `${r.sheet}!` : ''}${indexToCol(r.start.col)}${r.start.row}:${indexToCol(r.end.col)}${r.end.row}` : r.name));
  },
  /** Rastrear dependentes: quais fórmulas (nesta planilha) usam a célula. */
  TRACE_DEPENDENTS: (e, op) => {
    const s = sheetOf(e, op.targetId);
    const at = parseAddress(op.payload?.cell ?? fail('INVALID_PAYLOAD', 'Informe cell.'));
    const out: string[] = [];
    for (const [addr, cell] of Object.entries<any>(s.data.cells ?? {})) {
      if (!cell.formula) continue;
      const hit = collectRefs(parse(cell.formula)).some((r: any) => (r.sheet === null || r.sheet === s.data.name) && (r.k === 'ref' ? r.row === at.row && r.col === at.col : r.k === 'range' ? at.row >= Math.min(r.start.row, r.end.row) && at.row <= Math.max(r.start.row, r.end.row) && at.col >= Math.min(r.start.col, r.end.col) && at.col <= Math.max(r.start.col, r.end.col) : false));
      if (hit) out.push(addr);
    }
    return out.sort();
  },

  // ---------------------------------------------------------------- transformação de dados
  /** TRANSFORM_DATA { source: "A1:D50", steps: [{ op, … }], dest: "H1" } — devolve a tabela final e grava em dest. */
  TRANSFORM_DATA: (e, op) => {
    const s = sheetOf(e, op.targetId); const p = op.payload ?? {};
    let t: Cell[][] = p.rows ?? read(e, s.id, p.source ?? fail('INVALID_PAYLOAD', 'Informe source (ou rows).'));
    for (const step of (p.steps ?? []) as Record<string, any>[]) t = applyStep(t, step);
    if (p.dest) write(e, s.id, p.dest, t);
    if (p.save) { const tt = e.touchNode(s.id); tt.data.queries = { ...(tt.data.queries ?? {}), [p.save]: { source: p.source, steps: p.steps, dest: p.dest } }; }
    return t;
  },
  /** Atualizar consulta salva (TRANSFORM_DATA com save). */
  REFRESH_QUERY: (e, op) => {
    const s = sheetOf(e, op.targetId);
    const q = s.data.queries?.[op.payload?.name] ?? fail('NOT_FOUND', 'Consulta não encontrada.');
    return e.run({ type: 'TRANSFORM_DATA', targetId: s.id, payload: q });
  },
  /** Preenchimento relâmpago: FLASH_FILL { source: "A2:A10", target: "B2:B10" } — aprende com os exemplos já digitados em target. */
  FLASH_FILL: (e, op) => {
    const s = sheetOf(e, op.targetId); const p = op.payload ?? {};
    const src = read(e, s.id, p.source).map((r) => String(r[0] ?? '')), dst = read(e, s.id, p.target).map((r) => r[0]);
    const examples = src.map((v, i) => [v, dst[i]] as const).filter(([, d]) => d !== null && d !== '');
    if (!examples.length) fail('VALIDATION', 'Digite pelo menos um exemplo na coluna de destino.');
    const rule = FLASH.find((f) => examples.every(([a, b]) => f.fn(a) === String(b)));
    if (!rule) fail('NOT_FOUND', 'Não reconheci o padrão dos exemplos.');
    const r = parseRange(p.target);
    const filled = src.map((v, i) => [dst[i] !== null && dst[i] !== '' ? dst[i] : v ? rule!.fn(v) : null]);
    write(e, s.id, toAddress({ row: r.r1, col: r.c1 }), filled);
    return { rule: rule!.name, filled: filled.filter((_, i) => dst[i] === null || dst[i] === '').length };
  },
};

function toggleGroup(e: Engine, sheetId: string | null | undefined, groupId: string, collapse: boolean) {
  const t = e.touchNode(sheetOf(e, sheetId).id);
  for (const key of ['rowGroups', 'colGroups'] as const) {
    const g = (t.data[key] ?? []).find((x: any) => x.id === groupId);
    if (!g) continue;
    g.collapsed = collapse;
    const hk = key === 'rowGroups' ? 'hiddenRows' : 'hiddenColumns';
    const lines = Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from + i);
    const set = new Set<number>(t.data[hk] ?? []);
    for (const l of lines) collapse ? set.add(l) : set.delete(l);
    t.data[hk] = [...set].sort((a, b) => a - b);
    return { collapsed: collapse, lines: lines.length };
  }
  return fail('NOT_FOUND', 'Grupo não encontrado.');
}
