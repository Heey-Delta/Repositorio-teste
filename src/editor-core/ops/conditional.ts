// Formatação condicional e regras visuais (F08.14–15): a aparência da célula depende do valor.
// As regras ficam na planilha/tabela (data.conditionalFormats); o resultado é CALCULADO (CONDITIONAL_STYLES),
// nunca gravado nas células — mudar um valor muda a cor na hora.
//
// Tipos de regra:
//   CELL_VALUE { operator: GT|GTE|LT|LTE|EQ|NEQ|BETWEEN|NOT_BETWEEN, value, value2? }
//   TEXT { operator: CONTAINS|NOT_CONTAINS|BEGINS|ENDS, value } · BLANK · NOT_BLANK · ERRORS
//   DUPLICATES · UNIQUE · TOP { count, percent? } · BOTTOM { count, percent? } · ABOVE_AVERAGE · BELOW_AVERAGE
//   FORMULA { formula } (planilha: verdadeiro aplica; referências relativas a partir do canto do intervalo)
//   COLOR_SCALE { min: { color, type?, value? }, mid?, max } · DATA_BAR { color } · ICON_SET { icons: ARROWS|TRAFFIC|STARS }
import type { EditorNode } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import type { Scalar } from '../formula/functions.ts';
import { isErr } from '../formula/functions.ts';
import { evaluate } from '../formula/evaluate.ts';
import { formulas, isSheet } from '../formula/service.ts';
import { parseRange, toAddress } from '../formula/parse.ts';
import { readCell } from './table.ts';
import { isColor, validateProps } from './format.ts';
import { clone, fail, merge } from '../util.ts';

export interface ConditionalRule {
  id: string;
  range: string;
  rule: { type: string; [k: string]: any };
  style?: Record<string, unknown>;
  stopIfTrue?: boolean;
}

const VALUE_TYPES = ['CELL_VALUE', 'TEXT', 'BLANK', 'NOT_BLANK', 'ERRORS', 'DUPLICATES', 'UNIQUE', 'TOP', 'BOTTOM', 'ABOVE_AVERAGE', 'BELOW_AVERAGE', 'FORMULA'];
const VISUAL_TYPES = ['COLOR_SCALE', 'DATA_BAR', 'ICON_SET'];
const ICONS: Record<string, string[]> = { ARROWS: ['↓', '→', '↑'], TRAFFIC: ['🔴', '🟡', '🟢'], STARS: ['☆', '★½', '★'] };

function validateRule(e: Engine, n: EditorNode, r: Record<string, any>, style: Record<string, unknown> | undefined) {
  if (!r?.type || ![...VALUE_TYPES, ...VISUAL_TYPES].includes(r.type)) fail('VALIDATION', `Regra: ${[...VALUE_TYPES, ...VISUAL_TYPES].join(', ')}.`);
  if (VALUE_TYPES.includes(r.type)) {
    if (!style || !Object.keys(style).length) fail('VALIDATION', 'Informe o estilo aplicado quando a regra for verdadeira (style).');
    validateProps('TABLE', style!);
  }
  if (r.type === 'CELL_VALUE') {
    if (!['GT', 'GTE', 'LT', 'LTE', 'EQ', 'NEQ', 'BETWEEN', 'NOT_BETWEEN'].includes(r.operator)) fail('VALIDATION', 'Operador: GT, GTE, LT, LTE, EQ, NEQ, BETWEEN ou NOT_BETWEEN.');
    if (r.value === undefined || (r.operator.includes('BETWEEN') && r.value2 === undefined)) fail('VALIDATION', 'Informe value (e value2 em BETWEEN).');
  }
  if (r.type === 'TEXT' && (!['CONTAINS', 'NOT_CONTAINS', 'BEGINS', 'ENDS'].includes(r.operator) || typeof r.value !== 'string')) fail('VALIDATION', 'Texto: operator CONTAINS, NOT_CONTAINS, BEGINS ou ENDS e value.');
  if ((r.type === 'TOP' || r.type === 'BOTTOM') && !(Number(r.count) >= 1)) fail('VALIDATION', 'Informe count (quantidade ou porcentagem).');
  if (r.type === 'FORMULA') {
    if (!isSheet(n)) fail('INVALID_OPERATION', 'Regra por fórmula vale para planilhas.');
    const a = formulas(e).parseCached(String(r.formula ?? ''));
    if (a instanceof Error) fail('VALIDATION', `Fórmula inválida: ${a.message}`);
  }
  if (r.type === 'COLOR_SCALE') {
    for (const k of ['min', 'max']) if (!isColor(r[k]?.color)) fail('VALIDATION', `Escala de cores: ${k}.color.`);
    if (r.mid && !isColor(r.mid.color)) fail('VALIDATION', 'Escala de cores: mid.color.');
  }
  if (r.type === 'DATA_BAR' && !isColor(r.color)) fail('VALIDATION', 'Barra de dados: color.');
  if (r.type === 'ICON_SET' && !ICONS[r.icons ?? 'ARROWS']) fail('VALIDATION', `Ícones: ${Object.keys(ICONS).join(', ')}.`);
}

const hex = (c: string) => { const h = c.replace('#', ''); const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6); return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();

export interface CellLook { style: Record<string, unknown>; dataBar?: { ratio: number; color: string }; icon?: string; rules: string[] }

/** Aparência condicional de cada célula do intervalo pedido (ou de todos os intervalos com regras). */
export function conditionalStyles(e: Engine, n: EditorNode, only?: string): Record<string, CellLook> {
  const out: Record<string, CellLook> = {};
  const rules: ConditionalRule[] = n.data.conditionalFormats ?? [];
  const limit = only ? parseRange(only) : null;
  const stopped = new Set<string>();
  for (const cf of rules) {
    const r = parseRange(cf.range);
    const cells: { addr: string; row: number; col: number; v: Scalar }[] = [];
    for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) cells.push({ addr: toAddress({ row, col }), row, col, v: readCell(e, n, row, col).display as Scalar });
    const nums = cells.map((c) => c.v).filter((v): v is number => typeof v === 'number');
    const sorted = [...nums].sort((a, b) => a - b);
    const avg = nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : 0;
    const counts = new Map<string, number>();
    for (const c of cells) if (c.v !== null && c.v !== '') { const k = String(c.v).toLowerCase(); counts.set(k, (counts.get(k) ?? 0) + 1); }
    const R = cf.rule;
    const k = R.type === 'TOP' || R.type === 'BOTTOM' ? Math.max(1, R.percent ? Math.ceil((sorted.length * Number(R.count)) / 100) : Number(R.count)) : 0;
    const topCut = sorted[sorted.length - k], bottomCut = sorted[k - 1];
    const stat = (p: any, fallback: number) => {
      if (!p || !p.type || p.type === 'MIN') return p?.type === 'NUMBER' ? Number(p.value) : fallback;
      if (p.type === 'MAX') return sorted.at(-1) ?? 0;
      if (p.type === 'NUMBER') return Number(p.value);
      if (p.type === 'PERCENTILE') return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * Number(p.value) / 100)))] ?? 0;
      return fallback;
    };
    const lo = stat(R.min, sorted[0] ?? 0), hi = R.max?.type ? stat(R.max, sorted.at(-1) ?? 0) : sorted.at(-1) ?? 0;
    const mid = R.mid ? stat(R.mid, (lo + hi) / 2) : null;
    const fs = R.type === 'FORMULA' ? formulas(e) : null;
    for (const c of cells) {
      if (limit && (c.row < limit.r1 || c.row > limit.r2 || c.col < limit.c1 || c.col > limit.c2)) continue;
      if (stopped.has(c.addr)) continue;
      const v = c.v;
      const isNum = typeof v === 'number';
      let hit = false;
      switch (R.type) {
        case 'CELL_VALUE': {
          const a = R.value, b = R.value2;
          const cmp = (x: unknown) => (isNum && typeof x === 'number' ? (v as number) - x : String(v ?? '').localeCompare(String(x), 'pt-BR', { sensitivity: 'base' }));
          if (v === null || v === '') break;
          hit = { GT: cmp(a) > 0, GTE: cmp(a) >= 0, LT: cmp(a) < 0, LTE: cmp(a) <= 0, EQ: cmp(a) === 0, NEQ: cmp(a) !== 0, BETWEEN: cmp(Math.min(a, b)) >= 0 && cmp(Math.max(a, b)) <= 0, NOT_BETWEEN: !(cmp(Math.min(a, b)) >= 0 && cmp(Math.max(a, b)) <= 0) }[R.operator as string] ?? false;
          break;
        }
        case 'TEXT': {
          const t = String(v ?? '').toLowerCase(), q = String(R.value).toLowerCase();
          hit = { CONTAINS: t.includes(q), NOT_CONTAINS: !t.includes(q), BEGINS: t.startsWith(q), ENDS: t.endsWith(q) }[R.operator as string] ?? false;
          break;
        }
        case 'BLANK': hit = v === null || v === ''; break;
        case 'NOT_BLANK': hit = !(v === null || v === ''); break;
        case 'ERRORS': hit = typeof v === 'string' && /^#[A-Z/0!?]+$/.test(v); break;
        case 'DUPLICATES': hit = v !== null && v !== '' && (counts.get(String(v).toLowerCase()) ?? 0) > 1; break;
        case 'UNIQUE': hit = v !== null && v !== '' && counts.get(String(v).toLowerCase()) === 1; break;
        case 'TOP': hit = isNum && sorted.length > 0 && (v as number) >= topCut; break;
        case 'BOTTOM': hit = isNum && sorted.length > 0 && (v as number) <= bottomCut; break;
        case 'ABOVE_AVERAGE': hit = isNum && (v as number) > avg; break;
        case 'BELOW_AVERAGE': hit = isNum && (v as number) < avg; break;
        case 'FORMULA': {
          const shifted = fs!.shift(String(R.formula), c.row - r.r1, c.col - r.c1);
          const a = fs!.parseCached(shifted);
          if (!(a instanceof Error)) { const res = evaluate(a, fs!.context(n.id)); hit = !isErr(res) && (res === true || (typeof res === 'number' && res !== 0)); }
          break;
        }
        case 'COLOR_SCALE': {
          if (!isNum) break;
          const t01 = (x: number) => Math.max(0, Math.min(1, x));   // valores fora dos limites ficam na cor da ponta
          let color: string;
          if (mid !== null && R.mid) color = (v as number) <= mid ? mix(R.min.color, R.mid.color, mid === lo ? 1 : t01(((v as number) - lo) / (mid - lo))) : mix(R.mid.color, R.max.color, hi === mid ? 1 : t01(((v as number) - mid) / (hi - mid)));
          else color = mix(R.min.color, R.max.color, hi === lo ? 1 : t01(((v as number) - lo) / (hi - lo)));
          (out[c.addr] ??= { style: {}, rules: [] }).style.fill = color;
          out[c.addr].rules.push(cf.id);
          continue;
        }
        case 'DATA_BAR': {
          if (!isNum) break;
          const max = Math.max(...sorted.map(Math.abs), 1e-12);
          (out[c.addr] ??= { style: {}, rules: [] }).dataBar = { ratio: Math.max(0, Math.min(1, (v as number) / max)), color: R.color };
          out[c.addr].rules.push(cf.id);
          continue;
        }
        case 'ICON_SET': {
          if (!isNum) break;
          const set = ICONS[R.icons ?? 'ARROWS'];
          const [t1, t2] = R.thresholds ?? [33, 67];
          const pct = hi === lo ? 100 : (((v as number) - lo) / (hi - lo)) * 100;
          (out[c.addr] ??= { style: {}, rules: [] }).icon = set[pct >= t2 ? 2 : pct >= t1 ? 1 : 0];
          out[c.addr].rules.push(cf.id);
          continue;
        }
      }
      if (hit) {
        const look = (out[c.addr] ??= { style: {}, rules: [] });
        look.style = merge(cf.style ?? {}, look.style);   // a primeira regra (maior prioridade) vence nos conflitos
        look.rules.push(cf.id);
        if (cf.stopIfTrue) stopped.add(c.addr);
      }
    }
  }
  return out;
}

function host(e: Engine, id: string | null | undefined, editable = true) {
  const n = e.get(id);
  if (n.type !== 'TABLE' && !isSheet(n)) fail('INVALID_OPERATION', `${n.id} não é uma tabela nem uma planilha.`);
  if (!editable) return n;
  e.assertEditable(n.id);
  return e.touchNode(n.id);
}

export const conditionalHandlers: Record<string, Handler> = {
  /** ADD_CONDITIONAL_FORMAT { range, rule, style?, stopIfTrue?, priority? } (prioridade 0 = primeira). */
  ADD_CONDITIONAL_FORMAT: (e, op) => {
    const n = host(e, op.targetId);
    const p = op.payload ?? {};
    try { parseRange(String(p.range)); } catch { fail('VALIDATION', `Intervalo inválido: ${p.range}.`); }
    validateRule(e, n, p.rule, p.style);
    const cf: ConditionalRule = { id: e.newId('CFMT'), range: String(p.range).toUpperCase(), rule: clone(p.rule), ...(p.style ? { style: clone(p.style) } : {}), ...(p.stopIfTrue ? { stopIfTrue: true } : {}) };
    const list: ConditionalRule[] = (n.data.conditionalFormats ??= []);
    list.splice(p.priority === undefined ? list.length : Math.max(0, Math.min(list.length, p.priority)), 0, cf);
    return cf.id;
  },
  UPDATE_CONDITIONAL_FORMAT: (e, op) => {
    const n = host(e, op.targetId);
    const list: ConditionalRule[] = n.data.conditionalFormats ?? [];
    const i = list.findIndex((x) => x.id === op.payload?.ruleId);
    if (i < 0) fail('NOT_FOUND', `Regra ${op.payload?.ruleId} não existe.`);
    const next = { ...list[i], ...clone(op.payload ?? {}) };
    delete (next as any).ruleId; delete (next as any).priority;
    validateRule(e, n, next.rule, next.style);
    list.splice(i, 1);
    list.splice(op.payload?.priority ?? i, 0, next as ConditionalRule);
    return next.id;
  },
  REMOVE_CONDITIONAL_FORMAT: (e, op) => {
    const n = host(e, op.targetId);
    const before = (n.data.conditionalFormats ?? []).length;
    n.data.conditionalFormats = (n.data.conditionalFormats ?? []).filter((x: ConditionalRule) => (op.payload?.ruleId ? x.id !== op.payload.ruleId : op.payload?.range ? x.range !== String(op.payload.range).toUpperCase() : false));
    return before - n.data.conditionalFormats.length;
  },
  LIST_CONDITIONAL_FORMATS: (e, op) => clone(host(e, op.targetId, false).data.conditionalFormats ?? []),
  /** Aparência condicional calculada: { 'B2': { style: { fill }, dataBar?, icon?, rules } } */
  CONDITIONAL_STYLES: (e, op) => conditionalStyles(e, host(e, op.targetId, false), op.payload?.range),
};
