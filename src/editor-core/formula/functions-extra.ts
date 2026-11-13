// C1 · Funções que faltavam (nomes em português e inglês, como no Excel/LibreOffice em pt-BR).
// Matemáticas, estatísticas, lógicas, informação, texto, data, financeiras, pesquisa (incluindo as de matriz:
// PROCX, FILTRO, CLASSIFICAR, ÚNICO, SEQUÊNCIA…) e engenharia. Registradas no mesmo registro das básicas.
import {
  criterion, dateToSerial, err, flat, fv, isErr, isMatrix, matchIn, matrixOf, mean, n, numbers, pmt, pv, raise, round, scalar, serialToDate, t,
  toBool, toNumber, toText, type FunctionDef, type FunctionRegistry, type Matrix, type Scalar, type Value,
} from './functions.ts';
import { formatValue } from './number-format.ts';

type Cat = FunctionDef['category'];
const M = (rows: Value[][]): Matrix => ({ matrix: rows });
const vec = (v: Value) => matrixOf(v).flat() as Scalar[];
const nums = (v: Value) => vec(v).filter((x): x is number => typeof x === 'number');
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const fact = (k: number) => { if (k < 0) raise('#NUM!'); let r = 1; for (let i = 2; i <= Math.floor(k); i++) r *= i; return r; };
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
const variance = (xs: number[], sample: boolean) => { if (xs.length < (sample ? 2 : 1)) raise('#DIV/0!'); const m = mean(xs); return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - (sample ? 1 : 0)); };
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
function percentile(xs: number[], k: number) {
  if (!xs.length || k < 0 || k > 1) raise('#NUM!');
  const s = sorted(xs), pos = (s.length - 1) * k, lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
}
/** Pares (x, y) numéricos válidos de duas listas do mesmo tamanho. */
function pairs(a: Value, b: Value) {
  const ys = vec(a), xs = vec(b);
  if (ys.length !== xs.length) raise('#N/A');
  const out: [number, number][] = [];
  ys.forEach((y, i) => { if (typeof y === 'number' && typeof xs[i] === 'number') out.push([xs[i] as number, y]); });
  return out;
}
function linreg(a: Value, b: Value) {
  const p = pairs(a, b);
  if (p.length < 2) raise('#DIV/0!');
  const mx = mean(p.map((q) => q[0])), my = mean(p.map((q) => q[1]));
  const sxx = sum(p.map(([x]) => (x - mx) ** 2)), sxy = sum(p.map(([x, y]) => (x - mx) * (y - my))), syy = sum(p.map(([, y]) => (y - my) ** 2));
  if (sxx === 0) raise('#DIV/0!');
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: sxy / Math.sqrt(sxx * syy), n: p.length, mx, my };
}
// distribuição normal
function erf(x: number) {
  const s = Math.sign(x); x = Math.abs(x);
  const t1 = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t1 - 1.453152027) * t1 + 1.421413741) * t1 - 0.284496736) * t1 + 0.254829592) * t1 * Math.exp(-x * x);
  return s * y;
}
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
const normPdf = (z: number) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
function normInv(p: number) {
  if (p <= 0 || p >= 1) raise('#NUM!');
  // Acklam
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
// datas
const D = (v: Value) => serialToDate(toNumber(v));
const serialUTC = (y: number, m: number, d: number) => dateToSerial(new Date(y, m, d));
const isWeekend = (s: number, weekend = [0, 6]) => weekend.includes(serialToDate(s).getUTCDay());
function workdays(start: number, end: number, holidays: Set<number>) {
  let c = 0; const step = start <= end ? 1 : -1;
  for (let s = Math.floor(start); step > 0 ? s <= end : s >= end; s += step) if (!isWeekend(s) && !holidays.has(s)) c++;
  return c * step;
}
function parseDateText(s: string): number {
  const br = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\s*$/.exec(s);
  if (br) { const y = Number(br[3].length === 2 ? `20${br[3]}` : br[3]); return serialUTC(y, Number(br[2]) - 1, Number(br[1])); }
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return serialUTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return raise('#VALUE!');
}
function parseTimeText(s: string): number {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s) ?? raise('#VALUE!');
  let h = Number(m![1]); if (m![4]) h = (h % 12) + (/pm/i.test(m![4]) ? 12 : 0);
  return (h * 3600 + Number(m![2]) * 60 + Number(m![3] ?? 0)) / 86400;
}
// financeiras
function npv(rate: number, flows: number[]) { return flows.reduce((s, f, i) => s + f / (1 + rate) ** (i + 1), 0); }
function solve(f: (r: number) => number, guess = 0.1) {
  let r = guess;
  for (let i = 0; i < 100; i++) {
    const y = f(r), d = (f(r + 1e-6) - y) / 1e-6;
    if (!Number.isFinite(d) || d === 0) break;
    const next = r - y / d;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  return Math.abs(f(r)) < 1e-6 ? r : raise('#NUM!');
}
// engenharia
function toBase(v: number, base: number, places?: number) {
  if (!Number.isFinite(v)) raise('#NUM!');
  let s = v < 0 ? (base === 2 ? (1024 + v).toString(2) : base === 16 ? (16 ** 10 + v).toString(16) : (8 ** 10 + v).toString(8)) : Math.trunc(v).toString(base);
  s = s.toUpperCase();
  if (places !== undefined) { if (s.length > places) raise('#NUM!'); s = s.padStart(places, '0'); }
  return s;
}
function fromBase(s: string, base: number) {
  const v = parseInt(s, base);
  if (!/^[0-9A-Fa-f]+$/.test(s) || Number.isNaN(v)) raise('#NUM!');
  if (base === 2 && s.length === 10 && s[0] === '1') return v - 1024;
  if (base === 16 && s.length === 10 && parseInt(s[0], 16) >= 8) return v - 16 ** 10;
  if (base === 8 && s.length === 10 && Number(s[0]) >= 4) return v - 8 ** 10;
  return v;
}
const UNITS: Record<string, [string, number]> = {
  m: ['len', 1], km: ['len', 1000], cm: ['len', 0.01], mm: ['len', 0.001], mi: ['len', 1609.344], yd: ['len', 0.9144], ft: ['len', 0.3048], in: ['len', 0.0254], nmi: ['len', 1852],
  g: ['mass', 1], kg: ['mass', 1000], mg: ['mass', 0.001], lbm: ['mass', 453.59237], ozm: ['mass', 28.349523125], ton: ['mass', 907184.74], t: ['mass', 1e6],
  s: ['time', 1], sec: ['time', 1], mn: ['time', 60], min: ['time', 60], hr: ['time', 3600], day: ['time', 86400], d: ['time', 86400], yr: ['time', 31557600],
  l: ['vol', 1], L: ['vol', 1], ml: ['vol', 0.001], gal: ['vol', 3.785411784], m3: ['vol', 1000], cup: ['vol', 0.2365882365],
  J: ['energy', 1], kJ: ['energy', 1000], cal: ['energy', 4.1868], kcal: ['energy', 4186.8], Wh: ['energy', 3600], kWh: ['energy', 3.6e6],
  Pa: ['press', 1], atm: ['press', 101325], bar: ['press', 1e5], psi: ['press', 6894.757], mmHg: ['press', 133.322],
  W: ['power', 1], kW: ['power', 1000], HP: ['power', 745.69987], 'km/h': ['speed', 1 / 3.6], 'm/s': ['speed', 1], mph: ['speed', 0.44704], kn: ['speed', 0.514444],
  byte: ['info', 8], bit: ['info', 1], kbyte: ['info', 8192], Mbyte: ['info', 8388608], Gbyte: ['info', 8589934592],
  m2: ['area', 1], km2: ['area', 1e6], ha: ['area', 1e4], ft2: ['area', 0.09290304], ac: ['area', 4046.8564224],
};
function convert(v: number, from: string, to: string) {
  const temp = ['C', 'F', 'K'];
  if (temp.includes(from) && temp.includes(to)) {
    const c = from === 'C' ? v : from === 'F' ? (v - 32) * 5 / 9 : v - 273.15;
    return to === 'C' ? c : to === 'F' ? c * 9 / 5 + 32 : c + 273.15;
  }
  const a = UNITS[from], b = UNITS[to];
  if (!a || !b || a[0] !== b[0]) return raise('#N/A');
  return (v * a[1]) / b[1];
}
function roman(num: number) {
  if (num < 0 || num > 3999) raise('#VALUE!');
  const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = ''; let x = Math.trunc(num);
  for (const [v, r] of map) while (x >= v) { s += r; x -= v; }
  return s;
}
function arabic(s: string) {
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const up = s.toUpperCase().trim(); let total = 0;
  for (let i = 0; i < up.length; i++) { const a = v[up[i]] ?? raise('#VALUE!'), b = v[up[i + 1]] ?? 0; total += a < b ? -a : a; }
  return total;
}
/** Linhas de um intervalo como matriz retangular. */
const rows = (v: Value) => matrixOf(v) as Scalar[][];
const cmp = (a: Scalar, b: Scalar) => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a === null || a === '') return 1; if (b === null || b === '') return -1;
  return String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base', numeric: true });
};
/** SOMASES, CONT.SES…: pares (intervalo, critério) a partir do índice `from`. */
function ifsMask(a: Value[], from: number, size: number) {
  const mask = Array(size).fill(true);
  for (let i = from; i + 1 < a.length; i += 2) {
    const r = vec(a[i]), test = criterion(a[i + 1]);
    if (r.length !== size) raise('#VALUE!');
    r.forEach((v, k) => { if (!test(v)) mask[k] = false; });
  }
  return mask;
}
const SUBTOTAL_FN: Record<number, (xs: number[], all: Scalar[]) => number> = {
  1: (xs) => mean(xs), 2: (xs) => xs.length, 3: (_, all) => all.filter((v) => v !== null && v !== '').length, 4: (xs) => (xs.length ? Math.max(...xs) : 0), 5: (xs) => (xs.length ? Math.min(...xs) : 0),
  6: (xs) => xs.reduce((p, x) => p * x, 1), 7: (xs) => Math.sqrt(variance(xs, true)), 8: (xs) => Math.sqrt(variance(xs, false)), 9: (xs) => sum(xs), 10: (xs) => variance(xs, true), 11: (xs) => variance(xs, false),
};

export function registerExtraFunctions(r: FunctionRegistry) {
  const add = (name: string, aliases: string[], category: Cat, min: number, max: number | null, fn: FunctionDef['fn'], description = '') => r.register({ name, aliases, category, min, max, fn, description });
  const lazy = (name: string, aliases: string[], category: Cat, min: number, max: number | null, lazyFn: NonNullable<FunctionDef['lazyFn']>, description = '') => r.register({ name, aliases, category, min, max, fn: () => raise('#ERROR!'), lazyFn, description });

  // ---------------------------------------------------------------- matemáticas e trigonometria
  add('SOMARPRODUTO', ['SUMPRODUCT'], 'MATHEMATICAL', 1, null, (a) => { const vs = a.map(vec); const len = vs[0].length; if (vs.some((v) => v.length !== len)) raise('#VALUE!'); let s = 0; for (let i = 0; i < len; i++) s += vs.reduce((p, v) => p * (typeof v[i] === 'number' ? (v[i] as number) : 0), 1); return s; }, 'Soma dos produtos.');
  add('SOMASES', ['SUMIFS'], 'MATHEMATICAL', 3, null, (a) => { const s = vec(a[0]); const m = ifsMask(a, 1, s.length); return s.reduce<number>((acc, v, i) => (m[i] && typeof v === 'number' ? acc + v : acc), 0); }, 'Soma com vários critérios.');
  add('SOMAQUAD', ['SUMSQ'], 'MATHEMATICAL', 1, null, (a) => sum(numbers(a).map((x) => x * x)));
  add('TRUNCAR', ['TRUNC'], 'MATHEMATICAL', 1, 2, (a) => { const d = n(a, 1, 0), f = 10 ** d; return Math.trunc(n(a, 0) * f) / f; });
  add('TETO', ['CEILING', 'TETO.MAT', 'CEILING.MATH'], 'MATHEMATICAL', 1, 2, (a) => { const s = Math.abs(n(a, 1, 1)); return s === 0 ? 0 : Math.ceil(n(a, 0) / s) * s; });
  add('ARREDMULTB', ['FLOOR', 'ARREDMULTB.MAT', 'FLOOR.MATH'], 'MATHEMATICAL', 1, 2, (a) => { const s = Math.abs(n(a, 1, 1)); return s === 0 ? 0 : Math.floor(n(a, 0) / s) * s; });
  add('MARRED', ['MROUND'], 'MATHEMATICAL', 2, 2, (a) => { const m = n(a, 1); return m === 0 ? 0 : Math.round(n(a, 0) / m) * m; });
  add('PAR', ['EVEN'], 'MATHEMATICAL', 1, 1, (a) => { const x = n(a, 0), s = Math.sign(x) || 1, c = Math.ceil(Math.abs(x)); return s * (c % 2 ? c + 1 : c); });
  add('ÍMPAR', ['ODD'], 'MATHEMATICAL', 1, 1, (a) => { const x = n(a, 0), s = Math.sign(x) || 1, c = Math.ceil(Math.abs(x)); return s * (c % 2 ? c : c + 1); });
  add('SINAL', ['SIGN'], 'MATHEMATICAL', 1, 1, (a) => Math.sign(n(a, 0)));
  add('EXP', [], 'MATHEMATICAL', 1, 1, (a) => Math.exp(n(a, 0)));
  add('LN', [], 'MATHEMATICAL', 1, 1, (a) => { const x = n(a, 0); return x <= 0 ? raise('#NUM!') : Math.log(x); });
  add('LOG', [], 'MATHEMATICAL', 1, 2, (a) => { const x = n(a, 0), b = n(a, 1, 10); return x <= 0 || b <= 0 || b === 1 ? raise('#NUM!') : Math.log(x) / Math.log(b); });
  add('LOG10', [], 'MATHEMATICAL', 1, 1, (a) => { const x = n(a, 0); return x <= 0 ? raise('#NUM!') : Math.log10(x); });
  add('FATORIAL', ['FACT'], 'MATHEMATICAL', 1, 1, (a) => fact(n(a, 0)));
  add('FATDUPLO', ['FACTDOUBLE'], 'MATHEMATICAL', 1, 1, (a) => { let r2 = 1; for (let i = Math.floor(n(a, 0)); i > 1; i -= 2) r2 *= i; return r2; });
  add('COMBIN', [], 'MATHEMATICAL', 2, 2, (a) => { const k = Math.floor(n(a, 1)), m = Math.floor(n(a, 0)); return k > m || k < 0 ? raise('#NUM!') : Math.round(fact(m) / (fact(k) * fact(m - k))); });
  add('COMBINA', [], 'MATHEMATICAL', 2, 2, (a) => { const m = Math.floor(n(a, 0)), k = Math.floor(n(a, 1)); return Math.round(fact(m + k - 1) / (fact(k) * fact(m - 1))); });
  add('PERMUT', [], 'MATHEMATICAL', 2, 2, (a) => { const m = Math.floor(n(a, 0)), k = Math.floor(n(a, 1)); return k > m ? raise('#NUM!') : Math.round(fact(m) / fact(m - k)); });
  add('MULTINOMIAL', [], 'MATHEMATICAL', 1, null, (a) => { const xs = numbers(a).map(Math.floor); return Math.round(fact(sum(xs)) / xs.reduce((p, x) => p * fact(x), 1)); });
  add('MDC', ['GCD'], 'MATHEMATICAL', 1, null, (a) => numbers(a).map(Math.floor).reduce((p, x) => gcd(p, x)));
  add('MMC', ['LCM'], 'MATHEMATICAL', 1, null, (a) => numbers(a).map(Math.floor).reduce((p, x) => (p && x ? Math.abs(p * x) / gcd(p, x) : 0)));
  add('ALEATÓRIO', ['RAND'], 'MATHEMATICAL', 0, 0, () => Math.random());
  add('ALEATÓRIOENTRE', ['RANDBETWEEN'], 'MATHEMATICAL', 2, 2, (a) => { const lo = Math.ceil(n(a, 0)), hi = Math.floor(n(a, 1)); return hi < lo ? raise('#NUM!') : lo + Math.floor(Math.random() * (hi - lo + 1)); });
  add('QUOCIENTE', ['QUOTIENT'], 'MATHEMATICAL', 2, 2, (a) => { const d = n(a, 1); return d === 0 ? raise('#DIV/0!') : Math.trunc(n(a, 0) / d); });
  add('GRAUS', ['DEGREES'], 'MATHEMATICAL', 1, 1, (a) => (n(a, 0) * 180) / Math.PI);
  add('RADIANOS', ['RADIANS'], 'MATHEMATICAL', 1, 1, (a) => (n(a, 0) * Math.PI) / 180);
  for (const [pt, en, f] of [['SEN', 'SIN', Math.sin], ['COS', 'COS', Math.cos], ['TAN', 'TAN', Math.tan], ['ASEN', 'ASIN', Math.asin], ['ACOS', 'ACOS', Math.acos], ['ATAN', 'ATAN', Math.atan], ['SENH', 'SINH', Math.sinh], ['COSH', 'COSH', Math.cosh], ['TANH', 'TANH', Math.tanh]] as [string, string, (x: number) => number][])
    add(pt, pt === en ? [] : [en], 'MATHEMATICAL', 1, 1, (a) => { const v = f(n(a, 0)); return Number.isNaN(v) ? raise('#NUM!') : v; });
  add('ATAN2', [], 'MATHEMATICAL', 2, 2, (a) => { const x = n(a, 0), y = n(a, 1); return x === 0 && y === 0 ? raise('#DIV/0!') : Math.atan2(y, x); });
  add('RAIZPI', ['SQRTPI'], 'MATHEMATICAL', 1, 1, (a) => { const x = n(a, 0); return x < 0 ? raise('#NUM!') : Math.sqrt(x * Math.PI); });
  add('ROMANO', ['ROMAN'], 'MATHEMATICAL', 1, 2, (a) => roman(n(a, 0)));
  add('ARÁBICO', ['ARABIC'], 'MATHEMATICAL', 1, 1, (a) => arabic(t(a, 0)));
  add('BASE', [], 'MATHEMATICAL', 2, 3, (a) => { const b = n(a, 1); if (b < 2 || b > 36) raise('#NUM!'); return Math.trunc(n(a, 0)).toString(b).toUpperCase().padStart(n(a, 2, 0), '0'); });
  add('DECIMAL', [], 'MATHEMATICAL', 2, 2, (a) => { const v = parseInt(t(a, 0), n(a, 1)); return Number.isNaN(v) ? raise('#NUM!') : v; });
  add('SUBTOTAL', [], 'MATHEMATICAL', 2, null, (a) => { const k = n(a, 0) % 100; const f = SUBTOTAL_FN[k] ?? raise('#VALUE!'); const all = flat(a.slice(1)); return f!(all.filter((x): x is number => typeof x === 'number'), all); }, 'Função 1–11 (ou 101–111) sobre os intervalos.');
  add('AGREGAR', ['AGGREGATE'], 'MATHEMATICAL', 3, null, (a) => { const k = n(a, 0); const xs = flat(a.slice(2)).filter((x): x is number => typeof x === 'number'); if (k <= 11) return SUBTOTAL_FN[k](xs, xs); if (k === 12) return percentile(xs, 0.5); if (k === 14) return sorted(xs).reverse()[n(a, 3) - 1] ?? raise('#NUM!'); if (k === 15) return sorted(xs)[n(a, 3) - 1] ?? raise('#NUM!'); if (k === 16) return percentile(xs, n(a, 3)); return raise('#VALUE!'); }, 'Ignora erros: 1–12, 14 (MAIOR), 15 (MENOR), 16 (PERCENTIL).');
  add('MATRIZ.MULT', ['MMULT'], 'MATHEMATICAL', 2, 2, (a) => { const A = rows(a[0]).map((r2) => r2.map(Number)), B = rows(a[1]).map((r2) => r2.map(Number)); if (A[0].length !== B.length) raise('#VALUE!'); return M(A.map((row) => B[0].map((_, j) => sum(row.map((v, k) => v * B[k][j]))))); });
  add('MATRIZ.DETERM', ['MDETERM'], 'MATHEMATICAL', 1, 1, (a) => { const A = rows(a[0]).map((r2) => r2.map(Number)); if (A.some((r2) => r2.length !== A.length)) raise('#VALUE!'); const det = (m: number[][]): number => (m.length === 1 ? m[0][0] : m[0].reduce((s, v, j) => s + (j % 2 ? -1 : 1) * v * det(m.slice(1).map((r2) => r2.filter((_, k) => k !== j))), 0)); return det(A); });
  add('TRANSPOR', ['TRANSPOSE'], 'LOOKUP', 1, 1, (a) => { const A = matrixOf(a[0]); return M(A[0].map((_, j) => A.map((r2) => r2[j]))); });
  add('SEQUÊNCIA', ['SEQUENCE'], 'MATHEMATICAL', 1, 4, (a) => { const rr = n(a, 0), cc = n(a, 1, 1), st = n(a, 2, 1), sp = n(a, 3, 1); if (rr * cc > 100000) raise('#NUM!'); return M(Array.from({ length: rr }, (_, i) => Array.from({ length: cc }, (_, j) => st + (i * cc + j) * sp))); });
  add('MATRIZALEATÓRIA', ['RANDARRAY'], 'MATHEMATICAL', 0, 5, (a) => { const rr = n(a, 0, 1), cc = n(a, 1, 1), lo = n(a, 2, 0), hi = n(a, 3, 1), int = a[4] !== undefined && toBool(a[4]); return M(Array.from({ length: rr }, () => Array.from({ length: cc }, () => (int ? lo + Math.floor(Math.random() * (hi - lo + 1)) : lo + Math.random() * (hi - lo))))); });

  // ---------------------------------------------------------------- estatísticas
  add('MÉDIASE', ['AVERAGEIF'], 'STATISTICAL', 2, 3, (a) => { const rg = vec(a[0]), test = criterion(a[1]), av = a[2] ? vec(a[2]) : rg; return mean(rg.flatMap((v, i) => (test(v) && typeof av[i] === 'number' ? [av[i] as number] : []))); });
  add('MÉDIASES', ['AVERAGEIFS'], 'STATISTICAL', 3, null, (a) => { const s = vec(a[0]), m = ifsMask(a, 1, s.length); return mean(s.flatMap((v, i) => (m[i] && typeof v === 'number' ? [v] : []))); });
  add('CONT.SES', ['COUNTIFS'], 'STATISTICAL', 2, null, (a) => ifsMask(a, 0, vec(a[0]).length).filter(Boolean).length);
  add('MÁXIMOSES', ['MAXIFS'], 'STATISTICAL', 3, null, (a) => { const s = vec(a[0]), m = ifsMask(a, 1, s.length); const xs = s.flatMap((v, i) => (m[i] && typeof v === 'number' ? [v] : [])); return xs.length ? Math.max(...xs) : 0; });
  add('MÍNIMOSES', ['MINIFS'], 'STATISTICAL', 3, null, (a) => { const s = vec(a[0]), m = ifsMask(a, 1, s.length); const xs = s.flatMap((v, i) => (m[i] && typeof v === 'number' ? [v] : [])); return xs.length ? Math.min(...xs) : 0; });
  add('MODO', ['MODE', 'MODO.ÚNICO', 'MODE.SNGL'], 'STATISTICAL', 1, null, (a) => { const c = new Map<number, number>(); for (const x of numbers(a)) c.set(x, (c.get(x) ?? 0) + 1); let best: number | null = null, k = 1; for (const [x, v] of c) if (v > k) { best = x; k = v; } return best ?? raise('#N/A'); });
  add('MAIOR', ['LARGE'], 'STATISTICAL', 2, 2, (a) => sorted(nums(a[0])).reverse()[n(a, 1) - 1] ?? raise('#NUM!'));
  add('MENOR', ['SMALL'], 'STATISTICAL', 2, 2, (a) => sorted(nums(a[0]))[n(a, 1) - 1] ?? raise('#NUM!'));
  add('ORDEM', ['RANK', 'ORDEM.EQ', 'RANK.EQ'], 'STATISTICAL', 2, 3, (a) => { const x = n(a, 0), xs = nums(a[1]), asc = n(a, 2, 0) !== 0; if (!xs.includes(x)) raise('#N/A'); return xs.filter((v) => (asc ? v < x : v > x)).length + 1; });
  add('ORDEM.MÉD', ['RANK.AVG'], 'STATISTICAL', 2, 3, (a) => { const x = n(a, 0), xs = nums(a[1]), asc = n(a, 2, 0) !== 0; if (!xs.includes(x)) raise('#N/A'); const before = xs.filter((v) => (asc ? v < x : v > x)).length, same = xs.filter((v) => v === x).length; return before + (same + 1) / 2; });
  add('PERCENTIL', ['PERCENTILE', 'PERCENTIL.INC', 'PERCENTILE.INC'], 'STATISTICAL', 2, 2, (a) => percentile(nums(a[0]), n(a, 1)));
  add('QUARTIL', ['QUARTILE', 'QUARTIL.INC', 'QUARTILE.INC'], 'STATISTICAL', 2, 2, (a) => { const q = Math.floor(n(a, 1)); if (q < 0 || q > 4) raise('#NUM!'); return percentile(nums(a[0]), q / 4); });
  add('ORDEM.PORCENTUAL', ['PERCENTRANK', 'PERCENTRANK.INC'], 'STATISTICAL', 2, 3, (a) => { const xs = sorted(nums(a[0])), x = n(a, 1), d = n(a, 2, 3); if (x < xs[0] || x > xs.at(-1)!) raise('#N/A'); let i = xs.findIndex((v) => v >= x); if (xs[i] !== x) { const lo = xs[i - 1], hi = xs[i]; return Math.floor((((i - 1) + (x - lo) / (hi - lo)) / (xs.length - 1)) * 10 ** d) / 10 ** d; } return Math.floor((i / (xs.length - 1)) * 10 ** d) / 10 ** d; });
  add('DESVPADP', ['STDEVP', 'DESVPAD.P', 'STDEV.P'], 'STATISTICAL', 1, null, (a) => Math.sqrt(variance(numbers(a), false)));
  add('VAR', ['VAR.A', 'VAR.S'], 'STATISTICAL', 1, null, (a) => variance(numbers(a), true));
  add('VARP', ['VAR.P'], 'STATISTICAL', 1, null, (a) => variance(numbers(a), false));
  add('CORREL', ['PEARSON'], 'STATISTICAL', 2, 2, (a) => linreg(a[0], a[1]).r);
  add('COVAR', ['COVARIAÇÃO.P', 'COVARIANCE.P'], 'STATISTICAL', 2, 2, (a) => { const p = pairs(a[0], a[1]); const mx = mean(p.map((q) => q[0])), my = mean(p.map((q) => q[1])); return sum(p.map(([x, y]) => (x - mx) * (y - my))) / p.length; });
  add('COVARIAÇÃO.S', ['COVARIANCE.S'], 'STATISTICAL', 2, 2, (a) => { const p = pairs(a[0], a[1]); if (p.length < 2) raise('#DIV/0!'); const mx = mean(p.map((q) => q[0])), my = mean(p.map((q) => q[1])); return sum(p.map(([x, y]) => (x - mx) * (y - my))) / (p.length - 1); });
  add('INCLINAÇÃO', ['SLOPE'], 'STATISTICAL', 2, 2, (a) => linreg(a[0], a[1]).slope);
  add('INTERCEPÇÃO', ['INTERCEPT'], 'STATISTICAL', 2, 2, (a) => linreg(a[0], a[1]).intercept);
  add('RQUAD', ['RSQ'], 'STATISTICAL', 2, 2, (a) => linreg(a[0], a[1]).r ** 2);
  add('PREVISÃO', ['FORECAST', 'PREVISÃO.LINEAR', 'FORECAST.LINEAR'], 'STATISTICAL', 3, 3, (a) => { const l = linreg(a[1], a[2]); return l.intercept + l.slope * n(a, 0); }, 'Valor futuro pela reta de tendência.');
  add('TENDÊNCIA', ['TREND'], 'STATISTICAL', 1, 3, (a) => { const ys = vec(a[0]); const xs = a[1] ? a[1] : M(ys.map((_, i) => [i + 1])); const l = linreg(a[0], xs); const nx = a[2] ? vec(a[2]) : vec(xs); return M(nx.map((x) => [l.intercept + l.slope * Number(x)])); });
  add('CRESCIMENTO', ['GROWTH'], 'STATISTICAL', 1, 3, (a) => { const ys = vec(a[0]).map((y) => (typeof y === 'number' && y > 0 ? Math.log(y) : raise('#NUM!'))); const xs = a[1] ? a[1] : M(ys.map((_, i) => [i + 1])); const l = linreg(M(ys.map((y) => [y])), xs); const nx = a[2] ? vec(a[2]) : vec(xs); return M(nx.map((x) => [Math.exp(l.intercept + l.slope * Number(x))])); });
  add('MÉDIA.GEOMÉTRICA', ['GEOMEAN'], 'STATISTICAL', 1, null, (a) => { const xs = numbers(a); if (!xs.length || xs.some((x) => x <= 0)) raise('#NUM!'); return Math.exp(mean(xs.map(Math.log))); });
  add('MÉDIA.HARMÔNICA', ['HARMEAN'], 'STATISTICAL', 1, null, (a) => { const xs = numbers(a); if (!xs.length || xs.some((x) => x <= 0)) raise('#NUM!'); return xs.length / sum(xs.map((x) => 1 / x)); });
  add('DESV.MÉDIO', ['AVEDEV'], 'STATISTICAL', 1, null, (a) => { const xs = numbers(a), m = mean(xs); return mean(xs.map((x) => Math.abs(x - m))); });
  add('DESVQ', ['DEVSQ'], 'STATISTICAL', 1, null, (a) => { const xs = numbers(a), m = mean(xs); return sum(xs.map((x) => (x - m) ** 2)); });
  add('CURT', ['KURT'], 'STATISTICAL', 1, null, (a) => { const xs = numbers(a), k = xs.length; if (k < 4) raise('#DIV/0!'); const m = mean(xs), s = Math.sqrt(variance(xs, true)); return (k * (k + 1)) / ((k - 1) * (k - 2) * (k - 3)) * sum(xs.map((x) => ((x - m) / s) ** 4)) - (3 * (k - 1) ** 2) / ((k - 2) * (k - 3)); });
  add('DISTORÇÃO', ['SKEW'], 'STATISTICAL', 1, null, (a) => { const xs = numbers(a), k = xs.length; if (k < 3) raise('#DIV/0!'); const m = mean(xs), s = Math.sqrt(variance(xs, true)); return (k / ((k - 1) * (k - 2))) * sum(xs.map((x) => ((x - m) / s) ** 3)); });
  add('PADRONIZAR', ['STANDARDIZE'], 'STATISTICAL', 3, 3, (a) => { const s = n(a, 2); return s <= 0 ? raise('#NUM!') : (n(a, 0) - n(a, 1)) / s; });
  add('MÉDIA.INTERNA', ['TRIMMEAN'], 'STATISTICAL', 2, 2, (a) => { const xs = sorted(nums(a[0])), p = n(a, 1); if (p < 0 || p >= 1) raise('#NUM!'); const k = Math.floor((xs.length * p) / 2); return mean(xs.slice(k, xs.length - k)); });
  add('MÉDIAA', ['AVERAGEA'], 'STATISTICAL', 1, null, (a) => mean(flat(a).filter((v) => v !== null && v !== '').map((v) => (typeof v === 'number' ? v : v === true ? 1 : 0))));
  add('MÁXIMOA', ['MAXA'], 'STATISTICAL', 1, null, (a) => { const xs = flat(a).filter((v) => v !== null && v !== '').map((v) => (typeof v === 'number' ? v : v === true ? 1 : 0)); return xs.length ? Math.max(...xs) : 0; });
  add('MÍNIMOA', ['MINA'], 'STATISTICAL', 1, null, (a) => { const xs = flat(a).filter((v) => v !== null && v !== '').map((v) => (typeof v === 'number' ? v : v === true ? 1 : 0)); return xs.length ? Math.min(...xs) : 0; });
  add('FREQÜÊNCIA', ['FREQUENCY', 'FREQUÊNCIA'], 'STATISTICAL', 2, 2, (a) => { const xs = nums(a[0]), bins = sorted(nums(a[1])); const out = Array(bins.length + 1).fill(0); for (const x of xs) { const i = bins.findIndex((b) => x <= b); out[i < 0 ? bins.length : i]++; } return M(out.map((v) => [v])); });
  add('DIST.NORM.N', ['NORM.DIST', 'DIST.NORM', 'NORMDIST'], 'STATISTICAL', 4, 4, (a) => { const s = n(a, 2); if (s <= 0) raise('#NUM!'); const z = (n(a, 0) - n(a, 1)) / s; return toBool(a[3]) ? normCdf(z) : normPdf(z) / s; });
  add('INV.NORM.N', ['NORM.INV', 'INV.NORM', 'NORMINV'], 'STATISTICAL', 3, 3, (a) => n(a, 1) + n(a, 2) * normInv(n(a, 0)));
  add('DIST.NORMP.N', ['NORM.S.DIST', 'DIST.NORMP', 'NORMSDIST'], 'STATISTICAL', 1, 2, (a) => (a[1] === undefined || toBool(a[1]) ? normCdf(n(a, 0)) : normPdf(n(a, 0))));
  add('INV.NORMP.N', ['NORM.S.INV', 'INV.NORMP', 'NORMSINV'], 'STATISTICAL', 1, 1, (a) => normInv(n(a, 0)));
  add('DISTR.BINOM', ['BINOM.DIST', 'DISTRBINOM', 'BINOMDIST'], 'STATISTICAL', 4, 4, (a) => { const k = Math.floor(n(a, 0)), tr = Math.floor(n(a, 1)), p = n(a, 2); const pmf = (i: number) => (fact(tr) / (fact(i) * fact(tr - i))) * p ** i * (1 - p) ** (tr - i); return toBool(a[3]) ? sum(Array.from({ length: k + 1 }, (_, i) => pmf(i))) : pmf(k); });
  add('DIST.POISSON', ['POISSON.DIST', 'POISSON'], 'STATISTICAL', 3, 3, (a) => { const k = Math.floor(n(a, 0)), l = n(a, 1); const pmf = (i: number) => (Math.exp(-l) * l ** i) / fact(i); return toBool(a[2]) ? sum(Array.from({ length: k + 1 }, (_, i) => pmf(i))) : pmf(k); });
  add('DISTR.EXPON', ['EXPON.DIST', 'EXPONDIST'], 'STATISTICAL', 3, 3, (a) => { const x = n(a, 0), l = n(a, 1); return toBool(a[2]) ? 1 - Math.exp(-l * x) : l * Math.exp(-l * x); });
  add('INT.CONFIANÇA.NORM', ['CONFIDENCE.NORM', 'INT.CONFIANÇA', 'CONFIDENCE'], 'STATISTICAL', 3, 3, (a) => normInv(1 - n(a, 0) / 2) * n(a, 1) / Math.sqrt(n(a, 2)));

  // ---------------------------------------------------------------- lógicas e informação
  lazy('SES', ['IFS'], 'LOGICAL', 2, null, (a) => { for (let i = 0; i + 1 < a.length; i += 2) if (toBool(a[i]())) return a[i + 1](); return raise('#N/A'); }, 'Primeiro teste verdadeiro.');
  lazy('PARÂMETRO', ['SWITCH'], 'LOGICAL', 3, null, (a) => { const v = scalar(a[0]()); for (let i = 1; i + 1 < a.length; i += 2) { const c = scalar(a[i]()); if (c === v || (typeof c === 'string' && typeof v === 'string' && c.toLowerCase() === v.toLowerCase())) return a[i + 1](); } return a.length % 2 === 0 ? a[a.length - 1]() : raise('#N/A'); });
  lazy('ESCOLHER', ['CHOOSE'], 'LOOKUP', 2, null, (a) => { const k = Math.floor(toNumber(a[0]())); if (k < 1 || k >= a.length) raise('#VALUE!'); return a[k](); });
  add('XOU', ['XOR'], 'LOGICAL', 1, null, (a) => flat(a).filter((v) => v !== null && v !== '').reduce<boolean>((p, v) => p !== toBool(v), false));
  add('VERDADEIRO', ['TRUE'], 'LOGICAL', 0, 0, () => true);
  add('FALSO', ['FALSE'], 'LOGICAL', 0, 0, () => false);
  add('ÉTEXTO', ['ISTEXT'], 'LOGICAL', 1, 1, (a) => typeof scalar(a[0]) === 'string' && scalar(a[0]) !== '');
  add('ÉNÃO.TEXTO', ['ISNONTEXT'], 'LOGICAL', 1, 1, (a) => typeof scalar(a[0]) !== 'string' || scalar(a[0]) === '');
  add('ÉLÓGICO', ['ISLOGICAL'], 'LOGICAL', 1, 1, (a) => typeof scalar(a[0]) === 'boolean');
  add('ÉPAR', ['ISEVEN'], 'LOGICAL', 1, 1, (a) => Math.floor(Math.abs(n(a, 0))) % 2 === 0);
  add('ÉIMPAR', ['ISODD'], 'LOGICAL', 1, 1, (a) => Math.floor(Math.abs(n(a, 0))) % 2 === 1);
  add('É.NÃO.DISP', ['ISNA', 'ÉNÃO.DISP'], 'LOGICAL', 1, 1, (a) => { const s = scalar(a[0]); return isErr(s) && s.error === '#N/A'; });
  add('NÃO.DISP', ['NA'], 'LOGICAL', 0, 0, () => err('#N/A'));
  add('TIPO', ['TYPE'], 'LOGICAL', 1, 1, (a) => { if (isMatrix(a[0])) return 64; const s = a[0]; return isErr(s) ? 16 : typeof s === 'number' || s === null ? 1 : typeof s === 'string' ? 2 : 4; });
  add('TIPO.ERRO', ['ERROR.TYPE'], 'LOGICAL', 1, 1, (a) => { const s = scalar(a[0]); if (!isErr(s)) return err('#N/A'); return ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'].indexOf(s.error) + 1 || 8; });
  add('N', [], 'LOGICAL', 1, 1, (a) => { const s = scalar(a[0]); return typeof s === 'number' ? s : s === true ? 1 : isErr(s) ? s : 0; });

  // ---------------------------------------------------------------- texto
  add('PROCURAR', ['FIND'], 'TEXT', 2, 3, (a) => { const i = t(a, 1).indexOf(t(a, 0), n(a, 2, 1) - 1); return i < 0 ? raise('#VALUE!') : i + 1; }, 'Posição (diferencia maiúsculas).');
  add('LOCALIZAR', ['SEARCH'], 'TEXT', 2, 3, (a) => { const pat = t(a, 0).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*'); const s = t(a, 1), from = n(a, 2, 1) - 1; const m = new RegExp(pat, 'i').exec(s.slice(from)); return m ? m.index + from + 1 : raise('#VALUE!'); });
  add('MUDAR', ['REPLACE'], 'TEXT', 4, 4, (a) => { const s = t(a, 0), i = n(a, 1) - 1, k = n(a, 2); return s.slice(0, i) + t(a, 3) + s.slice(i + k); });
  add('REPT', [], 'TEXT', 2, 2, (a) => { const k = Math.floor(n(a, 1)); return k < 0 || k * t(a, 0).length > 32767 ? raise('#VALUE!') : t(a, 0).repeat(k); });
  add('EXATO', ['EXACT'], 'TEXT', 2, 2, (a) => t(a, 0) === t(a, 1));
  add('CARACT', ['CHAR'], 'TEXT', 1, 1, (a) => String.fromCharCode(n(a, 0)));
  add('CÓDIGO', ['CODE'], 'TEXT', 1, 1, (a) => { const s = t(a, 0); return s ? s.charCodeAt(0) : raise('#VALUE!'); });
  add('UNICAR', ['UNICHAR'], 'TEXT', 1, 1, (a) => String.fromCodePoint(n(a, 0)));
  add('UNICODE', [], 'TEXT', 1, 1, (a) => { const s = t(a, 0); return s ? s.codePointAt(0)! : raise('#VALUE!'); });
  add('TIRAR', ['CLEAN'], 'TEXT', 1, 1, (a) => t(a, 0).replace(/[\x00-\x1F]/g, ''));
  add('T', [], 'TEXT', 1, 1, (a) => { const s = scalar(a[0]); return typeof s === 'string' ? s : ''; });
  add('UNIRTEXTO', ['TEXTJOIN'], 'TEXT', 3, null, (a) => { const sep = t(a, 0), skip = toBool(a[1]); return flat(a.slice(2)).map((v) => (v === null ? '' : toText(v))).filter((v) => !skip || v !== '').join(sep); });
  add('TEXTOANTES', ['TEXTBEFORE'], 'TEXT', 2, 3, (a) => { const s = t(a, 0), d = t(a, 1), k = n(a, 2, 1); const parts = s.split(d); if (parts.length - 1 < Math.abs(k)) raise('#N/A'); return k > 0 ? parts.slice(0, k).join(d) : parts.slice(0, parts.length + k).join(d); });
  add('TEXTODEPOIS', ['TEXTAFTER'], 'TEXT', 2, 3, (a) => { const s = t(a, 0), d = t(a, 1), k = n(a, 2, 1); const parts = s.split(d); if (parts.length - 1 < Math.abs(k)) raise('#N/A'); return k > 0 ? parts.slice(k).join(d) : parts.slice(parts.length + k).join(d); });
  add('DIVIDIRTEXTO', ['TEXTSPLIT'], 'TEXT', 2, 3, (a) => { const s = t(a, 0), col = t(a, 1), row = a[2] !== undefined ? t(a, 2) : null; const lines = row ? s.split(row) : [s]; const out = lines.map((l) => l.split(col)); const w = Math.max(...out.map((r2) => r2.length)); return M(out.map((r2) => [...r2, ...Array(w - r2.length).fill(err('#N/A'))])); });
  add('FIXO', ['FIXED'], 'TEXT', 1, 3, (a) => { const d = n(a, 1, 2), noSep = a[2] !== undefined && toBool(a[2]); return round(n(a, 0), d, 'ROUND').toLocaleString('pt-BR', { minimumFractionDigits: Math.max(0, d), maximumFractionDigits: Math.max(0, d), useGrouping: !noSep }); });
  add('MOEDA', ['DOLLAR'], 'TEXT', 1, 2, (a) => { const d = n(a, 1, 2); return formatValue(round(n(a, 0), d, 'ROUND'), `R$ #.##0${d > 0 ? `,${'0'.repeat(d)}` : ''};-R$ #.##0${d > 0 ? `,${'0'.repeat(d)}` : ''}`).text; });
  add('VALORNUMÉRICO', ['NUMBERVALUE'], 'TEXT', 1, 3, (a) => { const dec = t(a, 1, ','), grp = t(a, 2, '.'); let s = t(a, 0).replace(/\s/g, ''); s = s.split(grp).join('').replace(dec, '.'); const pct = (s.match(/%/g) ?? []).length; const v = Number(s.replace(/%/g, '')); return Number.isNaN(v) ? raise('#VALUE!') : v / 100 ** pct; });
  // TEXTO passa a aceitar qualquer código de formato (datas, moeda, frações, máscaras)
  add('TEXTO', ['TEXT'], 'TEXT', 2, 2, (a) => { const s = scalar(a[0]); const v = typeof s === 'string' && s.trim() !== '' && !Number.isNaN(Number(s.replace(',', '.'))) ? Number(s.replace(',', '.')) : s; return formatValue(v, t(a, 1)).text; }, 'Formata com um código (ex.: "dd/mm/aaaa", "R$ #.##0,00", "0%").');

  // ---------------------------------------------------------------- data e hora
  add('DATA.VALOR', ['DATEVALUE'], 'DATE', 1, 1, (a) => parseDateText(t(a, 0)));
  add('VALOR.TEMPO', ['TIMEVALUE'], 'DATE', 1, 1, (a) => parseTimeText(t(a, 0)));
  add('TEMPO', ['TIME'], 'DATE', 3, 3, (a) => (((n(a, 0) * 3600 + n(a, 1) * 60 + n(a, 2)) / 86400) % 1 + 1) % 1);
  add('HORA', ['HOUR'], 'DATE', 1, 1, (a) => D(a[0]).getUTCHours());
  add('MINUTO', ['MINUTE'], 'DATE', 1, 1, (a) => D(a[0]).getUTCMinutes());
  add('SEGUNDO', ['SECOND'], 'DATE', 1, 1, (a) => D(a[0]).getUTCSeconds());
  add('DATAM', ['EDATE'], 'DATE', 2, 2, (a) => { const d = D(a[0]); const m = d.getUTCMonth() + n(a, 1); const last = new Date(Date.UTC(d.getUTCFullYear(), m + 1, 0)).getUTCDate(); return serialUTC(d.getUTCFullYear(), m, Math.min(d.getUTCDate(), last)); });
  add('FIMMÊS', ['EOMONTH'], 'DATE', 2, 2, (a) => { const d = D(a[0]); return serialUTC(d.getUTCFullYear(), d.getUTCMonth() + n(a, 1) + 1, 0); });
  add('DIATRABALHOTOTAL', ['NETWORKDAYS', 'DIATRABALHOTOTAL.INTL', 'NETWORKDAYS.INTL'], 'DATE', 2, 4, (a) => workdays(Math.floor(n(a, 0)), Math.floor(n(a, 1)), new Set(nums(a[a.length === 4 ? 3 : 2] ?? null).map(Math.floor))));
  add('DIATRABALHO', ['WORKDAY', 'DIATRABALHO.INTL', 'WORKDAY.INTL'], 'DATE', 2, 4, (a) => { let s = Math.floor(n(a, 0)), k = n(a, 1); const hol = new Set(nums(a[a.length === 4 ? 3 : 2] ?? null).map(Math.floor)); const step = k >= 0 ? 1 : -1; while (k !== 0) { s += step; if (!isWeekend(s) && !hol.has(s)) k -= step; } return s; });
  add('NÚMSEMANA', ['WEEKNUM'], 'DATE', 1, 2, (a) => { const d = D(a[0]); const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1); const start = n(a, 1, 1) === 2 ? 1 : 0; const off = (new Date(jan1).getUTCDay() - start + 7) % 7; return Math.floor(((d.getTime() - jan1) / 86400000 + off) / 7) + 1; });
  add('NÚMSEMANAISO', ['ISOWEEKNUM'], 'DATE', 1, 1, (a) => { const d = D(a[0]); const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const y1 = Date.UTC(x.getUTCFullYear(), 0, 1); return Math.ceil(((x.getTime() - y1) / 86400000 + 1) / 7); });
  add('DATADIF', ['DATEDIF'], 'DATE', 3, 3, (a) => { const s = D(a[0]), e = D(a[1]), u = t(a, 2).toUpperCase(); if (e < s) raise('#NUM!'); const months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth() - (e.getUTCDate() < s.getUTCDate() ? 1 : 0); const days = Math.round((e.getTime() - s.getTime()) / 86400000); return u === 'D' ? days : u === 'M' ? months : u === 'Y' ? Math.floor(months / 12) : u === 'YM' ? months % 12 : u === 'MD' ? (e.getUTCDate() - s.getUTCDate() + (e.getUTCDate() < s.getUTCDate() ? new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 0)).getUTCDate() : 0)) : u === 'YD' ? Math.round((e.getTime() - Date.UTC(e.getUTCFullYear() - (e.getUTCMonth() * 100 + e.getUTCDate() < s.getUTCMonth() * 100 + s.getUTCDate() ? 1 : 0), s.getUTCMonth(), s.getUTCDate())) / 86400000) : raise('#NUM!'); }, 'Diferença em "D", "M", "Y", "YM", "MD" ou "YD".');
  add('DIAS360', ['DAYS360'], 'DATE', 2, 3, (a) => { const s = D(a[0]), e = D(a[1]); let d1 = s.getUTCDate(), d2 = e.getUTCDate(); if (d1 === 31) d1 = 30; if (d2 === 31 && d1 === 30) d2 = 30; return (e.getUTCFullYear() - s.getUTCFullYear()) * 360 + (e.getUTCMonth() - s.getUTCMonth()) * 30 + d2 - d1; });
  add('FRAÇÃOANO', ['YEARFRAC'], 'DATE', 2, 3, (a) => { const b = n(a, 2, 0); const s = n(a, 0), e = n(a, 1); const days = Math.abs(e - s); return b === 1 ? days / 365.25 : b === 2 ? days / 360 : b === 3 ? days / 365 : (r.get('DIAS360')!.fn([a[0], a[1]], { now: () => new Date() }) as number) / 360; });

  // ---------------------------------------------------------------- financeiras
  add('VPL', ['NPV'], 'FINANCIAL', 2, null, (a) => npv(n(a, 0), numbers(a.slice(1))), 'Valor presente líquido.');
  add('TIR', ['IRR'], 'FINANCIAL', 1, 2, (a) => { const fl = nums(a[0]); if (!fl.some((x) => x < 0) || !fl.some((x) => x > 0)) raise('#NUM!'); return solve((r2) => fl.reduce((s, f, i) => s + f / (1 + r2) ** i, 0), n(a, 1, 0.1)); }, 'Taxa interna de retorno.');
  add('XVPL', ['XNPV'], 'FINANCIAL', 3, 3, (a) => { const r2 = n(a, 0), fl = nums(a[1]), ds = nums(a[2]); return sum(fl.map((f, i) => f / (1 + r2) ** ((ds[i] - ds[0]) / 365))); });
  add('XTIR', ['XIRR'], 'FINANCIAL', 2, 3, (a) => { const fl = nums(a[0]), ds = nums(a[1]); return solve((r2) => sum(fl.map((f, i) => f / (1 + r2) ** ((ds[i] - ds[0]) / 365))), n(a, 2, 0.1)); });
  add('MTIR', ['MIRR'], 'FINANCIAL', 3, 3, (a) => { const fl = nums(a[0]), fr = n(a, 1), rr = n(a, 2), k = fl.length; const pos = sum(fl.map((f, i) => (f > 0 ? f * (1 + rr) ** (k - 1 - i) : 0))), neg = sum(fl.map((f, i) => (f < 0 ? f / (1 + fr) ** i : 0))); if (!neg || !pos) raise('#DIV/0!'); return (pos / -neg) ** (1 / (k - 1)) - 1; });
  add('IPGTO', ['IPMT'], 'FINANCIAL', 4, 6, (a) => { const rate = n(a, 0), per = n(a, 1), np = n(a, 2), pvv = n(a, 3), fvv = n(a, 4, 0), ty = n(a, 5, 0); if (per < 1 || per > np) raise('#NUM!'); const p = pmt(rate, np, pvv, fvv, ty); if (ty) return per === 1 ? 0 : (fv(rate, per - 2, p, pvv, 1) - p) * rate; return fv(rate, per - 1, p, pvv, 0) * rate; }, 'Juros de um período.');
  add('PPGTO', ['PPMT'], 'FINANCIAL', 4, 6, (a) => { const rate = n(a, 0), per = n(a, 1), np = n(a, 2), pvv = n(a, 3), fvv = n(a, 4, 0), ty = n(a, 5, 0); const p = pmt(rate, np, pvv, fvv, ty); const i = (r.get('IPGTO')!.fn([rate, per, np, pvv, fvv, ty], { now: () => new Date() }) as number); return p - i; });
  add('PGTOJURACUM', ['CUMIPMT'], 'FINANCIAL', 6, 6, (a) => { let s = 0; for (let p = n(a, 3); p <= n(a, 4); p++) s += r.get('IPGTO')!.fn([n(a, 0), p, n(a, 1), n(a, 2), 0, n(a, 5)], { now: () => new Date() }) as number; return s; });
  add('PGTOCAPACUM', ['CUMPRINC'], 'FINANCIAL', 6, 6, (a) => { let s = 0; for (let p = n(a, 3); p <= n(a, 4); p++) s += r.get('PPGTO')!.fn([n(a, 0), p, n(a, 1), n(a, 2), 0, n(a, 5)], { now: () => new Date() }) as number; return s; });
  add('EFETIVA', ['EFFECT'], 'FINANCIAL', 2, 2, (a) => { const k = Math.floor(n(a, 1)); return k < 1 ? raise('#NUM!') : (1 + n(a, 0) / k) ** k - 1; });
  add('NOMINAL', [], 'FINANCIAL', 2, 2, (a) => { const k = Math.floor(n(a, 1)); return k < 1 ? raise('#NUM!') : k * ((1 + n(a, 0)) ** (1 / k) - 1); });
  add('DPD', ['SLN'], 'FINANCIAL', 3, 3, (a) => { const v = n(a, 2); return v === 0 ? raise('#DIV/0!') : (n(a, 0) - n(a, 1)) / v; }, 'Depreciação linear.');
  add('SDA', ['SYD'], 'FINANCIAL', 4, 4, (a) => { const c = n(a, 0), s = n(a, 1), l = n(a, 2), p = n(a, 3); return ((c - s) * (l - p + 1) * 2) / (l * (l + 1)); });
  add('BDD', ['DDB'], 'FINANCIAL', 4, 5, (a) => { const c = n(a, 0), s = n(a, 1), l = n(a, 2), p = n(a, 3), f = n(a, 4, 2); let v = c, d = 0; for (let i = 1; i <= p; i++) { d = Math.min(v * (f / l), Math.max(0, v - s)); v -= d; } return d; });
  add('BD', ['DB'], 'FINANCIAL', 4, 5, (a) => { const c = n(a, 0), s = n(a, 1), l = n(a, 2), p = n(a, 3), m = n(a, 4, 12); const rate = Math.round((1 - (s / c) ** (1 / l)) * 1000) / 1000; let v = c, d = 0; for (let i = 1; i <= p; i++) { d = i === 1 ? c * rate * m / 12 : i === l + 1 ? v * rate * (12 - m) / 12 : v * rate; v -= d; } return d; });
  add('VFPLANO', ['FVSCHEDULE'], 'FINANCIAL', 2, 2, (a) => nums(a[1]).reduce((v, rr) => v * (1 + rr), n(a, 0)));
  add('TAXAJURO.EQUIV', ['RRI'], 'FINANCIAL', 3, 3, (a) => (n(a, 2) / n(a, 1)) ** (1 / n(a, 0)) - 1);
  add('DURAÇÃOP', ['PDURATION'], 'FINANCIAL', 3, 3, (a) => (Math.log(n(a, 2)) - Math.log(n(a, 1))) / Math.log(1 + n(a, 0)));
  void pv;

  // ---------------------------------------------------------------- pesquisa e matrizes dinâmicas
  add('PROCX', ['XLOOKUP'], 'LOOKUP', 3, 6, (a) => {
    const key = scalar(a[0]), look = vec(a[1]), ret = matrixOf(a[2]); const mode = n(a, 4, 0), dir = n(a, 5, 1);
    const vertical = ret.length === look.length;
    const pick = (i: number): Value => (vertical ? (ret[i].length === 1 ? ret[i][0] : M([ret[i]])) : (ret.length === 1 ? ret[0][i] : M(ret.map((r2) => [r2[i]]))));
    const order = Array.from({ length: look.length }, (_, i) => (dir < 0 ? look.length - 1 - i : i));
    const test = mode === 2 ? criterion(key) : null;
    let best = -1;
    for (const i of order) {
      const v = look[i];
      if (test ? test(v) : cmpEq(v, key)) { best = i; break; }
      if (mode === -1 && typeof v === 'number' && typeof key === 'number' && v < key && (best < 0 || v > (look[best] as number))) best = i;
      if (mode === 1 && typeof v === 'number' && typeof key === 'number' && v > key && (best < 0 || v < (look[best] as number))) best = i;
    }
    if (best >= 0) return pick(best);
    return a[3] !== undefined ? a[3] : raise('#N/A');
  }, 'Procura em qualquer direção (exata, aproximada ou curinga).');
  add('CORRESPX', ['XMATCH'], 'LOOKUP', 2, 4, (a) => { const key = scalar(a[0]), look = vec(a[1]), mode = n(a, 2, 0), dir = n(a, 3, 1); const idx = Array.from({ length: look.length }, (_, i) => (dir < 0 ? look.length - 1 - i : i)); const test = mode === 2 ? criterion(key) : null; let best = -1; for (const i of idx) { const v = look[i]; if (test ? test(v) : cmpEq(v, key)) return i + 1; if (mode === -1 && typeof v === 'number' && typeof key === 'number' && v < key && (best < 0 || v > (look[best] as number))) best = i; if (mode === 1 && typeof v === 'number' && typeof key === 'number' && v > key && (best < 0 || v < (look[best] as number))) best = i; } return best >= 0 ? best + 1 : raise('#N/A'); });
  add('PROC', ['LOOKUP'], 'LOOKUP', 2, 3, (a) => { const look = vec(a[1]), res = a[2] ? vec(a[2]) : look; const i = matchIn(scalar(a[0]), look, 1); return res[i - 1] ?? raise('#N/A'); });
  add('LINS', ['ROWS'], 'LOOKUP', 1, 1, (a) => matrixOf(a[0]).length);
  add('COLS', ['COLUMNS'], 'LOOKUP', 1, 1, (a) => matrixOf(a[0])[0]?.length ?? 0);
  add('ÚNICO', ['UNIQUE'], 'LOOKUP', 1, 3, (a) => { const rs = rows(a[0]); const once = a[2] !== undefined && toBool(a[2]); const key = (r2: Scalar[]) => JSON.stringify(r2.map((v) => (typeof v === 'string' ? v.toLowerCase() : v))); const c = new Map<string, number>(); rs.forEach((r2) => c.set(key(r2), (c.get(key(r2)) ?? 0) + 1)); const seen = new Set<string>(); const out = rs.filter((r2) => { const k = key(r2); if (seen.has(k) || (once && c.get(k)! > 1)) return false; seen.add(k); return true; }); return out.length ? M(out) : raise('#ERROR!'); }, 'Valores sem repetição.');
  add('CLASSIFICAR', ['SORT'], 'LOOKUP', 1, 4, (a) => { const rs = rows(a[0]).map((r2) => [...r2]); const col = n(a, 1, 1) - 1, ord = n(a, 2, 1); return M(rs.sort((p, q) => cmp(p[col], q[col]) * (ord < 0 ? -1 : 1))); });
  add('CLASSIFICARPOR', ['SORTBY'], 'LOOKUP', 2, null, (a) => { const rs = rows(a[0]); const keys: { v: Scalar[]; o: number }[] = []; for (let i = 1; i < a.length; i += 2) keys.push({ v: vec(a[i]), o: a[i + 1] !== undefined ? toNumber(a[i + 1]) : 1 }); const idx = rs.map((_, i) => i).sort((p, q) => { for (const k of keys) { const c = cmp(k.v[p], k.v[q]) * (k.o < 0 ? -1 : 1); if (c) return c; } return 0; }); return M(idx.map((i) => rs[i])); });
  add('FILTRO', ['FILTER'], 'LOOKUP', 2, 3, (a) => { const rs = rows(a[0]), inc = vec(a[1]); const out = rs.filter((_, i) => inc[i] !== undefined && toBool(inc[i])); return out.length ? M(out) : a[2] !== undefined ? a[2] : raise('#ERROR!'); }, 'Linhas que atendem à condição.');
  add('EMPILHARV', ['VSTACK'], 'LOOKUP', 1, null, (a) => { const all = a.flatMap((v) => rows(v)); const w = Math.max(...all.map((r2) => r2.length)); return M(all.map((r2) => [...r2, ...Array(w - r2.length).fill(err('#N/A'))])); });
  add('EMPILHARH', ['HSTACK'], 'LOOKUP', 1, null, (a) => { const ms = a.map(rows); const h = Math.max(...ms.map((m) => m.length)); return M(Array.from({ length: h }, (_, i) => ms.flatMap((m) => m[i] ?? Array(m[0]?.length ?? 1).fill(err('#N/A'))))); });
  add('TOMAR', ['TAKE'], 'LOOKUP', 2, 3, (a) => { let rs = rows(a[0]); const rr = n(a, 1, rs.length), cc = a[2] !== undefined ? n(a, 2) : null; rs = rr >= 0 ? rs.slice(0, rr) : rs.slice(rr); if (cc !== null) rs = rs.map((r2) => (cc >= 0 ? r2.slice(0, cc) : r2.slice(cc))); return M(rs); });
  add('DESCARTAR', ['DROP'], 'LOOKUP', 2, 3, (a) => { let rs = rows(a[0]); const rr = n(a, 1, 0), cc = a[2] !== undefined ? n(a, 2) : 0; rs = rr >= 0 ? rs.slice(rr) : rs.slice(0, rr); if (cc) rs = rs.map((r2) => (cc >= 0 ? r2.slice(cc) : r2.slice(0, cc))); return rs.length ? M(rs) : raise('#VALUE!'); });
  add('ESCOLHERCOLS', ['CHOOSECOLS'], 'LOOKUP', 2, null, (a) => { const rs = rows(a[0]); const cs = a.slice(1).map((v) => toNumber(v)); return M(rs.map((r2) => cs.map((c) => r2[c > 0 ? c - 1 : r2.length + c] ?? raise('#VALUE!')))); });
  add('ESCOLHERLINS', ['CHOOSEROWS'], 'LOOKUP', 2, null, (a) => { const rs = rows(a[0]); return M(a.slice(1).map((v) => { const k = toNumber(v); return rs[k > 0 ? k - 1 : rs.length + k] ?? raise('#VALUE!'); })); });
  add('PARACOL', ['TOCOL'], 'LOOKUP', 1, 3, (a) => M(vec(a[0]).filter((v) => !(n(a, 1, 0) === 1 && (v === null || v === ''))).map((v) => [v])));
  add('PARALIN', ['TOROW'], 'LOOKUP', 1, 3, (a) => M([vec(a[0]).filter((v) => !(n(a, 1, 0) === 1 && (v === null || v === '')))]));

  // ---------------------------------------------------------------- engenharia
  add('DECABIN', ['DEC2BIN'], 'MATHEMATICAL', 1, 2, (a) => { const v = n(a, 0); if (v < -512 || v > 511) raise('#NUM!'); return toBase(v, 2, a[1] !== undefined ? n(a, 1) : undefined); });
  add('BINADEC', ['BIN2DEC'], 'MATHEMATICAL', 1, 1, (a) => fromBase(t(a, 0), 2));
  add('DECAHEX', ['DEC2HEX'], 'MATHEMATICAL', 1, 2, (a) => toBase(n(a, 0), 16, a[1] !== undefined ? n(a, 1) : undefined));
  add('HEXADEC', ['HEX2DEC'], 'MATHEMATICAL', 1, 1, (a) => fromBase(t(a, 0), 16));
  add('DECAOCT', ['DEC2OCT'], 'MATHEMATICAL', 1, 2, (a) => toBase(n(a, 0), 8, a[1] !== undefined ? n(a, 1) : undefined));
  add('OCTADEC', ['OCT2DEC'], 'MATHEMATICAL', 1, 1, (a) => fromBase(t(a, 0), 8));
  add('CONVERTER', ['CONVERT'], 'MATHEMATICAL', 3, 3, (a) => convert(n(a, 0), t(a, 1), t(a, 2)), 'Unidades: comprimento, massa, tempo, volume, energia, pressão, potência, velocidade, área, temperatura, informação.');
  add('DELTA', [], 'MATHEMATICAL', 1, 2, (a) => (n(a, 0) === n(a, 1, 0) ? 1 : 0));
  add('DEGRAU', ['GESTEP'], 'MATHEMATICAL', 1, 2, (a) => (n(a, 0) >= n(a, 1, 0) ? 1 : 0));
  add('BITAND', [], 'MATHEMATICAL', 2, 2, (a) => Number(BigInt(Math.trunc(n(a, 0))) & BigInt(Math.trunc(n(a, 1)))));
  add('BITOR', [], 'MATHEMATICAL', 2, 2, (a) => Number(BigInt(Math.trunc(n(a, 0))) | BigInt(Math.trunc(n(a, 1)))));
  add('BITXOR', [], 'MATHEMATICAL', 2, 2, (a) => Number(BigInt(Math.trunc(n(a, 0))) ^ BigInt(Math.trunc(n(a, 1)))));
}
const cmpEq = (a: Scalar, b: Scalar) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);
