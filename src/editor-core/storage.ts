// Persistência e salvamento automático (F14.04, F14.09) — sem depender de banco: o motor fala com um
// DocumentStore. Implementações: MemoryStore (testes, modo offline) e HttpStore (API do site → Neon).
//
//   AutoSaver   escuta as alterações, espera um intervalo sem mexer (ou um tempo máximo) e grava.
//               Concorrência otimista: cada gravação diz em que versão se baseou; se outro salvou antes, o
//               AutoSaver busca a versão nova, reaplica por cima o que ainda não tinha sido gravado (mesclagem
//               em três vias) e tenta de novo. Sem rede, guarda e tenta depois, com espera crescente.
//   Versões     CREATE_VERSION grava a fotografia no armazenamento também (o evento 'version' avisa).
//   SyncClient  leva e traz transações dos colaboradores pelo armazenamento (o servidor só ordena).
import type { Change, DocumentModel } from './types.ts';
import type { Engine } from './engine.ts';
import { rebuild } from './ops/versions.ts';
import type { RemoteTransaction, SyncSession } from './ops/collab.ts';
import { clone, EditorError, fail } from './util.ts';

export interface StoredDocument { id: string; doc: DocumentModel; version: number; updatedAt: string }
export interface DocumentSummary { id: string; name: string; application: string; version: number; updatedAt: string }
export interface VersionInfo { id: string; label: string; createdAt: string; createdBy?: string | null }
export type SaveResult = { ok: true; version: number; updatedAt: string } | { ok: false; conflict: true; current: StoredDocument };

export interface DocumentStore {
  list(): Promise<DocumentSummary[]>;
  create(doc: DocumentModel): Promise<StoredDocument>;
  load(id: string): Promise<StoredDocument>;
  /** Grava se a versão no armazenamento ainda for `baseVersion`; senão devolve a atual (conflito). */
  save(id: string, doc: DocumentModel, baseVersion: number, actions?: { changes: Change[]; userId?: string | null }[]): Promise<SaveResult>;
  remove(id: string): Promise<void>;
  listVersions(id: string): Promise<VersionInfo[]>;
  createVersion(id: string, label: string, doc: DocumentModel): Promise<VersionInfo>;
  getVersion(id: string, versionId: string): Promise<{ info: VersionInfo; doc: DocumentModel }>;
  /** Relé da colaboração: envia transações e recebe as dos outros desde `since`. */
  sync?(id: string, clientId: string, since: number, outgoing: RemoteTransaction[]): Promise<{ seq: number; incoming: RemoteTransaction[] }>;
}

// ---------------------------------------------------------------- memória

export class MemoryStore implements DocumentStore {
  docs = new Map<string, StoredDocument & { deleted?: boolean }>();
  versions = new Map<string, { info: VersionInfo; doc: DocumentModel }[]>();
  actions: { seq: number; docId: string; clientId: string; tx: RemoteTransaction }[] = [];
  /** para simular falha de rede nos testes */
  offline = false;
  private seq = 0;
  private nid = 0;
  private now() { return new Date(Date.now() + this.nid).toISOString(); }
  private check() { if (this.offline) throw new Error('Sem conexão.'); }
  async list() { this.check(); return [...this.docs.values()].filter((d) => !d.deleted).map((d) => ({ id: d.id, name: d.doc.document.name, application: d.doc.document.application, version: d.version, updatedAt: d.updatedAt })); }
  async create(doc: DocumentModel) {
    this.check();
    const id = `doc-${++this.nid}`;
    const d = { id, doc: clone({ ...doc, document: { ...doc.document, id } }), version: 1, updatedAt: this.now() };
    this.docs.set(id, d);
    return clone(d);
  }
  async load(id: string) { this.check(); const d = this.docs.get(id); if (!d || d.deleted) throw new EditorError('NOT_FOUND', `Documento ${id} não existe.`); return clone({ id: d.id, doc: d.doc, version: d.version, updatedAt: d.updatedAt }); }
  async save(id: string, doc: DocumentModel, baseVersion: number): Promise<SaveResult> {
    this.check();
    const d = this.docs.get(id);
    if (!d || d.deleted) throw new EditorError('NOT_FOUND', `Documento ${id} não existe.`);
    if (d.version !== baseVersion) return { ok: false, conflict: true, current: clone(d) };
    d.doc = clone(doc); d.version++; d.updatedAt = this.now(); this.nid++;
    return { ok: true, version: d.version, updatedAt: d.updatedAt };
  }
  async remove(id: string) { this.check(); const d = this.docs.get(id); if (d) d.deleted = true; }
  async listVersions(id: string) { this.check(); return (this.versions.get(id) ?? []).map((v) => clone(v.info)).reverse(); }
  async createVersion(id: string, label: string, doc: DocumentModel) {
    this.check();
    const list = this.versions.get(id) ?? [];
    const info = { id: `v${list.length + 1}`, label, createdAt: this.now() };
    list.push({ info, doc: clone(doc) });
    this.versions.set(id, list);
    return clone(info);
  }
  async getVersion(id: string, versionId: string) { this.check(); const v = (this.versions.get(id) ?? []).find((x) => x.info.id === versionId); if (!v) throw new EditorError('NOT_FOUND', 'Versão não existe.'); return clone(v); }
  async sync(id: string, clientId: string, since: number, outgoing: RemoteTransaction[]) {
    this.check();
    for (const tx of outgoing) this.actions.push({ seq: ++this.seq, docId: id, clientId, tx: clone(tx) });
    const incoming = this.actions.filter((a) => a.docId === id && a.seq > since && a.clientId !== clientId).map((a) => clone(a.tx));
    return { seq: this.seq, incoming };
  }
}

// ---------------------------------------------------------------- HTTP (API do site)

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** Fala com /api/editor/documents (mesma origem; o cookie de sessão do admin autentica). */
export class HttpStore implements DocumentStore {
  base: string;
  private f: Fetch;
  constructor(base = '/api/editor/documents', fetchFn?: Fetch) { this.base = base.replace(/\/$/, ''); this.f = fetchFn ?? ((globalThis as any).fetch as Fetch); }
  private async call(path: string, method = 'GET', body?: unknown) {
    const r = await this.f(`${this.base}${path}`, { method, headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409) return { conflict: true, ...data };
    if (!r.ok) throw new EditorError(r.status === 404 ? 'NOT_FOUND' : r.status === 401 || r.status === 403 ? 'PERMISSION_DENIED' : 'INVALID_OPERATION', data.error ?? `Erro ${r.status} no servidor.`);
    return data;
  }
  list() { return this.call(''); }
  create(doc: DocumentModel) { return this.call('', 'POST', { doc }); }
  load(id: string) { return this.call(`/${encodeURIComponent(id)}`); }
  async save(id: string, doc: DocumentModel, baseVersion: number, actions?: { changes: Change[]; userId?: string | null }[]): Promise<SaveResult> {
    const r = await this.call(`/${encodeURIComponent(id)}`, 'PUT', { doc, baseVersion, actions: actions ?? [] });
    return r.conflict ? { ok: false, conflict: true, current: r.current } : { ok: true, version: r.version, updatedAt: r.updatedAt };
  }
  async remove(id: string) { await this.call(`/${encodeURIComponent(id)}`, 'DELETE'); }
  listVersions(id: string) { return this.call(`/${encodeURIComponent(id)}/versions`); }
  createVersion(id: string, label: string, doc: DocumentModel) { return this.call(`/${encodeURIComponent(id)}/versions`, 'POST', { label, doc }); }
  getVersion(id: string, versionId: string) { return this.call(`/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`); }
  sync(id: string, clientId: string, since: number, outgoing: RemoteTransaction[]) { return this.call(`/${encodeURIComponent(id)}/sync`, 'POST', { clientId, since, transactions: outgoing }); }
}

// ---------------------------------------------------------------- salvamento automático

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'offline';
export interface Timer { set(fn: () => void, ms: number): unknown; clear(h: unknown): void; now(): number }
const realTimer: Timer = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as any), now: () => Date.now() };

export class AutoSaver {
  engine: Engine; store: DocumentStore; id: string;
  version: number;
  state: SaveState = 'idle';
  lastSavedAt: string | null = null;
  lastError: string | null = null;
  interval: number; maxWait: number;
  enabled = true;
  /** alterações ainda não gravadas (para reaplicar por cima de uma versão mais nova) */
  pending: { changes: Change[]; userId?: string | null }[] = [];
  private timer: Timer;
  private handle: unknown = null;
  private firstPendingAt: number | null = null;
  private failures = 0;
  private running: Promise<void> | null = null;
  private off: (() => void)[] = [];

  constructor(engine: Engine, store: DocumentStore, stored: { id: string; version: number }, opts: { interval?: number; maxWait?: number; timer?: Timer } = {}) {
    this.engine = engine; this.store = store; this.id = stored.id; this.version = stored.version;
    this.interval = opts.interval ?? 2000; this.maxWait = opts.maxWait ?? 10000; this.timer = opts.timer ?? realTimer;
    engine.ensureIdSuffix();   // outra aba ou outra pessoa pode gravar o mesmo documento
    this.off.push(engine.on('change', (ev: any) => {
      if (ev.source === 'recover') { this.pending = []; this.schedule(); return; }
      const changes: Change[] | undefined = ev.source === 'undo' || ev.source === 'redo' ? ev.applied : ev.transaction?.changes;
      if (!changes?.length) return;
      this.pending.push({ changes: clone(changes), userId: ev.transaction?.userId ?? null });
      this.schedule();
    }));
    this.off.push(engine.on('version', (v: { label: string }) => { void this.store.createVersion(this.id, v.label, clone(this.engine.doc)).catch(() => { /* a versão local continua existindo */ }); }));
  }

  private setState(s: SaveState) { this.state = s; this.engine.emit('save-status', this.status()); }
  status() { return { state: this.state, version: this.version, lastSavedAt: this.lastSavedAt, error: this.lastError, pending: this.pending.length, enabled: this.enabled }; }

  private schedule(delay?: number) {
    if (!this.enabled) { this.setState('pending'); return; }
    const now = this.timer.now();
    if (this.firstPendingAt === null) this.firstPendingAt = now;
    if (this.handle) this.timer.clear(this.handle);
    const wait = delay ?? Math.max(0, Math.min(this.interval, this.firstPendingAt + this.maxWait - now));
    if (this.state !== 'saving') this.setState(this.state === 'offline' ? 'offline' : 'pending');
    this.handle = this.timer.set(() => { this.handle = null; void this.flush(); }, wait);
  }

  /** Grava agora (ex.: antes de fechar a página). */
  async flush(): Promise<void> {
    if (this.running) { await this.running; if (!this.pending.length) return; }
    if (!this.pending.length && this.state !== 'error' && this.state !== 'offline') return;
    this.running = this.saveLoop().finally(() => { this.running = null; });
    return this.running;
  }

  private async saveLoop() {
    if (this.handle) { this.timer.clear(this.handle); this.handle = null; }
    this.setState('saving');
    const sending = this.pending;
    this.pending = [];
    this.firstPendingAt = null;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const r = await this.store.save(this.id, clone(this.engine.doc), this.version, sending);
        if (r.ok) {
          this.version = r.version; this.lastSavedAt = r.updatedAt; this.lastError = null; this.failures = 0;
          this.setState(this.pending.length ? 'pending' : 'saved');
          if (this.pending.length) this.schedule();
          return;
        }
        // outro salvou antes: a versão dele + o que ainda não foi gravado aqui (o que chegou durante a espera também)
        const merged = rebuild(r.current.doc, [...sending, ...this.pending]);
        this.engine.doc = merged.doc;
        this.engine.cleanSelection();
        this.version = r.current.version;
        this.engine.emit('change', { transaction: { id: 'MERGE', type: 'MERGE', label: 'Mesclar com a versão salva', changes: [], timestamp: Date.now() }, source: 'merge', warnings: merged.warnings });
      }
      throw new EditorError('INVALID_OPERATION', 'Muitas gravações simultâneas; tentando de novo.');
    } catch (x) {
      this.pending = [...sending, ...this.pending];   // nada se perde: tenta de novo depois
      this.failures++;
      this.lastError = (x as Error).message;
      const offline = /conex|network|fetch|offline/i.test(this.lastError);
      this.setState(offline ? 'offline' : 'error');
      this.schedule(Math.min(60000, 1000 * 2 ** Math.min(6, this.failures)));
    }
  }

  setEnabled(on: boolean, interval?: number) {
    this.enabled = on;
    if (interval !== undefined) { if (!(interval >= 250 && interval <= 600000)) fail('VALIDATION', 'Intervalo: de 250 ms a 10 minutos.'); this.interval = interval; }
    if (on && this.pending.length) this.schedule();
    else this.setState(on ? (this.pending.length ? 'pending' : this.state === 'saving' ? 'saving' : 'saved') : 'idle');
    return this.status();
  }
  stop() { if (this.handle) this.timer.clear(this.handle); this.off.forEach((f) => f()); }
}

/** Abre um documento do armazenamento num engine e liga o salvamento automático. */
export async function openStored(make: (doc: DocumentModel) => Engine, store: DocumentStore, id: string, opts: { interval?: number; maxWait?: number; timer?: Timer } = {}) {
  const s = await store.load(id);
  const engine = make(s.doc);
  const saver = new AutoSaver(engine, store, s, opts);
  engine.services.autosave = saver;
  engine.services.store = store;
  return { engine, saver };
}

// ---------------------------------------------------------------- colaboração pelo armazenamento

/** Leva o que a SyncSession juntou e traz o que os outros fizeram. Chame `tick()` num intervalo (ou por websocket). */
export class SyncClient {
  session: SyncSession; store: DocumentStore; id: string; since = 0;
  constructor(session: SyncSession, store: DocumentStore, id: string) {
    if (!store.sync) fail('INVALID_OPERATION', 'Este armazenamento não faz sincronização.');
    this.session = session; this.store = store; this.id = id;
  }
  async tick() {
    const out = this.session.drain();
    try {
      const r = await this.store.sync!(this.id, this.session.clientId, this.since, out);
      this.since = r.seq;
      const applied = r.incoming.length ? this.session.receive(r.incoming) : { applied: 0, conflicts: [] };
      return { sent: out.length, received: r.incoming.length, ...applied };
    } catch (x) {
      this.session.outbox.unshift(...out);   // devolve para a fila
      throw x;
    }
  }
}

/** Operação AUTOSAVE: liga/desliga, muda o intervalo, mostra o estado, grava agora (flush é assíncrono). */
export const storageHandlers = {
  AUTOSAVE: (e: Engine, op: { payload?: Record<string, any> }) => {
    const s = e.services.autosave as AutoSaver | undefined;
    if (!s) fail('INVALID_OPERATION', 'Documento sem armazenamento: abra com openStored().');
    const p = op.payload ?? {};
    if (p.enabled !== undefined || p.interval !== undefined) s!.setEnabled(p.enabled ?? s!.enabled, p.interval);
    if (p.flush) void s!.flush();
    return s!.status();
  },
};
