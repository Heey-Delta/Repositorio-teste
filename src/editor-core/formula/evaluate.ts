// Avaliador: executa a AST. Não conhece planilhas nem tabelas: pede os valores pelo contexto (Resolver), então o
// mesmo avaliador serve para planilhas, tabelas de documentos e qualquer componente com expressões calculáveis.
import type { Ast } from './parse.ts';
import type { FunctionRegistry, Scalar, Value } from './functions.ts';
import { err, FormulaFault, isErr, isMatrix, normalizeName, raise, scalar, toBool, toNumber, toText } from './functions.ts';

export interface EvalContext {
  getCell: (sheet: string | null, row: number, col: number) => Scalar;
  getRange: (sheet: string | null, r1: number, c1: number, r2: number, c2: number) => Value[][];
  getName: (name: string) => Ast | null;
  functions: FunctionRegistry;
  now: () => Date;
}

/** Funções avaliadas sob demanda: só o ramo necessário é calculado (SE não calcula o lado que não usa). */
const LAZY = new Set(['SE', 'SEERRO', 'SENAODISP']);

function compare(a: Scalar, b: Scalar): number {
  if (isErr(a)) raise(a.error);
  if (isErr(b)) raise(b.error);
  const rank = (v: Scalar) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : -1);
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === 'string') return a.localeCompare(b as string, 'pt-BR', { sensitivity: 'accent' });
  return Number(a) - Number(b);
}

function binOp(op: string, l: Value, r: Value): Value {
  switch (op) {
    case '+': return toNumber(l) + toNumber(r);
    case '-': return toNumber(l) - toNumber(r);
    case '*': return toNumber(l) * toNumber(r);
    case '/': { const d = toNumber(r); const x = toNumber(l); return d === 0 ? raise('#DIV/0!') : x / d; }
    case '^': return toNumber(l) ** toNumber(r);
    case '&': return toText(l) + toText(r);
    default: {
      const c = compare(scalar(l), scalar(r));
      return { '=': c === 0, '<>': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[op] ?? raise('#ERROR!');
    }
  }
}

function evalNode(a: Ast, ctx: EvalContext): Value {
  switch (a.k) {
    case 'num': return a.v;
    case 'str': return a.v;
    case 'bool': return a.v;
    case 'err': return err(a.code as any);
    case 'ref': return ctx.getCell(a.sheet, a.row, a.col);
    case 'range': return { matrix: ctx.getRange(a.sheet, Math.min(a.start.row, a.end.row), Math.min(a.start.col, a.end.col), Math.max(a.start.row, a.end.row), Math.max(a.start.col, a.end.col)) };
    case 'val': return a.v as Value;
    case 'arr': return { matrix: a.v };
    case 'name': {
      const target = ctx.getName(a.name) ?? raise('#NAME?');
      return evalNode(target!, ctx);
    }
    case 'un': { const v = toNumber(evalNode(a.arg, ctx)); return a.op === '-' ? -v : v; }
    case 'pct': return toNumber(evalNode(a.arg, ctx)) / 100;
    case 'bin': {
      const l = evalNode(a.left, ctx), r = evalNode(a.right, ctx);
      // matriz com matriz/valor: operação elemento a elemento (C2:C6>200, (B2:B6="Sul")*C2:C6…)
      if (isMatrix(l) || isMatrix(r)) {
        const L = isMatrix(l) ? l.matrix : [[l]], R = isMatrix(r) ? r.matrix : [[r]];
        const h = Math.max(L.length, R.length), w = Math.max(L[0]?.length ?? 1, R[0]?.length ?? 1);
        const at = (m: Value[][], i: number, j: number) => m[m.length === 1 ? 0 : i]?.[m[0].length === 1 ? 0 : j] ?? err('#N/A');
        return { matrix: Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => { try { return binOp(a.op, at(L, i, j), at(R, i, j)); } catch (x) { if (x instanceof FormulaFault) return err(x.code); throw x; } })) };
      }
      return binOp(a.op, l, r);
    }
    case 'call': {
      const def = ctx.functions.get(a.name) ?? raise('#NAME?');
      const name = normalizeName(def!.name);
      if (a.args.length < def!.min || (def!.max !== null && a.args.length > def!.max)) raise('#VALUE!');
      if (LAZY.has(name)) {
        if (name === 'SE') {
          const cond = toBool(evalNode(a.args[0], ctx));
          if (cond) return a.args[1] ? evalNode(a.args[1], ctx) : true;
          return a.args[2] ? evalNode(a.args[2], ctx) : false;
        }
        const first = safe(a.args[0], ctx);   // SEERRO / SENÃODISP
        const s = scalar(first);
        if (isErr(s) && (name === 'SEERRO' || s.error === '#N/A')) return evalNode(a.args[1], ctx);
        return first;
      }
      if (def!.lazyFn) return def!.lazyFn(a.args.map((x) => () => evalNode(x, ctx)), { now: ctx.now });
      return def!.fn(a.args.map((x) => evalNode(x, ctx)), { now: ctx.now });
    }
  }
}

/** Avalia sem lançar: qualquer falha vira valor de erro. */
function safe(a: Ast, ctx: EvalContext): Value {
  try { return evalNode(a, ctx); }
  catch (e) { if (e instanceof FormulaFault) return err(e.code); throw e; }
}

/** Resultado final de uma fórmula (um valor só; intervalo vira o primeiro valor). */
export function evaluate(a: Ast, ctx: EvalContext): Scalar {
  let v: Value;
  try { v = evalNode(a, ctx); }
  catch (e) {
    if (e instanceof FormulaFault) return err(e.code);
    if (e instanceof RangeError) return err('#NUM!');   // recursão profunda demais etc.
    throw e;
  }
  const s = isMatrix(v) ? scalar(v) : v;
  if (typeof s === 'number' && !Number.isFinite(s)) return err('#NUM!');
  return s;
}

export { LAZY };
