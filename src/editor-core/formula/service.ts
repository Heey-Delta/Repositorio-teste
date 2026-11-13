// Coordenador das fórmulas (FORMULA ENGINE): liga o avaliador às planilhas e tabelas do documento.
//   - Resolver: entrega o valor de A1, de B1:B10, de Planilha2!A1 e de nomes definidos (intervalos nomeados).
//   - Dependências: de quais células cada fórmula depende (precedentes) — intervalos não são expandidos célula a
//     célula, então =SOMA(A1:A100000) custa o mesmo que =SOMA(A1:A2).
//   - Recálculo: só o que depende do que mudou, na ordem certa (topológica); ciclos viram #CYCLE!.
//   - Ajuste de referências: copiar fórmula (referências relativas andam junto) e inserir/excluir linhas e colunas.
// O motor de tabelas guarda fórmula e resultado; este módulo só calcula (regra da arquitetura).
import type { EditorNode } from '../types.ts';
import type { Engine } from '../engine.ts';
import type { Ast, RefPart } from './parse.ts';
import type { EvalContext } from './evaluate.ts';
import type { Scalar } from './functions.ts';
import { collectRefs, mapRefs, parse, parseAddress, parseRange, stringify, toAddress, usesVolatile, MAX_COLS, MAX_ROWS } from './parse.ts';
import { evaluate } from './evaluate.ts';
import { createRegistry, err, ERROR_MESSAGES, FunctionRegistry, isErr } from './functions.ts';

export interface SheetCell {
  value?: Scalar;
  formula?: string | null;
  calculatedValue?: Scalar;
  error?: { code: string; message: string } | null;
  calculationState?: 'PENDING' | 'VALID' | 'ERROR' | 'STALE';
  styleOverrides?: Record<string, unknown>;
  validation?: ValidationRule | null;
}

export type ValidationRule =
  | { type: 'LIST'; values: (string | number)[] }
  | { type: 'NUMBER'; min?: number; max?: number; integer?: boolean }
  | { type: 'TEXT_LENGTH'; min?: number; max?: number }
  | { type: 'DATE'; min?: number; max?: number };

interface Precedent { sheetId: string | null; r1: number; c1: number; r2: number; c2: number }
interface FormulaCell { sheetId: string; addr: string; row: number; col: number; ast: Ast | null; precedents: Precedent[]; volatile: boolean }

export const isSheet = (n: EditorNode | undefined) => n?.type === 'SURFACE' && n.data.surfaceType === 'SHEET';

export class FormulaService {
  registry: FunctionRegistry = createRegistry();
  private cache = new Map<string, Ast | Error>();
  private e: Engine;
  now: () => Date = () => new Date();

  constructor(e: Engine) { this.e = e; }

  parseCached(formula: string): Ast | Error {
    let a = this.cache.get(formula);
    if (!a) {
      try { a = parse(formula); } catch (ex) { a = ex as Error; }
      this.cache.set(formula, a);
      if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value!);
    }
    return a;
  }

  sheets() { return Object.values(this.e.doc.nodes).filter(isSheet); }
  sheetByName(name: string) { const k = name.toLowerCase(); return this.sheets().find((s) => String(s.data.name).toLowerCase() === k); }

  /** Valor visível de uma célula (fórmula → resultado; erro → valor de erro). */
  cellValue(sheet: EditorNode, row: number, col: number): Scalar {
    const c: SheetCell | undefined = sheet.data.cells?.[toAddress({ row, col })];
    if (!c) return null;
    if (c.formula) {
      if (c.error) return err(c.error.code as any);
      return c.calculatedValue ?? null;
    }
    return c.value ?? null;
  }

  /** Contexto de avaliação a partir de uma planilha. */
  context(sheetId: string): EvalContext {
    const resolve = (name: string | null) => {
      if (name === null) return this.e.doc.nodes[sheetId];
      const s = this.sheetByName(name);
      if (!s) throw Object.assign(new Error('#REF!'), { formulaCode: '#REF!' });
      return s;
    };
    const guard = <T>(fn: () => T): T => { try { return fn(); } catch (ex: any) { if (ex.formulaCode) { return err(ex.formulaCode) as any; } throw ex; } };
    return {
      getCell: (sheet, row, col) => guard(() => this.cellValue(resolve(sheet), row, col)),
      getRange: (sheet, r1, c1, r2, c2) => guard(() => {
        const s = resolve(sheet);
        if ((r2 - r1 + 1) * (c2 - c1 + 1) > 2_000_000) throw Object.assign(new Error('#NUM!'), { formulaCode: '#NUM!' });
        const rows: Scalar[][] = [];
        // limita ao trecho usado da planilha (A:A até o fim não percorre um milhão de linhas vazias)
        const used = this.usedBounds(s);
        const rEnd = Math.min(r2, Math.max(r1, used.rows)), cEnd = Math.min(c2, Math.max(c1, used.cols));
        for (let r = r1; r <= rEnd; r++) { const line: Scalar[] = []; for (let c = c1; c <= cEnd; c++) line.push(this.cellValue(s, r, c)); rows.push(line); }
        return rows;
      }) as any,
      getName: (name) => {
        const target = this.e.doc.document.settings.names?.[name.toUpperCase()];
        return target ? (this.parseCached(target) instanceof Error ? null : (this.parseCached(target) as Ast)) : null;
      },
      functions: this.registry,
      now: this.now,
    };
  }

  usedBounds(sheet: EditorNode) {
    let rows = 0, cols = 0;
    for (const a of Object.keys(sheet.data.cells ?? {})) { const p = parseAddress(a); rows = Math.max(rows, p.row); cols = Math.max(cols, p.col); }
    return { rows, cols };
  }

  // ---------------------------------------------------------------- dependências

  private precedentsOf(ast: Ast, depth = 0): Precedent[] {
    const out: Precedent[] = [];
    for (const r of collectRefs(ast)) {
      if (r.k === 'ref') out.push({ sheetId: this.sheetIdFor(r.sheet), r1: r.row, c1: r.col, r2: r.row, c2: r.col });
      else if (r.k === 'range') out.push({ sheetId: this.sheetIdFor(r.sheet), r1: Math.min(r.start.row, r.end.row), c1: Math.min(r.start.col, r.end.col), r2: Math.max(r.start.row, r.end.row), c2: Math.max(r.start.col, r.end.col) });
      else if (r.k === 'name' && depth < 5) {
        const t = this.e.doc.document.settings.names?.[r.name.toUpperCase()];
        const a = t ? this.parseCached(t) : null;
        if (a && !(a instanceof Error)) out.push(...this.precedentsOf(a, depth + 1));
      }
    }
    return out;
  }
  private currentSheet: string | null = null;
  private sheetIdFor(name: string | null) { return name === null ? this.currentSheet : this.sheetByName(name)?.id ?? null; }

  /** Todas as fórmulas das planilhas, com seus precedentes. */
  formulaCells(): FormulaCell[] {
    const out: FormulaCell[] = [];
    for (const s of this.sheets()) {
      this.currentSheet = s.id;
      for (const [addr, c] of Object.entries<SheetCell>(s.data.cells ?? {})) {
        if (!c.formula) continue;
        const a = this.parseCached(c.formula);
        const pos = parseAddress(addr);
        const ast = a instanceof Error ? null : a;
        out.push({ sheetId: s.id, addr, row: pos.row, col: pos.col, ast, precedents: ast ? this.precedentsOf(ast) : [], volatile: ast ? usesVolatile(ast) : false });
      }
    }
    this.currentSheet = null;
    return out;
  }

  private static hits(p: Precedent, sheetId: string, row: number, col: number) {
    return p.sheetId === sheetId && row >= p.r1 && row <= p.r2 && col >= p.c1 && col <= p.c2;
  }

  /**
   * Recalcula o que depende das células alteradas (e elas mesmas, se forem fórmulas). Com `all`, recalcula tudo.
   * Precisa rodar dentro de uma transação (grava os resultados nas células).
   */
  recalc(changed: { sheetId: string; addr: string }[], all = false) {
    const formulas = this.formulaCells();
    const key = (f: { sheetId: string; addr: string }) => `${f.sheetId}!${f.addr}`;
    const byKey = new Map(formulas.map((f) => [key(f), f]));
    const affected = new Set<string>();
    if (all) formulas.forEach((f) => affected.add(key(f)));
    else {
      const frontier = changed.map((c) => ({ ...c, ...parseAddress(c.addr) }));
      for (const c of changed) if (byKey.has(key(c))) affected.add(key(c));
      for (const f of formulas) if (f.volatile) affected.add(key(f));
      while (frontier.length) {
        const cur = frontier.pop()!;
        for (const f of formulas) {
          const k = key(f);
          if (affected.has(k)) continue;
          if (f.precedents.some((p) => FormulaService.hits(p, cur.sheetId, cur.row, cur.col))) {
            affected.add(k);
            frontier.push({ sheetId: f.sheetId, addr: f.addr, row: f.row, col: f.col });
          }
        }
      }
    }
    // ordem topológica (Kahn) dentro do conjunto afetado: uma célula só depois de seus precedentes
    const list = [...affected].map((k) => byKey.get(k)!).filter(Boolean);
    const deps = new Map<string, Set<string>>(), users = new Map<string, Set<string>>();
    for (const f of list) {
      deps.set(key(f), new Set());
      for (const g of list) {
        if (g === f) { if (f.precedents.some((p) => FormulaService.hits(p, f.sheetId, f.row, f.col))) deps.get(key(f))!.add(key(f)); continue; }
        if (f.precedents.some((p) => FormulaService.hits(p, g.sheetId, g.row, g.col))) {
          deps.get(key(f))!.add(key(g));
          if (!users.has(key(g))) users.set(key(g), new Set());
          users.get(key(g))!.add(key(f));
        }
      }
    }
    const ready = list.filter((f) => deps.get(key(f))!.size === 0).map(key);
    const order: string[] = [];
    const pending = new Map([...deps].map(([k, v]) => [k, new Set(v)]));
    while (ready.length) {
      const k = ready.shift()!;
      order.push(k);
      for (const u of users.get(k) ?? []) { const s = pending.get(u)!; s.delete(k); if (s.size === 0) ready.push(u); }
    }
    const cyclic = list.map(key).filter((k) => !order.includes(k));
    for (const k of order) this.compute(byKey.get(k)!);
    for (const k of cyclic) this.writeResult(byKey.get(k)!, err('#CYCLE!'));
    return { recalculated: order.length, cycles: cyclic.map((k) => k.split('!').slice(1).join('!')) };
  }

  private compute(f: FormulaCell) {
    if (!f.ast) { this.writeResult(f, err('#ERROR!'), 'Fórmula com erro de escrita.'); return; }
    const v = evaluate(f.ast, this.context(f.sheetId));
    this.writeResult(f, v);
  }

  private writeResult(f: FormulaCell, v: Scalar, message?: string) {
    const s = this.e.touchNode(f.sheetId);
    const c: SheetCell = s.data.cells[f.addr];
    if (isErr(v)) {
      c.calculatedValue = null;
      c.error = { code: v.error, message: message ?? ERROR_MESSAGES[v.error] };
      c.calculationState = 'ERROR';
    } else {
      c.calculatedValue = v;
      c.error = null;
      c.calculationState = 'VALID';
    }
  }

  // ---------------------------------------------------------------- ajuste de referências

  /** Copia uma fórmula deslocando as referências relativas (=A1 copiada uma linha abaixo vira =A2). */
  shift(formula: string, dr: number, dc: number): string {
    const a = this.parseCached(formula);
    if (a instanceof Error) return formula;
    const moved = mapRefs(a, (r) => {
      const row = r.absRow ? r.row : r.row + dr, col = r.absCol ? r.col : r.col + dc;
      return row < 1 || col < 1 || row > MAX_ROWS || col > MAX_COLS ? null : { ...r, row, col };
    });
    return '=' + stringify(moved);
  }

  /**
   * Linhas/colunas inseridas (count > 0) ou excluídas (count < 0) a partir de `at` numa planilha: corrige as
   * referências de todas as fórmulas (de todas as planilhas), dos nomes definidos e das fontes dos gráficos.
   */
  adjustReferences(sheetId: string, axis: 'row' | 'col', at: number, count: number) {
    const sheet = this.e.get(sheetId);
    const fix = (r: RefPart): RefPart | null => {
      const v = axis === 'row' ? r.row : r.col;
      if (count > 0) return v >= at ? { ...r, [axis]: v + count } : r;
      const gone = -count;
      if (v >= at && v < at + gone) return null;
      return v >= at + gone ? { ...r, [axis]: v - gone } : r;
    };
    /** intervalo: as pontas encolhem em vez de virar #REF! (só some se o intervalo inteiro foi excluído) */
    const fixRange = (s: RefPart, e: RefPart): [RefPart, RefPart] | null => {
      if (count > 0) return [fix(s)!, fix(e)!];
      const gone = -count, lo = at, hi = at + gone - 1;
      const a = axis === 'row' ? s.row : s.col, b = axis === 'row' ? e.row : e.col;
      const min = Math.min(a, b), max = Math.max(a, b);
      if (min >= lo && max <= hi) return null;
      const nmin = min > hi ? min - gone : min >= lo ? lo : min;
      const nmax = max > hi ? max - gone : max >= lo ? lo - 1 : max;
      return [{ ...s, [axis]: nmin }, { ...e, [axis]: nmax }];
    };
    const rewrite = (formula: string, homeSheet: string) => {
      const a = this.parseCached(formula);
      if (a instanceof Error) return formula;
      const touches = (name: string | null) => (name === null ? homeSheet === sheetId : this.sheetByName(name)?.id === sheetId);
      const walk = (x: Ast): Ast => {
        if (x.k === 'ref' && touches(x.sheet)) { const r = fix(x); return r ? { k: 'ref', sheet: x.sheet, ...r } : { k: 'err', code: '#REF!' }; }
        if (x.k === 'range' && touches(x.sheet)) { const r = fixRange(x.start, x.end); return r ? { ...x, start: r[0], end: r[1] } : { k: 'err', code: '#REF!' }; }
        if (x.k === 'call') return { ...x, args: x.args.map(walk) };
        if (x.k === 'un' || x.k === 'pct') return { ...x, arg: walk(x.arg) };
        if (x.k === 'bin') return { ...x, left: walk(x.left), right: walk(x.right) };
        return x;
      };
      return '=' + stringify(walk(a));
    };
    for (const s of this.sheets()) {
      for (const [addr, c] of Object.entries<SheetCell>(s.data.cells ?? {})) {
        if (!c.formula) continue;
        const next = rewrite(c.formula, s.id);
        if (next !== c.formula) this.e.touchNode(s.id).data.cells[addr].formula = next;
      }
    }
    // nomes definidos (sempre com a planilha explícita: "Planilha1!A1:B5")
    const names = this.e.doc.document.settings.names ?? {};
    for (const [name, target] of Object.entries(names)) {
      const next = rewrite(target, '').replace(/^=/, '');
      if (next !== target.replace(/^=/, '')) (this.e.touch('document', 'info') as any).settings.names[name] = next;
    }
    // gráficos ligados a um intervalo desta planilha
    for (const n of Object.values(this.e.doc.nodes)) {
      const src = n.type === 'CHART' ? n.data.source : null;
      if (src?.type !== 'RANGE' || src.targetId !== sheetId) continue;
      const next = rewrite(`=${src.range}`, sheetId).replace(/^=/, '');
      if (next !== src.range) this.e.touchNode(n.id).data.source.range = next.includes('#REF!') ? src.range : next;
    }
    return sheet.id;
  }
}

export interface Rect { r1: number; c1: number; r2: number; c2: number }

/**
 * Células recortadas e coladas em outro lugar: as fórmulas que apontavam para elas passam a apontar para o destino
 * (como nas planilhas). Referências e intervalos totalmente dentro do bloco movido acompanham; os outros ficam.
 */
export function moveReferences(fs: FormulaService, e: Engine, srcSheetId: string, rect: Rect, destSheetId: string, dr: number, dc: number) {
  const destName = String(e.get(destSheetId).data.name);
  const inside = (r: RefPart) => r.row >= rect.r1 && r.row <= rect.r2 && r.col >= rect.c1 && r.col <= rect.c2;
  for (const s of fs.sheets()) {
    for (const [addr, c] of Object.entries<SheetCell>(s.data.cells ?? {})) {
      if (!c.formula) continue;
      const a = fs.parseCached(c.formula);
      if (a instanceof Error) continue;
      const points = (name: string | null) => (name === null ? s.id === srcSheetId : fs.sheetByName(name)?.id === srcSheetId);
      const sheetFor = (name: string | null) => (destSheetId === srcSheetId ? name : s.id === destSheetId ? null : destName);
      let changed = false;
      const walk = (x: Ast): Ast => {
        if (x.k === 'ref' && points(x.sheet) && inside(x)) { changed = true; return { ...x, sheet: sheetFor(x.sheet), row: x.row + dr, col: x.col + dc }; }
        if (x.k === 'range' && points(x.sheet) && inside(x.start) && inside(x.end)) { changed = true; return { ...x, sheet: sheetFor(x.sheet), start: { ...x.start, row: x.start.row + dr, col: x.start.col + dc }, end: { ...x.end, row: x.end.row + dr, col: x.end.col + dc } }; }
        if (x.k === 'call') return { ...x, args: x.args.map(walk) };
        if (x.k === 'un' || x.k === 'pct') return { ...x, arg: walk(x.arg) };
        if (x.k === 'bin') return { ...x, left: walk(x.left), right: walk(x.right) };
        return x;
      };
      const next = walk(a);
      if (changed) e.touchNode(s.id).data.cells[addr].formula = '=' + stringify(next);
    }
  }
}

/** Serviço de fórmulas do engine (criado na primeira vez que alguém precisa). */
export function formulas(e: Engine): FormulaService {
  return (e.services.formulas ??= new FormulaService(e));
}

export { parseRange };
