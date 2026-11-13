// Etapa 10: comparar versões, diário, recuperação e integridade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, diffText, Journal, rebuild, checkIntegrity } from '../../src/editor-core/index.ts';

function doc(app: any = 'DOCUMENT_EDITOR') {
  const e = createEngine(createDocument(app));
  const txt = (text: string) => e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: e.state.activeSurface, data: { text } } }).id as string;
  return { e, txt };
}

test('diferença de texto por palavra', () => {
  assert.deepEqual(diffText('O gato preto subiu', 'O gato branco subiu rápido'), [
    { op: 'EQUAL', text: 'O gato ' }, { op: 'DELETE', text: 'preto' }, { op: 'INSERT', text: 'branco' }, { op: 'EQUAL', text: ' subiu' }, { op: 'INSERT', text: ' rápido' },
  ]);
  assert.deepEqual(diffText('', 'novo'), [{ op: 'INSERT', text: 'novo' }]);
  assert.deepEqual(diffText('igual', 'igual'), [{ op: 'EQUAL', text: 'igual' }]);
});

test('comparar versões: criado, excluído, alterado (texto e formatação), movido', () => {
  const { e, txt } = doc();
  const a = txt('Primeiro parágrafo.'), b = txt('Segundo.'), c = txt('Terceiro.');
  const v1 = e.run({ type: 'CREATE_VERSION', payload: { label: 'Rascunho' } }).id;
  e.run({ type: 'TEXT_SET', targetId: a, payload: { text: 'Primeiro parágrafo revisado.' } });
  e.run({ type: 'FORMAT', targetId: b, payload: { color: '#FF0000' } });
  e.run({ type: 'DELETE', targetId: c });
  const d = txt('Quarto.');
  e.run({ type: 'REORDER', targetId: b, payload: { newOrder: 0 } });
  const r = e.run({ type: 'COMPARE_VERSIONS', payload: { fromId: v1 } }) as any;
  assert.equal(r.from.label, 'Rascunho');
  assert.equal(r.to.id, 'CURRENT');
  const by = (id: string) => r.nodes.find((n: any) => n.nodeId === id);
  assert.equal(by(a).kind, 'MODIFIED');
  assert.deepEqual(by(a).text, [{ op: 'EQUAL', text: 'Primeiro parágrafo' }, { op: 'INSERT', text: ' revisado' }, { op: 'EQUAL', text: '.' }]);
  assert.deepEqual(by(b).fields, ['styleOverrides', 'position']);
  assert.equal(by(c).kind, 'DELETED');
  assert.equal(by(d).kind, 'INSERTED');
  assert.deepEqual(r.summary, { inserted: 1, deleted: 1, modified: 2, moved: 0, styles: 0, themes: 0 });
  const v2 = e.run({ type: 'CREATE_VERSION', payload: { label: 'Final' } }).id;
  assert.equal((e.run({ type: 'COMPARE_VERSIONS', payload: { fromId: v2 } }) as any).nodes.length, 0);
  assert.equal(e.execute({ type: 'COMPARE_VERSIONS', payload: { fromId: 'NADA' } }).ok, false);
});

test('comparar versões de planilha: por célula', () => {
  const { e } = doc('SPREADSHEET_EDITOR');
  const sh = e.state.activeSurface!;
  e.run({ type: 'SET_CELLS', targetId: sh, payload: { start: 'A1', values: [['a', 1], ['b', 2]] } });
  const v = e.run({ type: 'CREATE_VERSION' }).id;
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'B2', value: 5 } });
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'B3', value: '=B1+B2' } });
  const r = e.run({ type: 'COMPARE_VERSIONS', payload: { fromId: v } }) as any;
  assert.deepEqual(r.nodes[0].cells, [{ cell: 'B2', before: 2, after: 5 }, { cell: 'B3', before: null, after: '=B1+B2' }]);
});

test('diário: reconstrói o documento a partir da base + alterações (inclusive desfazer)', () => {
  const { e, txt } = doc();
  const j = new Journal(e);
  const a = txt('Um');
  txt('Dois');
  e.run({ type: 'TEXT_SET', targetId: a, payload: { text: 'Um, editado' } });
  e.run({ type: 'UNDO' });
  e.run({ type: 'FORMAT', targetId: a, payload: { fontSize: 20 } });
  const saved = JSON.parse(JSON.stringify(j.export()));
  const r = rebuild(saved.base, saved.entries);
  assert.deepEqual(r.doc.nodes, e.doc.nodes);
  assert.deepEqual([r.warnings, r.problems], [[], []]);
  j.checkpoint('Salvo');
  assert.equal(j.export().entries.length, 0);

  const fresh = createEngine(createDocument());
  const out = fresh.run({ type: 'RECOVER', payload: { base: saved.base, entries: saved.entries } }) as any;
  assert.deepEqual(out.warnings, []);
  assert.deepEqual(fresh.doc.nodes, e.doc.nodes);
  assert.equal(fresh.history.past.length, 0);
});

test('exportar/recuperar a sessão inteira (documento, versões e histórico)', () => {
  const { e, txt } = doc();
  txt('Antes da queda');
  e.run({ type: 'CREATE_VERSION', payload: { label: 'v1' } });
  const st = JSON.parse(JSON.stringify(e.run({ type: 'EXPORT_STATE' })));
  const fresh = createEngine(createDocument());
  fresh.run({ type: 'RECOVER', payload: { state: st } });
  assert.deepEqual(fresh.doc.nodes, e.doc.nodes);
  assert.equal(fresh.snapshots[0].label, 'v1');
  fresh.run({ type: 'UNDO' });
  assert.equal(Object.values(fresh.doc.nodes).filter((n) => n.type === 'TEXT').length, 0, 'o desfazer continua funcionando');
  assert.equal(fresh.execute({ type: 'RECOVER', payload: { state: { format: 'outro' } } }).ok, false);
});

test('integridade: acha e conserta árvore quebrada', () => {
  const { e, txt } = doc();
  const a = txt('A'), b = txt('B');
  const blk = e.state.activeSurface!;
  assert.deepEqual(checkIntegrity(e.doc), []);
  // estragos de propósito (como um arquivo corrompido)
  e.doc.nodes[blk].children.push('FANTASMA');
  e.doc.nodes[blk].children = e.doc.nodes[blk].children.filter((x) => x !== b);
  e.doc.nodes[a].order = 7;
  const codes = (e.run({ type: 'CHECK_INTEGRITY' }) as any[]).map((p) => p.code).sort();
  assert.deepEqual(codes, ['MISSING_CHILD', 'ORPHAN', 'WRONG_ORDER']);
  const fixed = e.run({ type: 'REPAIR_DOCUMENT' }) as string[];
  assert.ok(fixed.includes(`REATTACHED:${b}`));
  assert.deepEqual(checkIntegrity(e.doc), []);
  assert.deepEqual(e.get(blk).children, [a, b]);
  e.run({ type: 'UNDO' });
  assert.equal(e.get(a).order, 7, 'o conserto pode ser desfeito');
});
