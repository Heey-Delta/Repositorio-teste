// Motor de operações: recebe uma operação, valida, executa dentro de uma transação e registra no histórico.
//
//   INTERFACE → execute(op) → handler do tipo → primitivas (touch/put/del) → TRANSAÇÃO → HISTÓRICO → evento 'change'
//
// Toda alteração passa pelas primitivas, que guardam o estado anterior de cada item na primeira vez que ele é tocado.
// No fim, a transação compara antes × depois: só o que mudou de fato vai para o histórico (sem cópias do documento
// inteiro). Desfazer aplica os "antes"; refazer, os "depois". Uma ação da pessoa = uma transação, mesmo que mexa em
// vários nós (ex.: mudar a cor de três formas). Se algo falhar no meio, tudo o que a operação já tinha mudado volta.
import type { Change, DocumentModel, EditorNode, EditorState, HistoryState, Operation, Transaction, User } from './types.ts';
import { clone, equal, EditorError, fail, merge3 } from './util.ts';
import { nextId } from './document.ts';

export type Handler = (engine: Engine, op: Operation) => unknown;
export type Collection = Change['collection'];
type Listener = (payload: any) => void;
/** Roda antes de gravar a transação (pode lançar erro → tudo volta; pode alterar mais itens). */
export type CommitHook = (engine: Engine, info: { type: string; changes: Change[]; remote: boolean }) => void;

interface OpenTransaction {
  type: string;
  label: string;
  depth: number;
  before: Map<string, { collection: Collection; id: string; before: unknown }>;
  remote: boolean;
  after: (() => void)[];
}

export interface Snapshot { id: string; label: string; timestamp: number; doc: DocumentModel }

export interface EngineOptions { historyLimit?: number; now?: () => number }

export class Engine {
  doc: DocumentModel;
  state: EditorState;
  history: HistoryState;
  snapshots: Snapshot[] = [];
  lastOperation: Operation | null = null;
  /** quem está usando esta sessão (colaboração, permissões, autoria) */
  user: User | null = null;
  /** verificações e complementos antes de gravar (permissões, controle de alterações) */
  commitHooks: CommitHook[] = [];
  /** serviços dos motores especializados (fórmulas, gráficos…), pendurados pelo index */
  services: Record<string, any> = {};
  private handlers: Map<string, Handler>;
  private listeners = new Map<string, Set<Listener>>();
  private tx: OpenTransaction | null = null;
  private now: () => number;

  constructor(doc: DocumentModel, handlers: Record<string, Handler>, options: EngineOptions = {}) {
    this.doc = doc;
    this.handlers = new Map(Object.entries(handlers));
    this.history = { past: [], future: [], limit: options.historyLimit ?? 200 };
    this.now = options.now ?? (() => Date.now());
    const first = doc.nodes[doc.document.rootId]?.children[0] ?? null;
    this.state = {
      selection: { selectedIds: [], primaryId: null, mode: 'NONE' },
      clipboard: null, activeSurface: first, mode: 'EDIT', zoom: 100, activeTool: 'SELECT',
    };
  }

  // ---------------------------------------------------------------- consulta

  find(id: string | null | undefined): EditorNode | undefined { return id ? this.doc.nodes[id] : undefined; }

  get(id: string | null | undefined): EditorNode {
    const n = this.find(id);
    if (!n) fail('NOT_FOUND', `Elemento ${id} não existe.`);
    return n!;
  }

  /** Descendentes de um nó (em profundidade, sem incluir o próprio nó). */
  descendants(id: string): string[] {
    const out: string[] = [];
    const walk = (nid: string) => { for (const c of this.doc.nodes[nid]?.children ?? []) { out.push(c); walk(c); } };
    walk(id);
    return out;
  }

  ancestors(id: string): string[] {
    const out: string[] = [];
    let cur = this.find(id)?.parentId;
    while (cur) { out.push(cur); cur = this.find(cur)?.parentId ?? null; }
    return out;
  }

  /** Bloqueado se o próprio nó ou algum ancestral (ex.: o grupo) estiver bloqueado. */
  isLocked(id: string): boolean {
    return [id, ...this.ancestors(id)].some((nid) => this.find(nid)?.metadata.locked === true);
  }

  assertEditable(id: string) {
    this.get(id);
    if (this.isLocked(id)) fail('LOCKED', `Elemento ${id} está bloqueado. Desbloqueie para alterar.`);
  }

  newId(type: string): string { return nextId(this.doc, type); }

  // ---------------------------------------------------------------- primitivas (só dentro de transação)

  private key(collection: Collection, id: string) { return `${collection}:${id}`; }

  private col(collection: Exclude<Collection, 'document'>): Record<string, unknown> {
    return ((this.doc as any)[collection] ??= {}) as Record<string, unknown>;
  }

  private read(collection: Collection, id: string): unknown {
    if (collection === 'document') return this.doc.document;
    return this.col(collection)[id];
  }

  private write(collection: Collection, id: string, value: unknown) {
    if (collection === 'document') {
      const seq = this.doc.document.seq;   // o contador de IDs nunca volta (evita reaproveitar identificadores)
      this.doc.document = clone(value) as DocumentModel['document'];
      this.doc.document.seq = Math.max(seq, this.doc.document.seq);
      return;
    }
    const col = this.col(collection);
    if (value === null || value === undefined) delete col[id];
    else col[id] = clone(value);
  }

  /** Guarda o estado anterior de um item (uma vez por transação) e devolve o item vivo para alterar. */
  touch(collection: Collection, id: string): any {
    if (!this.tx) fail('INVALID_OPERATION', 'Alteração fora de transação.');
    const k = this.key(collection, id);
    if (!this.tx!.before.has(k)) this.tx!.before.set(k, { collection, id, before: clone(this.read(collection, id)) ?? null });
    return this.read(collection, id);
  }

  touchNode(id: string): EditorNode { this.get(id); return this.touch('nodes', id); }

  put(collection: Collection, id: string, value: unknown) {
    this.touch(collection, id);
    if (collection === 'document') { this.doc.document = value as DocumentModel['document']; return; }
    this.col(collection)[id] = value;
  }

  del(collection: Exclude<Collection, 'document'>, id: string) {
    this.touch(collection, id);
    delete this.col(collection)[id];
  }

  /** O que a transação aberta mudou até agora (antes × depois). */
  pendingChanges(): Change[] {
    if (!this.tx) return [];
    const out: Change[] = [];
    for (const { collection, id, before } of this.tx.before.values()) {
      const after = clone(this.read(collection, id)) ?? null;
      if (!equal(before, after)) out.push({ collection, id, before, after });
    }
    return out;
  }

  /** Marca a transação aberta como vinda de outro colaborador: não entra no desfazer local. */
  markRemote() { if (this.tx) this.tx.remote = true; }

  /** Agenda algo para depois que a transação for gravada (ex.: avisar menções). Descartado se ela falhar. */
  afterCommit(fn: () => void) { if (this.tx) this.tx.after.push(fn); else fn(); }

  /** Reescreve `order` dos filhos conforme a posição na lista do pai. */
  normalizeOrder(parentId: string) {
    const p = this.touchNode(parentId);
    p.children.forEach((cid: string, i: number) => {
      const c = this.doc.nodes[cid];
      if (c && c.order !== i) this.touchNode(cid).order = i;
    });
  }

  // ---------------------------------------------------------------- transações

  /** Executa `fn` como uma única ação. Transações aninhadas entram na de fora. */
  transact<T>(type: string, label: string, fn: () => T): T {
    if (this.tx) {
      this.tx.depth++;
      try { return fn(); } finally { this.tx.depth--; }
    }
    this.tx = { type, label, depth: 0, before: new Map(), remote: false, after: [] };
    try {
      const result = fn();
      if (this.commitHooks.length) {
        const changes = this.pendingChanges();
        if (changes.length) for (const h of this.commitHooks) h(this, { type, changes, remote: this.tx.remote });
      }
      this.commit();
      return result;
    } catch (err) {
      this.rollback();
      throw err;
    }
  }

  private commit() {
    const tx = this.tx!;
    this.tx = null;
    const changes: Change[] = [];
    for (const { collection, id, before } of tx.before.values()) {
      const after = clone(this.read(collection, id)) ?? null;
      if (!equal(before, after)) changes.push({ collection, id, before, after });
    }
    if (!changes.length) { for (const fn of tx.after) fn(); return; }
    const t: Transaction = { id: `TRX_${this.now()}_${this.history.past.length}`, type: tx.type, label: tx.label, changes, timestamp: this.now(), ...(this.user ? { userId: this.user.id } : {}) };
    this.doc.document.updatedAt = new Date(t.timestamp).toISOString();
    if (!tx.remote) {
      this.history.past.push(t);
      if (this.history.past.length > this.history.limit) this.history.past.splice(0, this.history.past.length - this.history.limit);
      this.history.future = [];   // nova alteração depois de desfazer: o "refazer" deixa de valer
    }
    this.emit('change', { transaction: t, source: tx.remote ? 'remote' : 'execute' });
    for (const fn of tx.after) fn();
  }

  private rollback() {
    const tx = this.tx!;
    this.tx = null;
    for (const { collection, id, before } of [...tx.before.values()].reverse()) this.write(collection, id, before);
    this.emit('rollback', { type: tx.type });
  }

  /**
   * Desfazer/refazer: leva cada item de um lado para o outro. Se alguém (outro colaborador) mexeu no item depois,
   * mescla em três vias — volta só o que esta ação mudou e preserva o resto. Devolve o que foi de fato gravado.
   */
  private apply(changes: Change[], side: 'before' | 'after'): Change[] {
    const list = side === 'before' ? [...changes].reverse() : changes;
    const applied: Change[] = [];
    for (const c of list) {
      const target = c[side], expected = side === 'before' ? c.after : c.before;
      const current = clone(this.read(c.collection, c.id)) ?? null;
      let value: unknown = target;
      if (!equal(current, expected)) {
        if (current === null && expected !== null) continue;            // apagado por outra pessoa: nada a desfazer
        if (target !== null && current !== null) value = merge3(expected, current, target).value;
      }
      if (equal(current, value)) continue;
      this.write(c.collection, c.id, value);
      applied.push({ collection: c.collection, id: c.id, before: current, after: clone(value) ?? null });
    }
    return applied;
  }

  undo(): Transaction {
    const t = this.history.past.pop();
    if (!t) fail('NOTHING_TO_UNDO', 'Não há nada para desfazer.');
    const applied = this.apply(t!.changes, 'before');
    this.history.future.push(t!);
    this.cleanSelection();
    this.emit('change', { transaction: t, source: 'undo', applied });
    return t!;
  }

  redo(): Transaction {
    const t = this.history.future.pop();
    if (!t) fail('NOTHING_TO_REDO', 'Não há nada para refazer.');
    const applied = this.apply(t!.changes, 'after');
    this.history.past.push(t!);
    this.cleanSelection();
    this.emit('change', { transaction: t, source: 'redo', applied });
    return t!;
  }

  /** Fotografia completa do documento (versões): base para recuperar sem reaplicar todo o histórico. */
  snapshot(label = 'Versão'): Snapshot {
    const s = { id: `SNAP_${this.snapshots.length + 1}`, label, timestamp: this.now(), doc: clone(this.doc) };
    this.snapshots.push(s);
    return s;
  }

  /** Volta o documento a uma versão: vira uma transação comum (dá para desfazer a restauração). */
  restoreSnapshot(id: string) {
    const s = this.snapshots.find((x) => x.id === id) ?? fail('NOT_FOUND', `Versão ${id} não existe.`);
    this.transact('RESTORE_VERSION', `Restaurar ${s.label}`, () => {
      for (const col of ['nodes', 'styles', 'themes', 'assets'] as const) {
        const now = this.doc[col] as Record<string, unknown>, then = s.doc[col] as Record<string, unknown>;
        for (const id of new Set([...Object.keys(now), ...Object.keys(then)])) {
          if (!equal(now[id], then[id])) { this.touch(col, id); this.write(col, id, then[id] ?? null); }
        }
      }
      this.touch('document', 'info');
      this.write('document', 'info', { ...s.doc.document, seq: this.doc.document.seq });
    });
    this.cleanSelection();
  }

  // ---------------------------------------------------------------- execução

  /** Executa e lança erro se falhar. */
  run<T = any>(op: Operation): T {
    const h = this.handlers.get(op.type);
    if (!h) fail('UNKNOWN_OPERATION', `Operação desconhecida: ${op.type}.`);
    const before = this.history.past.at(-1);
    const result = this.transact(op.type, op.type, () => h!(this, op)) as T;
    // "repetir última ação" lembra só o que alterou o documento (seleção, consultas e desfazer não contam)
    if (!['UNDO', 'REDO', 'REPEAT'].includes(op.type) && this.history.past.at(-1) !== before) this.lastOperation = clone(op);
    return result;
  }

  /** Executa e devolve { ok, value } ou { ok: false, error } (para a interface). */
  execute<T = any>(op: Operation): { ok: true; value: T; error?: undefined } | { ok: false; value?: undefined; error: { code: string; message: string } } {
    try { return { ok: true, value: this.run<T>(op) }; }
    catch (err) {
      if (err instanceof EditorError) return { ok: false, error: { code: err.code, message: err.message } };
      return { ok: false, error: { code: 'INTERNAL', message: (err as Error).message } };
    }
  }

  has(type: string) { return this.handlers.has(type); }
  operations() { return [...this.handlers.keys()].sort(); }

  /** Remove da seleção o que deixou de existir. */
  cleanSelection() {
    const s = this.state.selection;
    s.selectedIds = s.selectedIds.filter((id) => this.doc.nodes[id]);
    if (s.primaryId && !this.doc.nodes[s.primaryId]) s.primaryId = s.selectedIds.at(-1) ?? null;
    s.mode = s.selectedIds.length === 0 ? 'NONE' : s.selectedIds.length === 1 ? 'SINGLE' : 'MULTIPLE';
  }

  // ---------------------------------------------------------------- eventos

  on(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)!.delete(fn);
  }

  emit(event: string, payload: unknown) { for (const fn of this.listeners.get(event) ?? []) fn(payload); }
}
