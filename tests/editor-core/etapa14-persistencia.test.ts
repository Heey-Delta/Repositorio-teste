// Etapa 14: armazenamento, salvamento automático (espera, tempo máximo, conflito, sem rede), versões e relé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, MemoryStore, HttpStore, AutoSaver, SyncClient, SyncSession, openStored } from '../../src/editor-core/index.ts';

/** Relógio de mentira: avança o tempo na mão. */
function fakeTimer() {
  let t = 0; const q: { at: number; fn: () => void; id: number }[] = []; let n = 0;
  return {
    set: (fn: () => void, ms: number) => { const id = ++n; q.push({ at: t + ms, fn, id }); return id; },
    clear: (h: unknown) => { const i = q.findIndex((x) => x.id === h); if (i >= 0) q.splice(i, 1); },
    now: () => t,
    async advance(ms: number) { t += ms; for (;;) { q.sort((a, b) => a.at - b.at); const x = q[0]; if (!x || x.at > t) break; q.shift(); x.fn(); await new Promise((r) => setTimeout(r, 0)); } await new Promise((r) => setTimeout(r, 0)); },
  };
}
const make = (doc: any) => createEngine(doc);
const write = (e: any, text: string) => e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: e.state.activeSurface, data: { text } } }).id;
const texts = (doc: any) => Object.values(doc.nodes).filter((n: any) => n.type === 'TEXT').map((n: any) => n.data.runs.map((r: any) => r.text).join('')).filter(Boolean).sort();

test('salvamento automático: espera parar de digitar, mas grava no tempo máximo', async () => {
  const store = new MemoryStore();
  const created = await store.create(createDocument());
  const timer = fakeTimer();
  const { engine: e, saver } = await openStored(make, store, created.id, { interval: 2000, maxWait: 5000, timer });
  const states: string[] = [];
  e.on('save-status', (s: any) => states.push(s.state));
  for (const t of ['a', 'b', 'c', 'd']) { write(e, t); if (t !== 'd') await timer.advance(1500); }   // digita a cada 1,5 s
  assert.equal(store.docs.get(created.id)!.version, 1, 'ainda digitando: não gravou');
  await timer.advance(499);
  assert.equal(store.docs.get(created.id)!.version, 1);
  await timer.advance(1);
  assert.equal(store.docs.get(created.id)!.version, 2, 'chegou no tempo máximo (5 s) mesmo digitando: gravou');
  assert.deepEqual(texts(store.docs.get(created.id)!.doc), ['a', 'b', 'c', 'd']);
  assert.ok(states.includes('pending') && states.at(-1) === 'saved');
  assert.equal(saver.status().version, 2);
  assert.equal(e.run({ type: 'AUTOSAVE' }).state, 'saved');
});

test('conflito: dois editores gravam o mesmo documento e nada se perde', async () => {
  const store = new MemoryStore();
  const created = await store.create(createDocument());
  const timer = fakeTimer();
  const A = await openStored(make, store, created.id, { timer, interval: 100 });
  const B = await openStored(make, store, created.id, { timer, interval: 100 });
  write(A.engine, 'da Ana');
  write(B.engine, 'da Bia');
  await A.saver.flush();
  await B.saver.flush();   // conflito: busca a da Ana, reaplica a da Bia por cima e grava
  assert.deepEqual(texts(store.docs.get(created.id)!.doc), ['da Ana', 'da Bia']);
  assert.deepEqual(texts(B.engine.doc), ['da Ana', 'da Bia'], 'a Bia já vê o texto da Ana');
  assert.equal(B.saver.version, 3);
});

test('sem rede: guarda, tenta de novo e grava quando a conexão volta', async () => {
  const store = new MemoryStore();
  const created = await store.create(createDocument());
  const timer = fakeTimer();
  const { engine: e, saver } = await openStored(make, store, created.id, { timer, interval: 100 });
  store.offline = true;
  write(e, 'offline');
  await timer.advance(100);
  assert.equal(saver.status().state, 'offline');
  assert.equal(saver.status().pending, 1, 'a alteração continua guardada');
  store.offline = false;
  await timer.advance(2000);
  assert.equal(saver.status().state, 'saved');
  assert.deepEqual(texts(store.docs.get(created.id)!.doc), ['offline']);
});

test('desligar o salvamento, mudar o intervalo e versões gravadas no armazenamento', async () => {
  const store = new MemoryStore();
  const created = await store.create(createDocument());
  const timer = fakeTimer();
  const { engine: e } = await openStored(make, store, created.id, { timer });
  e.run({ type: 'AUTOSAVE', payload: { enabled: false } });
  write(e, 'x');
  await timer.advance(60000);
  assert.equal(store.docs.get(created.id)!.version, 1, 'desligado não grava');
  assert.equal(e.execute({ type: 'AUTOSAVE', payload: { enabled: true, interval: 10 } }).ok, false, 'intervalo mínimo');
  e.run({ type: 'AUTOSAVE', payload: { enabled: true, interval: 500 } });
  await timer.advance(500);
  assert.equal(store.docs.get(created.id)!.version, 2);
  e.run({ type: 'CREATE_VERSION', payload: { label: 'Entrega 1' } });
  await new Promise((r) => setTimeout(r, 0));
  const vs = await store.listVersions(created.id);
  assert.equal(vs[0].label, 'Entrega 1');
  assert.deepEqual(texts((await store.getVersion(created.id, vs[0].id)).doc), ['x']);
  assert.equal(createEngine(createDocument()).execute({ type: 'AUTOSAVE' }).ok, false, 'sem armazenamento');
});

test('HttpStore segue o contrato da API (200, 201, 404, 409)', async () => {
  const mem = new MemoryStore();
  const calls: string[] = [];
  const api = async (url: string, init: any = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url}`);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const reply = (status: number, data: unknown) => ({ ok: status < 300, status, json: async () => data });
    const [, , , , id, sub, vid] = url.split('/');
    try {
      if (!id) return init.method === 'POST' ? reply(201, await mem.create(body.doc ?? createDocument())) : reply(200, await mem.list());
      if (sub === 'versions') return vid ? reply(200, await mem.getVersion(id, vid)) : init.method === 'POST' ? reply(201, await mem.createVersion(id, body.label, body.doc)) : reply(200, await mem.listVersions(id));
      if (sub === 'sync') return reply(200, await mem.sync(id, body.clientId, body.since, body.transactions));
      if (init.method === 'PUT') { const r = await mem.save(id, body.doc, body.baseVersion); return r.ok ? reply(200, r) : reply(409, { error: 'conflito', current: r.current }); }
      if (init.method === 'DELETE') { await mem.remove(id); return reply(200, { ok: true }); }
      return reply(200, await mem.load(id));
    } catch (x) { return reply(404, { error: (x as Error).message }); }
  };
  const store = new HttpStore('/api/editor/documents', api);
  const d = await store.create(createDocument('SPREADSHEET_EDITOR', 'Vendas'));
  assert.equal((await store.list())[0].name, 'Vendas');
  const ok = await store.save(d.id, d.doc, 1);
  assert.deepEqual([ok.ok, (ok as any).version], [true, 2]);
  const stale = await store.save(d.id, d.doc, 1);
  assert.equal(stale.ok, false, '409 vira conflito, não erro');
  await store.remove(d.id);
  await assert.rejects(store.load(d.id), /não existe/);
  assert.ok(calls.includes(`PUT /api/editor/documents/${d.id}`));
});

test('colaboração pelo armazenamento: duas sessões trocam transações pelo relé', async () => {
  const store = new MemoryStore();
  const base = await store.create(createDocument());
  const a = createEngine(structuredClone(base.doc)), b = createEngine(structuredClone(base.doc));
  a.user = { id: 'ana', name: 'Ana' }; b.user = { id: 'bia', name: 'Bia' };
  const ca = new SyncClient(new SyncSession(a), store, base.id), cb = new SyncClient(new SyncSession(b), store, base.id);
  write(a, 'linha da Ana');
  write(b, 'linha da Bia');
  await ca.tick();
  const rb = await cb.tick();
  assert.equal(rb.received, 1);
  await ca.tick();
  assert.deepEqual(texts(a.doc), ['linha da Ana', 'linha da Bia']);
  assert.deepEqual(texts(b.doc), texts(a.doc));
  store.offline = true;
  write(a, 'sem rede');
  await assert.rejects(ca.tick());
  store.offline = false;
  await ca.tick(); await cb.tick();
  assert.ok(texts(b.doc).includes('sem rede'), 'o que ficou na fila vai depois');
});
