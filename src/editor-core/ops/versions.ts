// Comparar versões e recuperação (F14.06, F14.08).
//
//   Comparar: diferença entre duas versões (ou entre uma versão e o documento atual) — elementos criados, excluídos,
//   alterados e movidos; em texto, diferença por palavra; em tabelas e planilhas, por célula.
//   Recuperar: o diário (Journal) guarda cada alteração aplicada desde a última versão; com a versão + o diário dá
//   para reconstruir o documento depois de uma queda. EXPORT_STATE/RECOVER levam a sessão inteira (documento,
//   versões, histórico). CHECK_INTEGRITY/REPAIR_DOCUMENT acham e consertam árvores quebradas.
import type { Change, DocumentModel, EditorNode, Transaction } from '../types.ts';
import type { Engine, Handler, Snapshot } from '../engine.ts';
import { canContain } from '../schema.ts';
import { textOf } from './text.ts';
import { clone, equal, fail, merge3 } from '../util.ts';

// ---------------------------------------------------------------- diferença de texto (por palavra)

export interface TextPart { op: 'EQUAL' | 'INSERT' | 'DELETE'; text: string }

export function diffText(a: string, b: string): TextPart[] {
  if (a === b) return a ? [{ op: 'EQUAL', text: a }] : [];
  const tok = (t: string) => t.match(/\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}]/gu) ?? [];   // palavras, espaços e cada pontuação
  const A = tok(a), B = tok(b);
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let s = 0;
  while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
  const x = A.slice(p, A.length - s), y = B.slice(p, B.length - s);
  const parts: TextPart[] = [];
  const push = (op: TextPart['op'], text: string) => { if (!text) return; const last = parts.at(-1); if (last?.op === op) last.text += text; else parts.push({ op, text }); };
  push('EQUAL', A.slice(0, p).join(''));
  if (x.length * y.length > 4_000_000) { push('DELETE', x.join('')); push('INSERT', y.join('')); }   // texto enorme: troca o miolo inteiro
  else {
    // maior subsequência comum (programação dinâmica) sobre as palavras do miolo
    const L = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) { push('EQUAL', x[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) push('DELETE', x[i++]);
      else push('INSERT', y[j++]);
    }
    while (i < x.length) push('DELETE', x[i++]);
    while (j < y.length) push('INSERT', y[j++]);
  }
  push('EQUAL', A.slice(A.length - s).join(''));
  return parts;
}

// ---------------------------------------------------------------- diferença de documentos

export interface NodeDiff {
  nodeId: string; type: string; kind: 'INSERTED' | 'DELETED' | 'MODIFIED' | 'MOVED'; label: string;
  fields: string[]; text?: TextPart[]; cells?: { cell: string; before: unknown; after: unknown }[];
}

const label = (n: EditorNode) => { const t = Array.isArray(n.data.runs) ? textOf(n) : String(n.data.name ?? n.data.title ?? ''); return t.length > 60 ? t.slice(0, 57) + '…' : t; };

function changedFields(a: EditorNode, b: EditorNode): string[] {
  const out: string[] = [];
  for (const k of ['styleId', 'styleOverrides', 'layout', 'metadata'] as const) if (!equal(a[k], b[k])) out.push(k);
  for (const k of new Set([...Object.keys(a.data), ...Object.keys(b.data)])) if (!equal(a.data[k], b.data[k])) out.push(`data.${k}`);
  if (!equal(a.children, b.children)) out.push('children');
  return out;
}

function cellDiff(a: EditorNode, b: EditorNode) {
  const out: { cell: string; before: unknown; after: unknown }[] = [];
  const show = (c: any) => (c ? c.formula ?? c.value ?? null : null);
  if (a.data.surfaceType === 'SHEET') {
    for (const k of new Set([...Object.keys(a.data.cells ?? {}), ...Object.keys(b.data.cells ?? {})])) {
      const x = show(a.data.cells?.[k]), y = show(b.data.cells?.[k]);
      if (!equal(x, y)) out.push({ cell: k, before: x, after: y });
    }
  } else if (a.type === 'TABLE') {
    const flat = (n: EditorNode) => new Map<string, unknown>((n.data.rows ?? []).flatMap((r: any, i: number) => r.cells.map((c: any, j: number) => [`${String.fromCharCode(65 + j)}${i + 1}`, show(c)])));
    const x = flat(a), y = flat(b);
    for (const k of new Set([...x.keys(), ...y.keys()])) if (!equal(x.get(k) ?? null, y.get(k) ?? null)) out.push({ cell: k, before: x.get(k) ?? null, after: y.get(k) ?? null });
  }
  return out.sort((p, q) => p.cell.localeCompare(q.cell, 'en', { numeric: true }));
}

/** Diferença entre dois documentos (a = antes, b = depois), na ordem em que os elementos aparecem. */
export function diffDocuments(a: DocumentModel, b: DocumentModel) {
  const order = (d: DocumentModel) => { const out: string[] = []; const walk = (id: string) => { const n = d.nodes[id]; if (!n) return; out.push(id); n.children.forEach(walk); }; walk(d.document.rootId); return out; };
  const ids = [...new Set([...order(b), ...order(a), ...Object.keys(b.nodes), ...Object.keys(a.nodes)])];
  const nodes: NodeDiff[] = [];
  for (const id of ids) {
    const x = a.nodes[id], y = b.nodes[id];
    if (equal(x, y)) continue;
    if (!x) { nodes.push({ nodeId: id, type: y.type, kind: 'INSERTED', label: label(y), fields: [], ...(Array.isArray(y.data.runs) ? { text: diffText('', textOf(y)) } : {}) }); continue; }
    if (!y) { nodes.push({ nodeId: id, type: x.type, kind: 'DELETED', label: label(x), fields: [], ...(Array.isArray(x.data.runs) ? { text: diffText(textOf(x), '') } : {}) }); continue; }
    const fields = changedFields(x, y);
    const moved = x.parentId !== y.parentId || x.order !== y.order;
    if (!fields.length && !moved) continue;
    const content = fields.filter((f) => f !== 'children');
    if (!content.length && !moved) continue;   // só a lista de filhos mudou: os filhos já aparecem
    const d: NodeDiff = { nodeId: id, type: y.type, kind: content.length ? 'MODIFIED' : 'MOVED', label: label(y), fields: moved ? [...content, 'position'] : content };
    if (content.includes('data.runs')) d.text = diffText(textOf(x), textOf(y));
    const cells = content.some((f) => f === 'data.cells' || f === 'data.rows') ? cellDiff(x, y) : [];
    if (cells.length) d.cells = cells;
    nodes.push(d);
  }
  const named = <T>(col: 'styles' | 'themes') => {
    const A = a[col] as Record<string, T>, B = b[col] as Record<string, T>;
    return [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((k) => !equal(A[k], B[k])).map((k) => ({ id: k, kind: !A[k] ? 'INSERTED' : !B[k] ? 'DELETED' : 'MODIFIED' }));
  };
  const settings = [...new Set([...Object.keys(a.document.settings), ...Object.keys(b.document.settings)])].filter((k) => !equal(a.document.settings[k], b.document.settings[k]));
  const count = (k: NodeDiff['kind']) => nodes.filter((n) => n.kind === k).length;
  return {
    summary: { inserted: count('INSERTED'), deleted: count('DELETED'), modified: count('MODIFIED'), moved: count('MOVED'), styles: named('styles').length, themes: named('themes').length },
    nodes, styles: named('styles'), themes: named('themes'),
    document: { ...(a.document.name !== b.document.name ? { name: { before: a.document.name, after: b.document.name } } : {}), ...(a.document.themeId !== b.document.themeId ? { themeId: { before: a.document.themeId, after: b.document.themeId } } : {}), settings },
    comments: { before: Object.keys(a.comments ?? {}).length, after: Object.keys(b.comments ?? {}).length },
  };
}

// ---------------------------------------------------------------- integridade

export interface IntegrityProblem { code: string; nodeId?: string; message: string }

export function checkIntegrity(doc: DocumentModel): IntegrityProblem[] {
  const out: IntegrityProblem[] = [];
  const root = doc.nodes[doc.document.rootId];
  if (!root) return [{ code: 'MISSING_ROOT', message: 'O documento não tem raiz.' }];
  if (root.parentId) out.push({ code: 'ROOT_HAS_PARENT', nodeId: root.id, message: 'A raiz aponta para um pai.' });
  const reached = new Set<string>();
  const walk = (id: string, path: Set<string>) => {
    const n = doc.nodes[id];
    if (path.has(id)) { out.push({ code: 'CYCLE', nodeId: id, message: `${id} está dentro de si mesmo.` }); return; }
    if (reached.has(id)) { out.push({ code: 'DUPLICATE_CHILD', nodeId: id, message: `${id} aparece em mais de um lugar.` }); return; }
    reached.add(id);
    const seen = new Set<string>();
    n.children.forEach((c, i) => {
      const child = doc.nodes[c];
      if (!child) { out.push({ code: 'MISSING_CHILD', nodeId: id, message: `${id} lista o filho ${c}, que não existe.` }); return; }
      if (seen.has(c)) { out.push({ code: 'DUPLICATE_CHILD', nodeId: c, message: `${c} aparece duas vezes em ${id}.` }); return; }
      seen.add(c);
      if (child.parentId !== id) out.push({ code: 'WRONG_PARENT', nodeId: c, message: `${c} está em ${id}, mas aponta para ${child.parentId}.` });
      if (child.order !== i) out.push({ code: 'WRONG_ORDER', nodeId: c, message: `Ordem de ${c} é ${child.order}, deveria ser ${i}.` });
      if (!canContain(n.type, child.type)) out.push({ code: 'INVALID_NESTING', nodeId: c, message: `${n.type} não pode conter ${child.type}.` });
      walk(c, new Set([...path, id]));
    });
  };
  walk(root.id, new Set());
  for (const id of Object.keys(doc.nodes)) {
    if (!reached.has(id)) out.push({ code: 'ORPHAN', nodeId: id, message: `${id} não está ligado à árvore do documento.` });
    if (doc.nodes[id].id !== id) out.push({ code: 'WRONG_ID', nodeId: id, message: `O nó guardado em ${id} diz ser ${doc.nodes[id].id}.` });
  }
  return out;
}

// ---------------------------------------------------------------- diário e recuperação

export interface JournalEntry { seq: number; source: string; transactionId: string; userId?: string; timestamp: number; changes: Change[] }

/** Registra cada alteração aplicada (local, desfazer/refazer, remota) desde a última versão. */
export class Journal {
  base: DocumentModel;
  baseLabel = 'Início';
  entries: JournalEntry[] = [];
  private seq = 0;
  private off: () => void;
  engine: Engine;
  constructor(engine: Engine) {
    this.engine = engine;
    this.base = clone(engine.doc);
    this.off = engine.on('change', (ev: { transaction: Transaction; source: string; applied?: Change[] }) => {
      const changes = ev.source === 'undo' || ev.source === 'redo' ? ev.applied : ev.transaction.changes;
      if (!changes?.length) return;
      this.entries.push({ seq: ++this.seq, source: ev.source, transactionId: ev.transaction.id, userId: ev.transaction.userId, timestamp: ev.transaction.timestamp, changes: clone(changes) });
    });
  }
  /** Nova base (ex.: depois de salvar uma versão no banco): o diário recomeça. */
  checkpoint(label = 'Versão') { this.base = clone(this.engine.doc); this.baseLabel = label; this.entries = []; }
  export() { return { format: 'hallan-editor-journal', version: 1, baseLabel: this.baseLabel, base: clone(this.base), entries: clone(this.entries) }; }
  close() { this.off(); }
}

/** Reconstrói o documento: base + alterações em ordem. Se algo não bate, mescla e avisa (não para no meio). */
export function rebuild(base: DocumentModel, entries: { changes: Change[] }[]) {
  const doc = clone(base);
  const warnings: string[] = [];
  const col = (c: Change) => ((doc as any)[c.collection] ??= {}) as Record<string, unknown>;
  for (const [i, en] of entries.entries()) for (const c of en.changes) {
    const current = c.collection === 'document' ? doc.document : col(c)[c.id] ?? null;
    let value = c.after;
    if (!equal(current, c.before) && !equal(current, c.after)) {
      warnings.push(`Entrada ${i + 1}: ${c.collection}/${c.id} não estava como esperado; alterações mescladas.`);
      if (current !== null && c.before !== null && c.after !== null) value = merge3(c.before, current, c.after).value;
    }
    if (c.collection === 'document') doc.document = { ...(clone(value) as DocumentModel['document']), seq: Math.max(doc.document.seq, (value as any).seq ?? 0) };
    else if (value === null) delete col(c)[c.id];
    else col(c)[c.id] = clone(value);
  }
  return { doc, warnings, problems: checkIntegrity(doc) };
}

// ---------------------------------------------------------------- operações

const versionDoc = (e: Engine, id: string): { doc: DocumentModel; label: string } => {
  if (id === 'CURRENT') return { doc: e.doc, label: 'Atual' };
  const s: Snapshot | undefined = e.snapshots.find((x) => x.id === id);
  if (!s) fail('NOT_FOUND', `Versão ${id} não existe.`);
  return { doc: s!.doc, label: s!.label };
};

export const versionHandlers: Record<string, Handler> = {
  /** COMPARE_VERSIONS { fromId, toId? ('CURRENT') } */
  COMPARE_VERSIONS: (e, op) => {
    const p = op.payload ?? {};
    if (!p.fromId) fail('INVALID_PAYLOAD', 'Informe fromId (versão) e, se quiser, toId.');
    const from = versionDoc(e, p.fromId), to = versionDoc(e, p.toId ?? 'CURRENT');
    return { from: { id: p.fromId, label: from.label }, to: { id: p.toId ?? 'CURRENT', label: to.label }, ...diffDocuments(from.doc, to.doc) };
  },
  /** Estado completo da sessão (para salvar e recuperar depois de uma queda). */
  EXPORT_STATE: (e) => ({ format: 'hallan-editor-state', version: 1, savedAt: new Date().toISOString(), doc: clone(e.doc), snapshots: clone(e.snapshots), history: clone(e.history) }),
  /**
   * RECOVER { state } | { base, entries } — volta a sessão a um estado salvo, ou reconstrói pelo diário.
   * Troca o documento inteiro (não dá para desfazer); o que estiver quebrado na árvore é consertado.
   */
  RECOVER: (e, op) => {
    const p = op.payload ?? {};
    let doc: DocumentModel, warnings: string[] = [];
    if (p.state) {
      if (p.state.format !== 'hallan-editor-state' || !p.state.doc?.nodes) fail('VALIDATION', 'Arquivo de recuperação inválido.');
      doc = clone(p.state.doc);
    } else if (p.base) {
      const r = rebuild(p.base, p.entries ?? []);
      doc = r.doc; warnings = r.warnings;
    } else return fail('INVALID_PAYLOAD', 'Informe state (EXPORT_STATE) ou base + entries (diário).');
    const repaired = repair(doc);
    if (repaired.problems.some((x) => x.code === 'MISSING_ROOT')) fail('INTEGRITY', 'Não foi possível recuperar: o documento não tem raiz.');
    e.doc = repaired.doc;
    if (p.state) { e.snapshots = clone(p.state.snapshots ?? []); e.history = clone(p.state.history ?? { past: [], future: [], limit: e.history.limit }); }
    else { e.history = { past: [], future: [], limit: e.history.limit }; }
    e.state.selection = { selectedIds: [], primaryId: null, mode: 'NONE' };
    const surface = Object.values(e.doc.nodes).find((n) => n.type === 'SURFACE' || (n.type === 'BLOCK' && n.parentId === e.doc.document.rootId));
    e.state.activeSurface = surface?.id ?? null;
    e.emit('change', { transaction: { id: 'RECOVER', type: 'RECOVER', label: 'Recuperar', changes: [], timestamp: Date.now() }, source: 'recover' });
    return { warnings, repaired: repaired.fixed };
  },
  CHECK_INTEGRITY: (e) => checkIntegrity(e.doc),
  /** Conserta a árvore numa transação (dá para desfazer). */
  REPAIR_DOCUMENT: (e) => {
    const r = repair(clone(e.doc));
    for (const id of new Set([...Object.keys(e.doc.nodes), ...Object.keys(r.doc.nodes)])) {
      if (equal(e.doc.nodes[id], r.doc.nodes[id])) continue;
      if (!r.doc.nodes[id]) e.del('nodes', id); else e.put('nodes', id, r.doc.nodes[id]);
    }
    return r.fixed;
  },
};

/** Conserta: filhos inexistentes ou repetidos saem; pai e ordem são acertados; órfãos voltam para o fim da raiz. */
export function repair(doc: DocumentModel) {
  const problems = checkIntegrity(doc);
  const fixed: string[] = [];
  const root = doc.nodes[doc.document.rootId];
  if (!root) return { doc, problems, fixed };
  if (root.parentId) { root.parentId = null; fixed.push('ROOT_HAS_PARENT'); }
  const placed = new Set<string>([root.id]);
  const walk = (id: string) => {
    const n = doc.nodes[id];
    const kept: string[] = [];
    for (const c of n.children) {
      const child = doc.nodes[c];
      if (!child || placed.has(c)) { fixed.push(`${!child ? 'MISSING_CHILD' : 'DUPLICATE_CHILD'}:${c}`); continue; }
      placed.add(c);
      kept.push(c);
    }
    n.children = kept;
    kept.forEach((c, i) => { const ch = doc.nodes[c]; if (ch.parentId !== id || ch.order !== i) { ch.parentId = id; ch.order = i; fixed.push(`POSITION:${c}`); } walk(c); });
  };
  walk(root.id);
  // órfãos (só os do topo; os filhos vêm junto): o pai, se aceitar o tipo; senão a raiz ou uma área dela; senão saem
  for (const id of Object.keys(doc.nodes)) {
    if (placed.has(id)) continue;
    const n = doc.nodes[id];
    const parent = n.parentId ? doc.nodes[n.parentId] : undefined;
    if (parent && !placed.has(parent.id)) continue;
    const host = [parent, root, ...root.children.map((c) => doc.nodes[c])].find((h) => h && placed.has(h.id) && canContain(h.type, n.type));
    if (!host) { fixed.push(`REMOVED_ORPHAN:${id}`); continue; }
    host.children.push(id);
    n.parentId = host.id;
    n.order = host.children.length - 1;
    placed.add(id);
    walk(id);
    fixed.push(`REATTACHED:${id}`);
  }
  for (const id of Object.keys(doc.nodes)) if (!placed.has(id)) delete doc.nodes[id];
  return { doc, problems, fixed };
}
