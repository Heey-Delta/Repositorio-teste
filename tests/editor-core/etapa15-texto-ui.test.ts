// Etapa 15: operações de texto que a interface usa (digitar, Enter, Backspace) e renomear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument } from '../../src/editor-core/index.ts';

const setup = () => {
  const e = createEngine(createDocument());
  const blk = e.state.activeSurface!;
  const ins = (data: any) => e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data } }).id as string;
  const txt = (id: string) => e.get(id).data.runs.map((r: any) => r.text).join('');
  return { e, blk, ins, txt };
};

test('TEXT_SPLICE troca um trecho numa ação e mantém a formatação vizinha', () => {
  const { e, ins, txt } = setup();
  const p = ins({ runs: [{ id: 'a', text: 'Olá ', format: {} }, { id: 'b', text: 'mundo', format: { bold: true } }] });
  e.run({ type: 'TEXT_SPLICE', targetId: p, payload: { start: 4, end: 9, text: 'Brasil' } });
  assert.equal(txt(p), 'Olá Brasil');
  assert.equal(e.history.past.length, 2);
  e.run({ type: 'UNDO' });
  assert.equal(txt(p), 'Olá mundo');
});

test('Enter divide; no fim de um título o novo é parágrafo; Backspace junta de volta', () => {
  const { e, blk, ins, txt } = setup();
  const h = ins({ textType: 'HEADING_1', text: 'Título' });
  const p2 = e.run({ type: 'TEXT_SPLIT', targetId: h, payload: { offset: 6 } }) as string;
  assert.deepEqual([e.get(p2).data.textType, e.get(blk).children.indexOf(p2) - e.get(blk).children.indexOf(h)], ['PARAGRAPH', 1]);
  const p = ins({ runs: [{ id: 'x', text: 'abc', format: {} }, { id: 'y', text: 'def', format: { italic: true } }] });
  const q = e.run({ type: 'TEXT_SPLIT', targetId: p, payload: { offset: 4 } }) as string;
  assert.deepEqual([txt(p), txt(q), e.get(q).data.runs[0].format.italic], ['abcd', 'ef', true]);
  const r = e.run({ type: 'TEXT_MERGE_PREV', targetId: q }) as any;
  assert.deepEqual([r.id, r.offset, txt(p), e.find(q)], [p, 4, 'abcdef', undefined]);
});

test('Enter numa lista cria item no mesmo nível; Backspace volta', () => {
  const { e, blk, txt } = setup();
  const list = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'LIST', parentId: blk, items: [{ text: 'um', level: 1 }] } }) as string;
  const t1 = e.get(e.get(list).children[0]).children[0];
  const t2 = e.run({ type: 'TEXT_SPLIT', targetId: t1, payload: { offset: 3 } }) as string;
  assert.equal(e.get(list).children.length, 2);
  assert.equal(e.get(e.get(t2).parentId).data.level, 1);
  e.run({ type: 'TEXT_SPLICE', targetId: t2, payload: { start: 0, end: 0, text: 'dois' } });
  e.run({ type: 'TEXT_MERGE_PREV', targetId: t2 });
  assert.deepEqual([e.get(list).children.length, txt(t1)], [1, 'umdois']);
});

test('renomear o documento', () => {
  const { e } = setup();
  e.run({ type: 'RENAME_DOCUMENT', payload: { name: 'Relatório' } });
  assert.equal(e.doc.document.name, 'Relatório');
  assert.equal(e.execute({ type: 'RENAME_DOCUMENT', payload: { name: ' ' } }).ok, false);
});
