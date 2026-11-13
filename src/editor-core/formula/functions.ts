// Valores, erros padronizados e o registro de funções (nomes em português e inglês, uma implementação só).
// Para acrescentar uma função: registry.register({ name, aliases, category, min, max, fn }) — sem mexer no interpretador.
// (As demais funções ficam em functions-extra.ts.)
// Datas seguem o padrão das planilhas: número de dias desde 30/12/1899 (a parte decimal é a hora).

import { registerExtraFunctions } from './functions-extra.ts';
export type ErrorCode = '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#N/A' | '#NUM!' | '#NULL!' | '#CYCLE!' | '#ERROR!';
export interface FErr { error: ErrorCode }
export interface Matrix { matrix: Value[][] }
export type Scalar = number | string | boolean | null | FErr;
export type Value = Scalar | Matrix;

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  '#DIV/0!': 'Divisão por zero.',
  '#VALUE!': 'Tipo de dado incompatível com a operação.',
  '#REF!': 'Referência inválida (célula ou planilha que não existe mais).',
  '#NAME?': 'Função ou nome desconhecido.',
  '#N/A': 'Valor não encontrado.',
  '#NUM!': 'Problema numérico (resultado impossível ou grande demais).',
  '#NULL!': 'Intervalos sem interseção.',
  '#CYCLE!': 'Dependência circular: a fórmula depende do próprio resultado.',
  '#ERROR!': 'Erro de cálculo.',
};

export const err = (code: ErrorCode): FErr => ({ error: code });
export const isErr = (v: unknown): v is FErr => typeof v === 'object' && v !== null && 'error' in v;
export const isMatrix = (v: unknown): v is Matrix => typeof v === 'object' && v !== null && 'matrix' in v;

/** Erro interno que interrompe o cálculo e vira um valor de erro na célula. */
export class FormulaFault extends Error { code: ErrorCode; constructor(code: ErrorCode) { super(code); this.code = code; } }
export const raise = (code: ErrorCode): never => { throw new FormulaFault(code); };

export function scalar(v: Value): Scalar {
  if (!isMatrix(v)) return v;
  return (v.matrix[0]?.[0] ?? null) as Scalar;   // intervalo usado onde se espera um valor: primeiro valor
}

export function toNumber(v: Value): number {
  const s = scalar(v);
  if (isErr(s)) return raise(s.error);
  if (s === null || s === '') return 0;
  if (typeof s === 'number') return s;
  if (typeof s === 'boolean') return s ? 1 : 0;
  const t = String(s).trim().replace(/\s/g, '');
  const n = Number(/^-?\d{1,3}(\.\d{3})*,\d+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(',', '.'));
  if (t === '' || Number.isNaN(n)) raise('#VALUE!');
  return n;
}
export function toText(v: Value): string {
  const s = scalar(v);
  if (isErr(s)) return raise(s.error);
  if (s === null) return '';
  if (typeof s === 'boolean') return s ? 'VERDADEIRO' : 'FALSO';
  if (typeof s === 'number') return String(Math.round(s * 1e10) / 1e10);
  return s;
}
export function toBool(v: Value): boolean {
  const s = scalar(v);
  if (isErr(s)) return raise(s.error);
  if (typeof s === 'boolean') return s;
  if (typeof s === 'number') return s !== 0;
  if (s === null || s === '') return false;
  const u = String(s).toUpperCase();
  if (u === 'VERDADEIRO' || u === 'TRUE') return true;
  if (u === 'FALSO' || u === 'FALSE') return false;
  return raise('#VALUE!');
}

/** Todos os valores (intervalos achatados). */
export const flat = (args: Value[]): Scalar[] => args.flatMap((a) => (isMatrix(a) ? a.matrix.flat() as Scalar[] : [a]));

/** Números para funções de agregação: nos intervalos ignora texto e vazios; argumento direto converte. */
export function numbers(args: Value[]): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (isMatrix(a)) { for (const v of a.matrix.flat()) { if (isErr(v)) raise(v.error); if (typeof v === 'number') out.push(v); } }
    else if (a !== null && a !== '') out.push(toNumber(a));
  }
  return out;
}

// ---------------------------------------------------------------- datas

const EPOCH = Date.UTC(1899, 11, 30);
export const dateToSerial = (d: Date) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - EPOCH) / 86_400_000;
export const serialToDate = (n: number) => new Date(EPOCH + Math.round(n * 86_400_000));

// ---------------------------------------------------------------- registro

export interface FunctionContext { now: () => Date }
export interface FunctionDef {
  name: string;
  aliases?: string[];
  category: 'MATHEMATICAL' | 'STATISTICAL' | 'LOGICAL' | 'TEXT' | 'DATE' | 'FINANCIAL' | 'LOOKUP' | 'CUSTOM';
  min: number;
  max: number | null;
  description?: string;
  fn: (args: Value[], ctx: FunctionContext) => Value;
  /** Funções que só avaliam o argumento necessário (SES, PARÂMETRO, ESCOLHER): recebem cada argumento como função. */
  lazyFn?: (args: (() => Value)[], ctx: FunctionContext) => Value;
}

export const normalizeName = (n: string) => n.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export class FunctionRegistry {
  private map = new Map<string, FunctionDef>();
  register(def: FunctionDef) {
    for (const n of [def.name, ...(def.aliases ?? [])]) this.map.set(normalizeName(n), def);
    return this;
  }
  get(name: string) { return this.map.get(normalizeName(name)); }
  unregister(name: string) { const d = this.get(name); if (!d) return false; for (const n of [d.name, ...(d.aliases ?? [])]) this.map.delete(normalizeName(n)); return true; }
  list() { return [...new Set(this.map.values())].map((d) => ({ name: d.name, aliases: d.aliases ?? [], category: d.category, description: d.description ?? '' })); }
}

export const round = (n: number, d: number, mode: 'ROUND' | 'UP' | 'DOWN') => {
  const k = 10 ** d, x = n * k;
  const r = mode === 'ROUND' ? Math.sign(x) * Math.round(Math.abs(x) + 1e-9) : mode === 'UP' ? Math.sign(x) * Math.ceil(Math.abs(x) - 1e-9) : Math.sign(x) * Math.floor(Math.abs(x) + 1e-9);
  return r / k;
};

/** Critério de SOMASE / CONT.SE: ">10", "<>0", "texto", "a*" (curingas). */
export function criterion(c: Value): (v: Scalar) => boolean {
  const s = scalar(c);
  if (typeof s === 'number' || typeof s === 'boolean') return (v) => v === s;
  const m = /^(<>|>=|<=|=|>|<)?(.*)$/.exec(String(s ?? ''))!;
  const op = m[1] ?? '=', rhs = m[2];
  const num = rhs.trim() !== '' && !Number.isNaN(Number(rhs)) ? Number(rhs) : null;
  const re = new RegExp(`^${rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return (v) => {
    if (num !== null && typeof v === 'number') {
      return { '=': v === num, '<>': v !== num, '>': v > num, '<': v < num, '>=': v >= num, '<=': v <= num }[op]!;
    }
    const t = v === null ? '' : String(v);
    if (op === '=') return re.test(t);
    if (op === '<>') return !re.test(t);
    return false;
  };
}

export const matrixOf = (v: Value): Value[][] => (isMatrix(v) ? v.matrix : [[v]]);
export const looseEq = (a: Scalar, b: Scalar) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);
export const lessEq = (a: Scalar, b: Scalar) => (typeof a === 'number' && typeof b === 'number' ? a <= b : String(a ?? '').toLowerCase() <= String(b ?? '').toLowerCase());

/** Posição (1, 2, …) no vetor; tipo 0 = exato, 1 = maior valor ≤ procurado (lista crescente), -1 = menor ≥ (decrescente). */
export function matchIn(v: Scalar, list: Scalar[], type: number) {
  if (type === 0) { const i = list.findIndex((x) => looseEq(x, v) || (typeof v === 'string' && criterion(v)(x))); return i < 0 ? raise('#N/A') : i + 1; }
  let found = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === null) continue;
    if (type > 0 ? lessEq(list[i], v) : lessEq(v, list[i])) found = i; else break;
  }
  return found < 0 ? raise('#N/A') : found + 1;
}

export function pv(rate: number, nper: number, pmt: number, fv: number, type: number) {
  if (rate === 0) return -(fv + pmt * nper);
  const f = (1 + rate) ** nper;
  return -(fv + pmt * (1 + rate * type) * (f - 1) / rate) / f;
}
export function fv(rate: number, nper: number, pmt: number, pvv: number, type: number) {
  if (rate === 0) return -(pvv + pmt * nper);
  const f = (1 + rate) ** nper;
  return -(pvv * f + pmt * (1 + rate * type) * (f - 1) / rate);
}
export function pmt(rate: number, nper: number, pvv: number, fvv: number, type: number) {
  if (nper === 0) raise('#NUM!');
  if (rate === 0) return -(pvv + fvv) / nper;
  const f = (1 + rate) ** nper;
  return -(rate * (pvv * f + fvv)) / ((1 + rate * type) * (f - 1));
}

export const n = (a: Value[], i: number, d?: number) => (a[i] === undefined || a[i] === '' ? (d ?? raise('#VALUE!')) : toNumber(a[i]));
export const t = (a: Value[], i: number, d = '') => (a[i] === undefined ? d : toText(a[i]));
export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : raise('#DIV/0!'));

export function createRegistry(): FunctionRegistry {
  const r = new FunctionRegistry();
  const add = (name: string, aliases: string[], category: FunctionDef['category'], min: number, max: number | null, fn: FunctionDef['fn'], description = '') =>
    r.register({ name, aliases, category, min, max, fn, description });

  // matemáticas
  add('SOMA', ['SUM'], 'MATHEMATICAL', 1, null, (a) => numbers(a).reduce((s, x) => s + x, 0), 'Soma os valores.');
  add('PRODUTO', ['PRODUCT'], 'MATHEMATICAL', 1, null, (a) => numbers(a).reduce((s, x) => s * x, 1));
  add('ABS', [], 'MATHEMATICAL', 1, 1, (a) => Math.abs(n(a, 0)));
  add('ARRED', ['ROUND'], 'MATHEMATICAL', 1, 2, (a) => round(n(a, 0), n(a, 1, 0), 'ROUND'));
  add('ARREDONDAR.PARA.CIMA', ['ROUNDUP'], 'MATHEMATICAL', 1, 2, (a) => round(n(a, 0), n(a, 1, 0), 'UP'));
  add('ARREDONDAR.PARA.BAIXO', ['ROUNDDOWN'], 'MATHEMATICAL', 1, 2, (a) => round(n(a, 0), n(a, 1, 0), 'DOWN'));
  add('INT', [], 'MATHEMATICAL', 1, 1, (a) => Math.floor(n(a, 0)));
  add('MOD', [], 'MATHEMATICAL', 2, 2, (a) => { const d = n(a, 1); if (d === 0) raise('#DIV/0!'); const x = n(a, 0); return x - d * Math.floor(x / d); });
  add('RAIZ', ['SQRT'], 'MATHEMATICAL', 1, 1, (a) => { const x = n(a, 0); return x < 0 ? raise('#NUM!') : Math.sqrt(x); });
  add('POTÊNCIA', ['POWER'], 'MATHEMATICAL', 2, 2, (a) => n(a, 0) ** n(a, 1));
  add('PI', [], 'MATHEMATICAL', 0, 0, () => Math.PI);
  add('SOMASE', ['SUMIF'], 'MATHEMATICAL', 2, 3, (a) => {
    const range = matrixOf(a[0]).flat() as Scalar[], test = criterion(a[1]), sum = a[2] ? matrixOf(a[2]).flat() as Scalar[] : range;
    return range.reduce<number>((s, v, i) => (test(v) && typeof sum[i] === 'number' ? s + (sum[i] as number) : s), 0);
  });

  // estatísticas
  add('MÉDIA', ['AVERAGE'], 'STATISTICAL', 1, null, (a) => mean(numbers(a)), 'Média dos valores.');
  add('MED', ['MEDIAN'], 'STATISTICAL', 1, null, (a) => { const xs = numbers(a).sort((p, q) => p - q); if (!xs.length) raise('#NUM!'); const m = xs.length >> 1; return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2; });
  add('MÍNIMO', ['MIN'], 'STATISTICAL', 1, null, (a) => { const xs = numbers(a); return xs.length ? Math.min(...xs) : 0; });
  add('MÁXIMO', ['MAX'], 'STATISTICAL', 1, null, (a) => { const xs = numbers(a); return xs.length ? Math.max(...xs) : 0; });
  add('CONT.NÚM', ['COUNT'], 'STATISTICAL', 1, null, (a) => flat(a).filter((v) => typeof v === 'number').length);
  add('CONT.VALORES', ['COUNTA'], 'STATISTICAL', 1, null, (a) => flat(a).filter((v) => v !== null && v !== '').length);
  add('CONTAR.VAZIO', ['COUNTBLANK'], 'STATISTICAL', 1, 1, (a) => flat(a).filter((v) => v === null || v === '').length);
  add('CONT.SE', ['COUNTIF'], 'STATISTICAL', 2, 2, (a) => { const test = criterion(a[1]); return (matrixOf(a[0]).flat() as Scalar[]).filter(test).length; });
  add('DESVPAD', ['STDEV', 'DESVPAD.A', 'STDEV.S'], 'STATISTICAL', 1, null, (a) => { const xs = numbers(a); if (xs.length < 2) raise('#DIV/0!'); const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); });

  // lógicas (SE e SEERRO são avaliadas de forma preguiçosa pelo avaliador, mas ficam registradas)
  add('SE', ['IF'], 'LOGICAL', 1, 3, (a) => (toBool(a[0]) ? (a[1] ?? true) : (a[2] ?? false)) as Value);
  add('SEERRO', ['IFERROR'], 'LOGICAL', 2, 2, (a) => (isErr(scalar(a[0])) ? a[1] : a[0]));
  add('SENÃODISP', ['IFNA'], 'LOGICAL', 2, 2, (a) => (isErr(scalar(a[0])) && (scalar(a[0]) as FErr).error === '#N/A' ? a[1] : a[0]));
  add('E', ['AND'], 'LOGICAL', 1, null, (a) => flat(a).filter((v) => v !== null).every((v) => toBool(v)));
  add('OU', ['OR'], 'LOGICAL', 1, null, (a) => flat(a).filter((v) => v !== null).some((v) => toBool(v)));
  add('NÃO', ['NOT'], 'LOGICAL', 1, 1, (a) => !toBool(a[0]));
  add('ÉERRO', ['ISERROR', 'ÉERROS', 'ISERR'], 'LOGICAL', 1, 1, (a) => isErr(scalar(a[0])));
  add('ÉCÉL.VAZIA', ['ISBLANK'], 'LOGICAL', 1, 1, (a) => scalar(a[0]) === null);
  add('ÉNÚM', ['ISNUMBER'], 'LOGICAL', 1, 1, (a) => typeof scalar(a[0]) === 'number');

  // texto
  add('CONCATENAR', ['CONCAT', 'CONCATENATE'], 'TEXT', 1, null, (a) => flat(a).map((v) => toText(v)).join(''));
  add('ESQUERDA', ['LEFT'], 'TEXT', 1, 2, (a) => t(a, 0).slice(0, n(a, 1, 1)));
  add('DIREITA', ['RIGHT'], 'TEXT', 1, 2, (a) => { const k = n(a, 1, 1); return k <= 0 ? '' : t(a, 0).slice(-k); });
  add('EXT.TEXTO', ['MID'], 'TEXT', 3, 3, (a) => { const s = n(a, 1); if (s < 1) raise('#VALUE!'); return t(a, 0).substr(s - 1, n(a, 2)); });
  add('NÚM.CARACT', ['LEN'], 'TEXT', 1, 1, (a) => t(a, 0).length);
  add('MAIÚSCULA', ['UPPER'], 'TEXT', 1, 1, (a) => t(a, 0).toLocaleUpperCase('pt-BR'));
  add('MINÚSCULA', ['LOWER'], 'TEXT', 1, 1, (a) => t(a, 0).toLocaleLowerCase('pt-BR'));
  add('PRI.MAIÚSCULA', ['PROPER'], 'TEXT', 1, 1, (a) => t(a, 0).toLocaleLowerCase('pt-BR').replace(/(^|[^\p{L}])(\p{L})/gu, (_, p, c) => p + c.toLocaleUpperCase('pt-BR')));
  add('ARRUMAR', ['TRIM'], 'TEXT', 1, 1, (a) => t(a, 0).trim().replace(/\s+/g, ' '));
  add('SUBSTITUIR', ['SUBSTITUTE'], 'TEXT', 3, 4, (a) => {
    const s = t(a, 0), from = t(a, 1), to = t(a, 2);
    if (!from) return s;
    if (a[3] === undefined) return s.split(from).join(to);
    const k = n(a, 3); let i = -1;
    for (let c = 0; c < k; c++) { i = s.indexOf(from, i + 1); if (i < 0) return s; }
    return s.slice(0, i) + to + s.slice(i + from.length);
  });
  add('VALOR', ['VALUE'], 'TEXT', 1, 1, (a) => toNumber(a[0]));
  add('TEXTO', ['TEXT'], 'TEXT', 2, 2, (a) => {
    const x = n(a, 0), fmt = t(a, 1);
    const dec = (/[.,](0+)/.exec(fmt)?.[1] ?? '').length;
    const pct = fmt.includes('%');
    const v = pct ? x * 100 : x;
    const s = v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: /#[.,]##/.test(fmt) });
    return (fmt.includes('R$') ? 'R$ ' : '') + s + (pct ? '%' : '');
  });

  // datas
  add('HOJE', ['TODAY'], 'DATE', 0, 0, (_, c) => Math.floor(dateToSerial(c.now())));
  add('AGORA', ['NOW'], 'DATE', 0, 0, (_, c) => dateToSerial(c.now()));
  add('DATA', ['DATE'], 'DATE', 3, 3, (a) => dateToSerial(new Date(n(a, 0), n(a, 1) - 1, n(a, 2))));
  add('DIA', ['DAY'], 'DATE', 1, 1, (a) => serialToDate(n(a, 0)).getUTCDate());
  add('MÊS', ['MONTH'], 'DATE', 1, 1, (a) => serialToDate(n(a, 0)).getUTCMonth() + 1);
  add('ANO', ['YEAR'], 'DATE', 1, 1, (a) => serialToDate(n(a, 0)).getUTCFullYear());
  add('DIA.DA.SEMANA', ['WEEKDAY'], 'DATE', 1, 2, (a) => serialToDate(n(a, 0)).getUTCDay() + 1);
  add('DIAS', ['DAYS'], 'DATE', 2, 2, (a) => Math.floor(n(a, 0)) - Math.floor(n(a, 1)));

  // financeiras (mesmas convenções das planilhas: pagamentos negativos = saídas)
  add('VP', ['PV'], 'FINANCIAL', 3, 5, (a) => pv(n(a, 0), n(a, 1), n(a, 2), n(a, 3, 0), n(a, 4, 0)), 'Valor presente.');
  add('VF', ['FV'], 'FINANCIAL', 3, 5, (a) => fv(n(a, 0), n(a, 1), n(a, 2), n(a, 3, 0), n(a, 4, 0)), 'Valor futuro.');
  add('PGTO', ['PMT'], 'FINANCIAL', 3, 5, (a) => pmt(n(a, 0), n(a, 1), n(a, 2), n(a, 3, 0), n(a, 4, 0)), 'Valor da parcela.');
  add('NPER', [], 'FINANCIAL', 3, 5, (a) => {
    const rate = n(a, 0), p = n(a, 1), pvv = n(a, 2), fvv = n(a, 3, 0), type = n(a, 4, 0);
    if (rate === 0) return p === 0 ? raise('#NUM!') : -(pvv + fvv) / p;
    const num = p * (1 + rate * type) - fvv * rate, den = pvv * rate + p * (1 + rate * type);
    if (num / den <= 0) raise('#NUM!');
    return Math.log(num / den) / Math.log(1 + rate);
  });
  add('TAXA', ['RATE'], 'FINANCIAL', 3, 6, (a) => {
    const nper = n(a, 0), p = n(a, 1), pvv = n(a, 2), fvv = n(a, 3, 0), type = n(a, 4, 0);
    // Newton: acha a taxa em que pv·(1+r)^n + pgto·(1+r·tipo)·((1+r)^n − 1)/r + vf = 0
    const g = (r: number) => fvv - fv(r, nper, p, pvv, type);
    let r = n(a, 5, 0.1);
    for (let i = 0; i < 100; i++) {
      const d = (g(r + 1e-7) - g(r)) / 1e-7;
      if (!Number.isFinite(d) || d === 0) break;
      const next = r - g(r) / d;
      if (Math.abs(next - r) < 1e-12) return next;
      r = next;
    }
    return raise('#NUM!');
  });

  // pesquisa
  add('PROCV', ['VLOOKUP'], 'LOOKUP', 3, 4, (a) => {
    const table = matrixOf(a[1]), col = n(a, 2);
    if (col < 1 || col > (table[0]?.length ?? 0)) raise('#REF!');
    const exact = a[3] !== undefined && !toBool(a[3]);
    const i = matchIn(scalar(a[0]), table.map((r) => r[0] as Scalar), exact ? 0 : 1);
    return table[i - 1][col - 1] as Value;
  }, 'Procura na primeira coluna e devolve a coluna indicada.');
  add('PROCH', ['HLOOKUP'], 'LOOKUP', 3, 4, (a) => {
    const table = matrixOf(a[1]), row = n(a, 2);
    if (row < 1 || row > table.length) raise('#REF!');
    const exact = a[3] !== undefined && !toBool(a[3]);
    const i = matchIn(scalar(a[0]), table[0] as Scalar[], exact ? 0 : 1);
    return table[row - 1][i - 1] as Value;
  });
  add('ÍNDICE', ['INDEX'], 'LOOKUP', 2, 3, (a) => {
    const m = matrixOf(a[0]);
    let r = n(a, 1), c = n(a, 2, 1);
    if (m.length === 1 && a[2] === undefined) { c = r; r = 1; }   // vetor em linha: ÍNDICE(A1:E1; 3)
    if (r < 1 || c < 1 || r > m.length || c > m[0].length) raise('#REF!');
    return m[r - 1][c - 1] as Value;
  });
  add('CORRESP', ['MATCH'], 'LOOKUP', 2, 3, (a) => matchIn(scalar(a[0]), matrixOf(a[1]).flat() as Scalar[], n(a, 2, 1)));
  registerExtraFunctions(r);   // C1: as outras ~200 (functions-extra.ts)
  return r;
}
