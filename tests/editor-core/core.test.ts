// Núcleo: operações básicas, histórico, seleção, área de transferência e organização.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument } from '../../src/editor-core/index.ts';

function slideEngine() {
  const e = createEngine(createDocument('PRESENTATION_EDITOR'));
  const s = e.state.activeSurface!;
  const shape = (x: number, y = 0, w = 50, h = 50) => e.run({ type: 'CREATE', payload: { parentId: s, nodeType: 'SHAPE', data: { shapeType: 'RECTANGLE' }, layout: { mode: 'ABSOLUTE', x, y, width: w, height: h } } }).id as string;
  return { e, s, shape };
}

test('documentos novos: uma estrutura para as três aplicações', () => {
  const doc = createEngine(createDocument('DOCUMENT_EDITOR'));
  const pres = createEngine(createDocument('PRESENTATION_EDITOR'));
  const sheet = createEngine(createDocument('SPREADSHEET_EDITOR'));
  assert.equal(doc.get(doc.state.activeSurface).type, 'BLOCK');
  assert.equal(pres.get(pres.state.activeSurface).data.surfaceType, 'SLIDE');
  assert.equal(sheet.get(sheet.state.activeSurface).data.surfaceType, 'SHEET');
  assert.equal(doc.get(doc.doc.document.rootId).parentId, null);
});

test('CREATE / UPDATE / MOVE / DELETE com desfazer e refazer na ordem certa', () => {
  const { e, shape } = slideEngine();
  const c = shape(100, 100);
  e.run({ type: 'UPDATE', targetId: c, payload: { styleOverrides: { fill: '#FF0000' } } });
  e.run({ type: 'MOVE', targetId: c, payload: { x: 250, y: 180 } });
  assert.deepEqual([e.get(c).layout.x, e.get(c).layout.y], [250, 180]);
  e.run({ type: 'UNDO' });
  assert.equal(e.get(c).layout.x, 100);
  e.run({ type: 'UNDO' });
  assert.deepEqual(e.get(c).styleOverrides, {});
  e.run({ type: 'REDO' });
  assert.equal(e.get(c).styleOverrides.fill, '#FF0000');
  e.run({ type: 'DELETE', targetId: c });
  assert.equal(e.find(c), undefined);
  e.run({ type: 'UNDO' });
  assert.ok(e.find(c));
  assert.equal(e.history.future.length, 1);
  e.run({ type: 'MOVE', targetId: c, payload: { dx: 1 } });
  assert.equal(e.history.future.length, 0, 'nova alteração descarta o refazer');
});

test('operação que falha no meio não deixa nada pela metade', () => {
  const { e, shape } = slideEngine();
  const a = shape(0), b = shape(10);
  e.run({ type: 'LOCK', targetId: b });
  const before = JSON.stringify(e.doc.nodes);
  const r = e.execute({ type: 'UPDATE', targetIds: [a, b], payload: { styleOverrides: { fill: '#000000' } } });
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(e.doc.nodes), before);
});

test('integridade: tipo no lugar errado, ciclo na árvore, raiz e IDs inexistentes', () => {
  const { e, s, shape } = slideEngine();
  const a = shape(0);
  assert.equal(e.execute({ type: 'CREATE', payload: { parentId: a, nodeType: 'TEXT' } }).ok, false);
  const g1 = e.run({ type: 'CREATE', payload: { parentId: s, nodeType: 'GROUP', layout: { mode: 'ABSOLUTE' } } }).id;
  const g2 = e.run({ type: 'CREATE', payload: { parentId: g1, nodeType: 'GROUP', layout: { mode: 'ABSOLUTE' } } }).id;
  assert.match(e.execute({ type: 'MOVE', targetId: g1, payload: { newParentId: g2 } }).error!.message, /dentro dele mesmo/);
  assert.equal(e.execute({ type: 'DELETE', targetId: e.doc.document.rootId }).ok, false);
  assert.equal(e.execute({ type: 'GET', targetId: 'NADA' }).error!.code, 'NOT_FOUND');
  assert.equal(e.execute({ type: 'NAO_EXISTE' }).error!.code, 'UNKNOWN_OPERATION');
});

test('DUPLICATE copia a subárvore com IDs novos e desloca a cópia', () => {
  const { e, shape } = slideEngine();
  const g = e.run({ type: 'GROUP', targetIds: [shape(0), shape(100)] });
  const [copy] = e.run({ type: 'DUPLICATE', targetId: g });
  assert.notEqual(copy, g);
  assert.equal(e.get(copy).children.length, 2);
  assert.ok(e.get(copy).children.every((id: string) => !e.get(g).children.includes(id)));
  assert.equal(e.get(copy).layout.x, (e.get(g).layout.x ?? 0) + 10);
});

test('excluir um objeto conectado: o conector vira ponto solto; desfazer reconecta', () => {
  const { e, s, shape } = slideEngine();
  const a = shape(0), b = shape(200);
  const line = e.run({ type: 'CREATE', payload: { parentId: s, nodeType: 'LINE', data: { lineType: 'CONNECTOR', start: { targetId: a }, end: { targetId: b } }, layout: { mode: 'ABSOLUTE' } } }).id;
  e.run({ type: 'DELETE', targetId: a });
  assert.deepEqual(e.get(line).data.start, { point: { x: 25, y: 25 } });
  e.run({ type: 'UNDO' });
  assert.deepEqual(e.get(line).data.start, { targetId: a });
});

test('seleção: clique dentro do grupo seleciona o grupo; modo deep seleciona o filho; área', () => {
  const { e, shape } = slideEngine();
  const a = shape(0), b = shape(100), c = shape(300);
  const g = e.run({ type: 'GROUP', targetIds: [a, b] });
  e.run({ type: 'SELECT', targetId: a });
  assert.deepEqual(e.state.selection.selectedIds, [g]);
  e.run({ type: 'SELECT', targetId: a, payload: { deep: true } });
  assert.deepEqual(e.state.selection.selectedIds, [a]);
  e.run({ type: 'SELECT', targetId: c, payload: { additive: true } });
  assert.equal(e.state.selection.mode, 'MULTIPLE');
  e.run({ type: 'SELECT_AREA', payload: { x: -10, y: -10, width: 200, height: 100 } });
  assert.deepEqual(e.state.selection.selectedIds, [g]);
  assert.equal(e.history.past.length, 4, 'seleção não entra no histórico (só os 3 CREATE e o GROUP)');
});

test('copiar e colar: IDs novos, conector passa a ligar as cópias, recorte some depois de colar', () => {
  const { e, s, shape } = slideEngine();
  const a = shape(0), b = shape(100);
  const line = e.run({ type: 'CREATE', payload: { parentId: s, nodeType: 'LINE', data: { lineType: 'CONNECTOR', start: { targetId: a }, end: { targetId: b } }, layout: { mode: 'ABSOLUTE' } } }).id;
  e.run({ type: 'COPY', targetIds: [a, b, line] });
  const pasted = e.run({ type: 'PASTE' });
  const newLine = e.get(pasted[2]);
  assert.deepEqual([newLine.data.start.targetId, newLine.data.end.targetId], [pasted[0], pasted[1]]);
  assert.equal(e.get(pasted[0]).layout.x, 10);
  e.run({ type: 'CUT', targetId: a });
  assert.equal(e.find(a), undefined);
  e.run({ type: 'PASTE' });
  assert.equal(e.state.clipboard, null, 'recorte vale para uma colagem');
  assert.equal(e.execute({ type: 'PASTE' }).error!.code, 'EMPTY_CLIPBOARD');
});

test('colar texto de fora vira parágrafos; colar formatação copia só o visual', () => {
  const e = createEngine(createDocument());
  const ids = e.run({ type: 'PASTE_TEXT', payload: { text: 'linha 1\nlinha 2' } });
  assert.equal(ids.length, 2);
  const { e: p, shape } = slideEngine();
  const a = shape(0), b = shape(100);
  p.run({ type: 'FORMAT', targetId: a, payload: { fill: '#123456' } });
  p.run({ type: 'COPY', targetId: a });
  p.run({ type: 'PASTE', targetIds: [b], payload: { mode: 'FORMAT_ONLY' } });
  assert.equal(p.get(b).styleOverrides.fill, '#123456');
});

test('agrupar e desagrupar preservam identidade; mover o grupo move os filhos', () => {
  const { e, s, shape } = slideEngine();
  const a = shape(0), b = shape(100, 50);
  const g = e.run({ type: 'GROUP', targetIds: [a, b] });
  assert.deepEqual(e.get(g).layout, { mode: 'ABSOLUTE', x: 0, y: 0, width: 150, height: 100, zIndex: 0 });
  e.run({ type: 'MOVE', targetId: g, payload: { dx: 10, dy: 5 } });
  assert.deepEqual([e.get(b).layout.x, e.get(b).layout.y], [110, 55]);
  assert.equal(e.execute({ type: 'GROUP', targetIds: [a] }).ok, false);
  e.run({ type: 'UNGROUP', targetId: g });
  assert.equal(e.find(g), undefined);
  assert.equal(e.get(a).parentId, s);
});

test('camadas mudam só a ordem visual, nunca a hierarquia', () => {
  const { e, s, shape } = slideEngine();
  const a = shape(0), b = shape(10), c = shape(20);
  const z = () => [a, b, c].map((id) => e.get(id).layout.zIndex);
  e.run({ type: 'BRING_TO_FRONT', targetId: a });
  assert.deepEqual(z(), [2, 0, 1]);
  e.run({ type: 'SEND_BACKWARD', targetId: a });
  assert.deepEqual(z(), [1, 0, 2]);
  e.run({ type: 'SEND_TO_BACK', targetId: c });
  assert.deepEqual(z(), [2, 1, 0]);
  assert.deepEqual(e.get(s).children, [a, b, c]);
  e.run({ type: 'REORDER', targetId: c, payload: { newOrder: 0 } });
  assert.deepEqual(e.get(s).children, [c, a, b]);
});

test('bloqueio vale para o objeto e para o que está dentro de um grupo bloqueado', () => {
  const { e, shape } = slideEngine();
  const a = shape(0), b = shape(10);
  const g = e.run({ type: 'GROUP', targetIds: [a, b] });
  e.run({ type: 'LOCK', targetId: g });
  assert.equal(e.execute({ type: 'MOVE', targetId: a, payload: { dx: 1 } }).error!.code, 'LOCKED');
  assert.equal(e.execute({ type: 'DELETE', targetId: g }).error!.code, 'LOCKED');
  e.run({ type: 'UNLOCK', targetId: g });
  assert.equal(e.execute({ type: 'MOVE', targetId: a, payload: { dx: 1 } }).ok, true);
});

test('versões: criar, alterar, restaurar (e desfazer a restauração)', () => {
  const { e, shape } = slideEngine();
  const a = shape(0);
  const v = e.run({ type: 'CREATE_VERSION', payload: { label: 'Antes' } });
  e.run({ type: 'DELETE', targetId: a });
  e.run({ type: 'RESTORE_VERSION', targetId: v.id });
  assert.ok(e.find(a));
  e.run({ type: 'UNDO' });
  assert.equal(e.find(a), undefined);
});

test('REPEAT aplica a última ação na seleção atual; histórico tem limite', () => {
  const { e, shape } = slideEngine();
  const a = shape(0), b = shape(100);
  e.run({ type: 'FORMAT', targetId: a, payload: { fill: '#ABCDEF' } });
  e.run({ type: 'SELECT', targetId: b });
  e.run({ type: 'REPEAT' });
  assert.equal(e.get(b).styleOverrides.fill, '#ABCDEF');
  const small = createEngine(createDocument('PRESENTATION_EDITOR'), { historyLimit: 3 });
  for (let i = 0; i < 6; i++) small.run({ type: 'SET_GRID', payload: { size: 10 + i } });
  assert.equal(small.history.past.length, 3);
});
