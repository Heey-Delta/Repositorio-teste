// Etapa 02: colar especial (células e elementos) e arrastar e soltar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument } from '../../src/editor-core/index.ts';

function sheet() {
  const e = createEngine(createDocument('SPREADSHEET_EDITOR'));
  const sh = e.state.activeSurface!;
  e.run({ type: 'SET_CELLS', targetId: sh, payload: { start: 'A1', values: [[1, 2], [3, '=A2+B1']] } });
  e.run({ type: 'FORMAT_CELLS', targetId: sh, payload: { range: 'A1', properties: { bold: true } } });
  const g = (c: string, id = sh) => e.run({ type: 'GET_CELL', targetId: id, payload: { cell: c } });
  return { e, sh, g };
}

test('colar células: tudo, só valores, só formatação, transposto', () => {
  const { e, sh, g } = sheet();
  e.run({ type: 'COPY_CELLS', targetId: sh, payload: { range: 'A1:B2' } });
  e.run({ type: 'PASTE', targetId: sh, payload: { cell: 'D1' } });
  assert.equal(g('E2').formula, '=D2+E1');
  assert.equal(g('E2').display, 5);
  assert.equal(e.get(sh).data.cells.D1.styleOverrides.bold, true);
  e.run({ type: 'PASTE', targetId: sh, payload: { cell: 'D5', mode: 'VALUES' } });
  assert.deepEqual([g('E6').formula, g('E6').display], [null, 5]);
  e.run({ type: 'PASTE', targetId: sh, payload: { cell: 'K1', mode: 'FORMAT_ONLY' } });
  assert.deepEqual([g('K1').value, e.get(sh).data.cells.K1.styleOverrides.bold], [null, true]);
  e.run({ type: 'PASTE', targetId: sh, payload: { cell: 'G1', transpose: true } });
  assert.deepEqual(e.run({ type: 'GET_RANGE', targetId: sh, payload: { range: 'G1:H2' } }), [[1, 3], [2, 5]]);
});

test('colar como vínculo entre planilhas acompanha a origem', () => {
  const { e, sh, g } = sheet();
  const s2 = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SHEET', name: 'Dados 2' } });
  e.run({ type: 'COPY_CELLS', targetId: sh, payload: { range: 'A1:B2' } });
  e.run({ type: 'PASTE', targetId: s2, payload: { cell: 'A1', mode: 'LINK' } });
  assert.equal(g('B2', s2).formula, '=Planilha1!B2');
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'A2', value: 10 } });
  assert.equal(g('B2', s2).display, 12);
  e.run({ type: 'COPY_CELLS', targetId: s2, payload: { range: 'A1' } });
  assert.equal(e.execute({ type: 'PASTE', targetId: sh, payload: { cell: 'Z1', mode: 'LINK' } }).ok, true);
});

test('recortar e colar células: a origem é limpa e as fórmulas seguem as células', () => {
  const { e, sh, g } = sheet();
  e.run({ type: 'CUT_CELLS', targetId: sh, payload: { range: 'A1:A2' } });
  assert.equal(g('A1').value, 1, 'a origem só é limpa depois de colar');
  e.run({ type: 'PASTE', targetId: sh, payload: { cell: 'J1' } });
  assert.deepEqual([g('A1').value, g('J1').value, g('J2').value], [null, 1, 3]);
  assert.equal(g('B2').formula, '=J2+B1');
  assert.equal(g('B2').display, 5);
  assert.equal(e.state.clipboard, null);
  e.run({ type: 'UNDO' });
  assert.deepEqual([g('A1').value, g('B2').formula], [1, '=A2+B1']);
});

test('colar elementos: só valores/transposto são recusados; colar como vínculo cria links', () => {
  const e = createEngine(createDocument());
  const t = e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', data: { text: 'Introdução' } } }).id;
  e.run({ type: 'COPY', targetId: t });
  assert.equal(e.execute({ type: 'PASTE', payload: { mode: 'VALUES' } }).ok, false);
  const [link] = e.run({ type: 'PASTE', payload: { mode: 'LINK' } });
  assert.deepEqual([e.get(link).type, e.get(link).data.targetId, e.get(link).data.runs[0].text], ['LINK', t, 'Introdução']);
});

test('arrastar e soltar: outro slide, posição mantendo distâncias, cópia, arquivos, reordenar texto', () => {
  const p = createEngine(createDocument('PRESENTATION_EDITOR'));
  const slide = p.state.activeSurface!;
  const slide2 = p.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SLIDE' } });
  const a = p.run({ type: 'INSERT_CONTENT', payload: { contentType: 'SHAPE', parentId: slide, layout: { x: 10, y: 10 } } }).id;
  const b = p.run({ type: 'INSERT_CONTENT', payload: { contentType: 'SHAPE', parentId: slide, layout: { x: 110, y: 60 } } }).id;
  p.run({ type: 'DROP', targetIds: [a, b], payload: { destinationId: slide2, x: 300, y: 300 } });
  assert.deepEqual([p.get(a).parentId, p.get(a).layout.x, p.get(b).layout.x, p.get(b).layout.y], [slide2, 300, 400, 350]);
  const [copy] = p.run({ type: 'DROP', targetIds: [a], payload: { destinationId: slide, x: 0, y: 0, copy: true } });
  assert.deepEqual([p.get(copy).parentId, p.get(a).parentId], [slide, slide2]);
  const [img] = p.run({ type: 'DROP', payload: { destinationId: slide, x: 50, y: 50, files: [{ name: 'f.png', mimeType: 'image/png', source: '/f.png', size: 10, width: 200, height: 100 }] } });
  assert.deepEqual([p.get(img).type, p.get(img).layout.x], ['IMAGE', 50]);
  assert.equal(p.execute({ type: 'DROP', payload: { destinationId: slide, files: [{ name: 'a.zip', mimeType: 'application/zip', source: '/a' }] } }).ok, false);
  assert.equal(p.execute({ type: 'DROP', targetIds: [slide2], payload: { destinationId: slide } }).ok, false, 'slide não entra em slide');
  const d = createEngine(createDocument());
  const t1 = d.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', data: { text: 'um' } } }).id;
  const t2 = d.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', data: { text: 'dois' } } }).id;
  d.run({ type: 'DROP', targetIds: [t2], payload: { destinationId: d.get(t1).parentId, index: 0 } });
  assert.equal(d.get(d.get(t1).parentId!).children[0], t2);
});
