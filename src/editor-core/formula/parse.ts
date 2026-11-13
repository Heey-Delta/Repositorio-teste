// Interpretação de fórmulas: endereços (A1), análise léxica (tokens), análise sintática (AST) e o caminho de volta
// (AST → texto), usado ao copiar fórmulas e ao inserir/excluir linhas e colunas.
//
//   "=A1+A2*2"  →  tokens: A1 · + · A2 · * · 2  →  AST: bin(+, ref A1, bin(*, ref A2, num 2))
//
// Precedência (igual à do Excel): referência/intervalo → sinal (-) → % → ^ → * / → + - → & → comparações.
// Separador de argumentos: ";" (padrão brasileiro) ou ",". Casa decimal: ponto. A fórmula nunca é executada como código.

// ---------------------------------------------------------------- endereços

export const colToIndex = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export function indexToCol(n: number) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

export interface CellPos { row: number; col: number }
export const toAddress = (p: CellPos) => `${indexToCol(p.col)}${p.row}`;
export function parseAddress(a: string): CellPos {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a.trim());
  if (!m || Number(m[2]) < 1) throw new Error(`Endereço inválido: ${a}`);
  return { col: colToIndex(m[1]), row: Number(m[2]) };
}
/** "A1:B3" → canto superior esquerdo e inferior direito (normalizados). */
export function parseRange(r: string) {
  const [a, b = a] = r.split(':');
  const p = parseAddress(a), q = parseAddress(b);
  return { r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col) };
}
export const MAX_ROWS = 1_048_576, MAX_COLS = 16_384;

// ---------------------------------------------------------------- AST

export interface RefPart { col: number; row: number; absCol: boolean; absRow: boolean }
export type Ast =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'err'; code: string }
  | ({ k: 'ref'; sheet: string | null } & RefPart)
  | { k: 'range'; sheet: string | null; start: RefPart; end: RefPart }
  | { k: 'name'; name: string }
  | { k: 'call'; name: string; args: Ast[] }
  | { k: 'un'; op: '-' | '+'; arg: Ast }
  | { k: 'pct'; arg: Ast }
  | { k: 'bin'; op: string; left: Ast; right: Ast }
  /** valor já calculado (parâmetro de função do usuário); não vem do texto da fórmula */
  | { k: 'val'; v: unknown };

export class FormulaSyntaxError extends Error {}

// ---------------------------------------------------------------- lexer

type Tok =
  | { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'bool'; v: boolean } | { t: 'err'; v: string }
  | { t: 'ref'; sheet: string | null; a: RefPart; b?: RefPart } | { t: 'name'; v: string } | { t: 'func'; v: string }
  | { t: 'op'; v: string } | { t: '(' } | { t: ')' } | { t: 'sep' };

const IDENT = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_.]*/;
const REF = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
const ERRORS = ['#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#N/A', '#NUM!', '#NULL!', '#CYCLE!', '#ERROR!'];
const BOOLS: Record<string, boolean> = { TRUE: true, FALSE: false, VERDADEIRO: true, FALSO: false };

function refPart(s: string): RefPart | null {
  const m = REF.exec(s);
  if (!m) return null;
  const col = colToIndex(m[2]), row = Number(m[4]);
  if (col > MAX_COLS || row < 1 || row > MAX_ROWS) return null;
  return { col, row, absCol: m[1] === '$', absRow: m[3] === '$' };
}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let v = '', j = i + 1;
      for (;;) {
        if (j >= s.length) throw new FormulaSyntaxError('Texto sem aspas de fechamento.');
        if (s[j] === '"') { if (s[j + 1] === '"') { v += '"'; j += 2; continue; } break; }
        v += s[j++];
      }
      out.push({ t: 'str', v }); i = j + 1; continue;
    }
    if (ch === '#') {
      const e = ERRORS.find((x) => s.slice(i, i + x.length).toUpperCase() === x);
      if (!e) throw new FormulaSyntaxError(`Erro desconhecido em "${s.slice(i, i + 8)}".`);
      out.push({ t: 'err', v: e }); i += e.length; continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
    if (num && !/^[A-Za-z$]/.test(s[i])) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    // planilha com espaço no nome: 'Minha planilha'!A1
    let sheet: string | null = null, rest = s.slice(i);
    const quoted = /^'((?:[^']|'')+)'!/.exec(rest);
    if (quoted) { sheet = quoted[1].replace(/''/g, "'"); i += quoted[0].length; rest = s.slice(i); }
    const id = /^\$?[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_.$]*/.exec(rest);
    if (id) {
      let word = id[0];
      let j = i + word.length;
      if (!sheet && s[j] === '!') {   // Planilha2!A1
        sheet = word; i = j + 1;
        const r2 = /^\$?[A-Za-z]{1,3}\$?\d+/.exec(s.slice(i));
        if (!r2) throw new FormulaSyntaxError(`Referência inválida depois de ${sheet}!`);
        word = r2[0]; j = i + word.length;
      }
      const after = s.slice(j).match(/^\s*/)![0].length + j;
      if (!sheet && s[after] === '(' && IDENT.test(word)) { out.push({ t: 'func', v: word }); i = j; continue; }
      const a = refPart(word);
      if (a) {
        const tail = /^:(\$?[A-Za-z]{1,3}\$?\d+)/.exec(s.slice(j));
        const b = tail ? refPart(tail[1]) : null;
        if (tail && !b) throw new FormulaSyntaxError('Intervalo inválido.');
        out.push({ t: 'ref', sheet, a, ...(b ? { b } : {}) });
        i = j + (tail ? tail[0].length : 0); continue;
      }
      if (sheet) throw new FormulaSyntaxError(`Referência inválida: ${word}.`);
      if (word.toUpperCase() in BOOLS) { out.push({ t: 'bool', v: BOOLS[word.toUpperCase()] }); i = j; continue; }
      if (!IDENT.test(word)) throw new FormulaSyntaxError(`Nome inválido: ${word}.`);
      out.push({ t: 'name', v: word }); i = j; continue;
    }
    const two = s.slice(i, i + 2);
    if (['<>', '<=', '>='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>%'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    if (ch === '(') { out.push({ t: '(' }); i++; continue; }
    if (ch === ')') { out.push({ t: ')' }); i++; continue; }
    if (ch === ';' || ch === ',') { out.push({ t: 'sep' }); i++; continue; }
    throw new FormulaSyntaxError(`Caractere inesperado: "${ch}".`);
  }
  return out;
}

// ---------------------------------------------------------------- parser (descida recursiva)

const COMPARE = ['=', '<>', '<', '>', '<=', '>='];

export function parse(formula: string): Ast {
  const src = formula.trim().replace(/^=/, '');
  if (!src) throw new FormulaSyntaxError('Fórmula vazia.');
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (...ops: string[]) => peek()?.t === 'op' && ops.includes((peek() as any).v);
  const take = () => toks[p++];

  const comparison = (): Ast => { let l = concat(); while (isOp(...COMPARE)) { const op = (take() as any).v; l = { k: 'bin', op, left: l, right: concat() }; } return l; };
  const concat = (): Ast => { let l = additive(); while (isOp('&')) { take(); l = { k: 'bin', op: '&', left: l, right: additive() }; } return l; };
  const additive = (): Ast => { let l = mult(); while (isOp('+', '-')) { const op = (take() as any).v; l = { k: 'bin', op, left: l, right: mult() }; } return l; };
  const mult = (): Ast => { let l = power(); while (isOp('*', '/')) { const op = (take() as any).v; l = { k: 'bin', op, left: l, right: power() }; } return l; };
  const power = (): Ast => { let l = percent(); while (isOp('^')) { take(); l = { k: 'bin', op: '^', left: l, right: percent() }; } return l; };
  const percent = (): Ast => { let a = unary(); while (isOp('%')) { take(); a = { k: 'pct', arg: a }; } return a; };
  const unary = (): Ast => { if (isOp('-', '+')) { const op = (take() as any).v; return { k: 'un', op, arg: unary() }; } return primary(); };
  const primary = (): Ast => {
    const t = take();
    if (!t) throw new FormulaSyntaxError('A fórmula terminou antes do esperado.');
    switch (t.t) {
      case 'num': return { k: 'num', v: t.v };
      case 'str': return { k: 'str', v: t.v };
      case 'bool': return { k: 'bool', v: t.v };
      case 'err': return { k: 'err', code: t.v };
      case 'name': return { k: 'name', name: t.v };
      case 'ref': return t.b ? { k: 'range', sheet: t.sheet, start: t.a, end: t.b } : { k: 'ref', sheet: t.sheet, ...t.a };
      case '(': { const e = comparison(); if (take()?.t !== ')') throw new FormulaSyntaxError('Falta fechar parênteses.'); return e; }
      case 'func': {
        if (take()?.t !== '(') throw new FormulaSyntaxError(`Faltam os parênteses de ${t.v}.`);
        const args: Ast[] = [];
        if (peek()?.t === ')') { take(); return { k: 'call', name: t.v, args }; }
        for (;;) {
          args.push(peek()?.t === 'sep' || peek()?.t === ')' ? { k: 'str', v: '' } : comparison());   // argumento vazio: SE(A1;;2)
          const n = take();
          if (n?.t === ')') break;
          if (n?.t !== 'sep') throw new FormulaSyntaxError(`Esperava ";" ou ")" em ${t.v}.`);
        }
        return { k: 'call', name: t.v, args };
      }
      default: throw new FormulaSyntaxError('Expressão inválida.');
    }
  };
  const ast = comparison();
  if (p < toks.length) throw new FormulaSyntaxError('Sobrou algo depois do fim da expressão.');
  return ast;
}

// ---------------------------------------------------------------- AST → texto

const quoteSheet = (s: string | null) => (s === null ? '' : /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_.]*$/.test(s) ? `${s}!` : `'${s.replace(/'/g, "''")}'!`);
export const refText = (r: RefPart) => `${r.absCol ? '$' : ''}${indexToCol(r.col)}${r.absRow ? '$' : ''}${r.row}`;

const PREC: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

export function stringify(a: Ast, sep = ';'): string {
  const wrap = (x: Ast, min: number) => { const s = stringify(x, sep); return x.k === 'bin' && PREC[x.op] < min ? `(${s})` : s; };
  switch (a.k) {
    case 'num': return String(a.v);
    case 'str': return `"${a.v.replace(/"/g, '""')}"`;
    case 'bool': return a.v ? 'VERDADEIRO' : 'FALSO';
    case 'err': return a.code;
    case 'name': return a.name;
    case 'ref': return quoteSheet(a.sheet) + refText(a);
    case 'range': return `${quoteSheet(a.sheet)}${refText(a.start)}:${refText(a.end)}`;
    case 'call': return `${a.name}(${a.args.map((x) => stringify(x, sep)).join(sep)})`;
    case 'val': return String(a.v);
    case 'un': return `${a.op}${wrap(a.arg, 6)}`;
    case 'pct': return `${wrap(a.arg, 6)}%`;
    case 'bin': {
      const pr = PREC[a.op];
      // lado direito com a mesma precedência precisa de parênteses (a-(b-c))
      const right = a.right.k === 'bin' && PREC[a.right.op] <= pr ? `(${stringify(a.right, sep)})` : wrap(a.right, pr);
      return `${wrap(a.left, pr)}${a.op}${right}`;
    }
  }
}

/** Percorre a AST trocando referências (para copiar fórmula ou inserir/excluir linhas). `null` = #REF!. */
export function mapRefs(a: Ast, fn: (r: RefPart, sheet: string | null) => RefPart | null): Ast {
  switch (a.k) {
    case 'ref': { const r = fn(a, a.sheet); return r ? { k: 'ref', sheet: a.sheet, ...r } : { k: 'err', code: '#REF!' }; }
    case 'range': {
      const s = fn(a.start, a.sheet), e = fn(a.end, a.sheet);
      return s && e ? { k: 'range', sheet: a.sheet, start: s, end: e } : { k: 'err', code: '#REF!' };
    }
    case 'call': return { ...a, args: a.args.map((x) => mapRefs(x, fn)) };
    case 'un': case 'pct': return { ...a, arg: mapRefs(a.arg, fn) };
    case 'bin': return { ...a, left: mapRefs(a.left, fn), right: mapRefs(a.right, fn) };
    default: return a;
  }
}

/** Referências usadas pela fórmula (células, intervalos e nomes). */
export function collectRefs(a: Ast, out: Ast[] = []): Ast[] {
  if (a.k === 'ref' || a.k === 'range' || a.k === 'name') out.push(a);
  else if (a.k === 'call') a.args.forEach((x) => collectRefs(x, out));
  else if (a.k === 'un' || a.k === 'pct') collectRefs(a.arg, out);
  else if (a.k === 'bin') { collectRefs(a.left, out); collectRefs(a.right, out); }
  return out;
}

export const usesVolatile = (a: Ast): boolean =>
  a.k === 'call' ? ['HOJE', 'AGORA', 'TODAY', 'NOW', 'ALEATORIO', 'ALEATÓRIO', 'RAND'].includes(a.name.toUpperCase()) || a.args.some(usesVolatile)
    : a.k === 'un' || a.k === 'pct' ? usesVolatile(a.arg) : a.k === 'bin' ? usesVolatile(a.left) || usesVolatile(a.right) : false;
