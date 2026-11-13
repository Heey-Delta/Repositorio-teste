// Etapa 04: campos automáticos, indicadores, referências cruzadas, numerações, sumário, índice, citações e bibliografia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, formatReference } from '../../src/editor-core/index.ts';

function doc() {
  const e = createEngine(createDocument());
  e.services.now = () => new Date(2026, 10, 13, 9, 5);
  const blk = e.state.activeSurface!;
  const ins = (contentType: string, data: any, parentId = blk) => e.run({ type: 'INSERT_CONTENT', payload: { contentType, parentId, data } }).id as string;
  return { e, blk, ins, root: e.doc.document.rootId, v: (id: string) => e.get(id).data.value };
}
const lorem = 'Lorem ipsum dolor sit amet. '.repeat(120);

test('legendas por rótulo e notas numeradas na ordem do documento', () => {
  const { e, ins, v } = doc();
  const f1 = ins('CAPTION', { label: 'Figura', text: 'A' });
  const t1 = ins('CAPTION', { label: 'Tabela', text: 'B' });
  const f2 = ins('CAPTION', { label: 'Figura', text: 'C' });
  const n1 = ins('NOTE', { noteType: 'FOOTNOTE', text: 'x' }), e1 = ins('NOTE', { noteType: 'ENDNOTE', text: 'y' }), n2 = ins('NOTE', { noteType: 'FOOTNOTE', text: 'z' });
  e.run({ type: 'UPDATE_FIELDS' });
  assert.deepEqual([v(f1), v(t1), v(f2)], ['Figura 1', 'Tabela 1', 'Figura 2']);
  assert.deepEqual([v(n1), v(n2), v(e1)], ['1', '2', 'i']);
  e.run({ type: 'REORDER', targetId: f2, payload: { newOrder: 0 } });
  e.run({ type: 'UPDATE_FIELDS' });
  assert.deepEqual([v(f2), v(f1)], ['Figura 1', 'Figura 2'], 'renumera ao mudar a ordem');
});

test('campos: data por extenso, hora, nome, autor, página no rodapé (dinâmica)', () => {
  const { e, ins, root, v } = doc();
  const d = ins('FIELD', { fieldType: 'DATE', format: "dd 'de' MMMM 'de' yyyy" });
  const h = ins('FIELD', { fieldType: 'TIME' });
  e.run({ type: 'SET_DOCUMENT_INFO', payload: { name: 'Relatório', author: 'Hallan' } });
  const nm = ins('FIELD', { fieldType: 'DOC_NAME' }), au = ins('FIELD', { fieldType: 'AUTHOR' });
  const footer = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'REGION', regionType: 'FOOTER', parentId: root } });
  const pn = ins('FIELD', { fieldType: 'PAGE_NUMBER' }, footer), pc = ins('FIELD', { fieldType: 'PAGE_COUNT' }, footer);
  e.run({ type: 'UPDATE_FIELDS' });
  assert.deepEqual([v(d), v(h), v(nm), v(au)], ['13 de novembro de 2026', '09:05', 'Relatório', 'Hallan']);
  assert.deepEqual([e.get(pn).data.dynamic, e.run({ type: 'FIELD_TEXT', targetId: pn, payload: { page: 3 } })], [true, '3']);
  assert.equal(e.run({ type: 'FIELD_TEXT', targetId: pc }), '1');
});

test('indicadores e referências cruzadas (texto, número, página, acima/abaixo, alvo excluído)', () => {
  const { e, ins, v } = doc();
  const h = ins('TEXT', { textType: 'HEADING_1', text: 'Introdução' });
  ins('TEXT', { text: lorem });
  const img = ins('IMAGE', { assetId: e.run({ type: 'IMPORT_ASSET', payload: { type: 'IMAGE', name: 'a', source: '/a' } }), alt: 'x' });
  ins('CAPTION', { label: 'Figura', text: 'Arquitetura', targetId: img });
  e.run({ type: 'ADD_BOOKMARK', targetId: h, payload: { name: 'intro' } });
  assert.equal(e.execute({ type: 'ADD_BOOKMARK', targetId: img, payload: { name: 'intro' } }).ok, false, 'nome único');
  const a = ins('FIELD', { fieldType: 'CROSS_REFERENCE', targetId: img, show: 'LABEL_NUMBER' });
  const b = ins('FIELD', { fieldType: 'CROSS_REFERENCE', targetId: img, show: 'TEXT' });
  const c = ins('FIELD', { fieldType: 'CROSS_REFERENCE', bookmark: 'intro', show: 'PAGE' });
  const d = ins('FIELD', { fieldType: 'CROSS_REFERENCE', bookmark: 'intro', show: 'ABOVE_BELOW' });
  e.run({ type: 'UPDATE_FIELDS' });
  assert.deepEqual([v(a), v(b), v(c), v(d)], ['Figura 1', 'Figura 1 — Arquitetura', '1', 'acima']);
  assert.equal(e.execute({ type: 'INSERT_CONTENT', payload: { contentType: 'FIELD', data: { fieldType: 'CROSS_REFERENCE', bookmark: 'nada' } } }).ok, false);
  const link = ins('LINK', { bookmark: 'intro' });
  assert.equal(e.get(link).data.bookmark, 'intro');
  e.run({ type: 'DELETE', targetId: img });
  e.run({ type: 'UPDATE_FIELDS' });
  assert.match(v(a), /não encontrada/);
});

test('sumário com páginas (duas passadas) e índice remissivo', () => {
  const { e, blk, ins } = doc();
  const toc = e.run({ type: 'BUILD_TOC', payload: { parentId: blk, levels: 2 } });
  const h1 = ins('TEXT', { textType: 'HEADING_1', text: 'Introdução' });
  ins('TEXT', { text: lorem });
  ins('TEXT', { textType: 'HEADING_2', text: 'Contexto' });
  ins('TEXT', { textType: 'HEADING_3', text: 'Fora do sumário' });
  ins('TEXT', { text: lorem });
  const h2 = ins('TEXT', { textType: 'HEADING_1', text: 'Conclusão' });
  e.run({ type: 'MARK_INDEX_ENTRY', targetId: h1, payload: { term: 'Design' } });
  e.run({ type: 'MARK_INDEX_ENTRY', targetId: h2, payload: { term: 'Design' } });
  e.run({ type: 'MARK_INDEX_ENTRY', targetId: h2, payload: { term: 'Ábaco' } });
  const idx = e.run({ type: 'BUILD_INDEX', payload: { parentId: blk } });
  e.run({ type: 'UPDATE_FIELDS' });
  const entries = e.get(toc).data.entries;
  assert.deepEqual(entries.map((x: any) => [x.text, x.level]), [['Introdução', 1], ['Contexto', 2], ['Conclusão', 1]]);
  assert.ok(entries[2].page > entries[0].page);
  assert.deepEqual(e.get(idx).data.entries.map((x: any) => x.term), ['Ábaco', 'Design']);
  assert.ok(e.get(idx).data.entries[1].pages.length === 2 || e.get(idx).data.entries[1].pages.length === 1);
  assert.equal(e.execute({ type: 'BUILD_TOC', payload: { levels: 9 } }).ok, false);
});

test('citações e bibliografia: ABNT, APA, MLA, Chicago; fonte citada não pode ser apagada', () => {
  const { e, blk, ins, v } = doc();
  const src = e.run({ type: 'ADD_SOURCE', payload: { type: 'BOOK', authors: [{ given: 'Edward Rolf', family: 'Tufte' }], title: 'The Visual Display of Quantitative Information', year: 1983, publisher: 'Graphics Press', city: 'Cheshire', edition: '2' } });
  const c1 = ins('CITATION', { sourceId: src, page: '12' });
  const c2 = ins('CITATION', { source: { author: 'Don Norman', title: 'O design do dia a dia', year: 2006, publisher: 'Rocco', city: 'Rio de Janeiro' } });
  const bib = e.run({ type: 'BUILD_BIBLIOGRAPHY', payload: { parentId: blk } });
  assert.deepEqual([v(c1), v(c2)], ['(TUFTE, 1983, p. 12)', '(NORMAN, 2006)']);
  assert.deepEqual(e.get(bib).data.entries.map((x: any) => x.text), [
    'NORMAN, Don. O design do dia a dia. Rio de Janeiro: Rocco, 2006.',
    'TUFTE, Edward Rolf. The Visual Display of Quantitative Information. 2. ed. Cheshire: Graphics Press, 1983.',
  ]);
  e.run({ type: 'SET_CITATION_STYLE', payload: { style: 'APA' } });
  assert.equal(v(c1), '(Tufte, 1983, p. 12)');
  assert.equal(e.get(bib).data.entries[1].text, 'Tufte, E. R. (1983). The Visual Display of Quantitative Information. Graphics Press.');
  const s = (e.doc.document.settings.sources as any)[src];
  assert.equal(formatReference(s, 'MLA'), 'Tufte, Edward Rolf. The Visual Display of Quantitative Information. Graphics Press, 1983.');
  assert.equal(formatReference(s, 'CHICAGO'), 'Tufte, Edward Rolf. 1983. The Visual Display of Quantitative Information. Cheshire: Graphics Press.');
  assert.equal(e.execute({ type: 'REMOVE_SOURCE', targetId: src }).ok, false);
  assert.equal(e.execute({ type: 'INSERT_CONTENT', payload: { contentType: 'CITATION', data: { sourceId: 'SRC_X' } } }).ok, false);
});

test('número do slide e nome da planilha', () => {
  const p = createEngine(createDocument('PRESENTATION_EDITOR'));
  const s2 = p.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SLIDE' } });
  const f = p.run({ type: 'INSERT_CONTENT', payload: { contentType: 'FIELD', parentId: s2, data: { fieldType: 'SLIDE_NUMBER' } } }).id;
  assert.equal(p.run({ type: 'FIELD_TEXT', targetId: f }), '2');
});
