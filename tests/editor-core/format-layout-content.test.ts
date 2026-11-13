// Formatação, temas, layout, texto e inserção de conteúdo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument } from '../../src/editor-core/index.ts';

function slide() {
  const e = createEngine(createDocument('PRESENTATION_EDITOR'));
  const s = e.state.activeSurface!;
  const shape = (x: number, y = 0, w = 50, h = 50) => e.run({ type: 'CREATE', payload: { parentId: s, nodeType: 'SHAPE', data: { shapeType: 'RECTANGLE' }, layout: { mode: 'ABSOLUTE', x, y, width: w, height: h } } }).id as string;
  return { e, s, shape };
}

test('aparência final = tema → estilo → ajustes; mudar o tema muda quem usa a referência', () => {
  const { e, shape } = slide();
  const a = shape(0);
  e.run({ type: 'FORMAT', targetId: a, payload: { fill: 'theme:accent', opacity: 0.5 } });
  const st = e.run({ type: 'CREATE_STYLE', payload: { name: 'Contorno forte', type: 'SHAPE', properties: { stroke: '#000000', strokeWidth: 4 } } });
  e.run({ type: 'APPLY_STYLE', targetId: a, payload: { styleId: st } });
  e.run({ type: 'UPDATE_STYLE', targetId: st, payload: { properties: { strokeWidth: 8 } } });
  e.run({ type: 'UPDATE_THEME', payload: { colors: { accent: '#00FF00' } } });
  assert.deepEqual(e.run({ type: 'RESOLVE_STYLE', targetId: a }), { opacity: 0.5, fill: '#00FF00', stroke: '#000000', strokeWidth: 8 });
});

test('formatação é validada por tipo e por valor', () => {
  const { e, shape } = slide();
  const a = shape(0);
  assert.match(e.execute({ type: 'FORMAT', targetId: a, payload: { arrowStart: 'x' } }).error!.message, /não aceita/);
  assert.equal(e.execute({ type: 'FORMAT', targetId: a, payload: { opacity: 2 } }).ok, false);
  assert.equal(e.execute({ type: 'FORMAT', targetId: a, payload: { fill: 'azulzinho' } }).ok, false);
  assert.equal(e.execute({ type: 'FORMAT', targetId: a, payload: { fontSize: -1 } }).ok, false);
});

test('apagar um estilo preserva a aparência de quem usava; CLEAR_FORMAT limpa só os ajustes', () => {
  const { e, shape } = slide();
  const a = shape(0);
  const st = e.run({ type: 'CREATE_STYLE', payload: { name: 'X', properties: { fill: '#111111' } } });
  e.run({ type: 'APPLY_STYLE', targetId: a, payload: { styleId: st } });
  e.run({ type: 'DELETE_STYLE', targetId: st });
  assert.equal(e.get(a).styleId, null);
  assert.equal(e.get(a).styleOverrides.fill, '#111111');
  e.run({ type: 'CLEAR_FORMAT', targetId: a });
  assert.deepEqual(e.get(a).styleOverrides, {});
});

test('pincel de formatação leva só propriedades que o destino aceita', () => {
  const { e, s, shape } = slide();
  const a = shape(0);
  e.run({ type: 'FORMAT', targetId: a, payload: { fill: '#FF0000', strokeWidth: 3 } });
  const line = e.run({ type: 'CREATE', payload: { parentId: s, nodeType: 'LINE', data: { lineType: 'STRAIGHT', start: { point: { x: 0, y: 0 } }, end: { point: { x: 1, y: 1 } } }, layout: { mode: 'ABSOLUTE' } } }).id;
  e.run({ type: 'COPY_FORMAT', targetId: a });
  e.run({ type: 'PASTE_FORMAT', targetId: line });
  assert.deepEqual(e.get(line).styleOverrides, { strokeWidth: 3 });
});

test('alinhar, distribuir, redimensionar com proporção e limites', () => {
  const { e, shape } = slide();
  const a = shape(0, 30), b = shape(100, 60, 80), c = shape(400, 10);
  e.run({ type: 'ALIGN', targetIds: [a, b, c], payload: { alignment: 'TOP' } });
  assert.deepEqual([a, b, c].map((id) => e.get(id).layout.y), [10, 10, 10]);
  e.run({ type: 'DISTRIBUTE', targetIds: [a, b, c], payload: { axis: 'HORIZONTAL' } });
  assert.deepEqual([a, b, c].map((id) => e.get(id).layout.x), [0, 185, 400]);
  e.run({ type: 'ALIGN', targetId: c, payload: { alignment: 'CENTER' } });
  assert.equal(e.get(c).layout.x, 1280 / 2 - 25, 'sozinho, alinha ao slide');
  e.run({ type: 'SET_CONSTRAINT', targetId: a, payload: { lockAspectRatio: true, maxWidth: 200 } });
  e.run({ type: 'RESIZE', targetId: a, payload: { width: 300 } });
  assert.deepEqual([e.get(a).layout.width, e.get(a).layout.height], [200, 200]);
  assert.equal(e.execute({ type: 'RESIZE', targetId: a, payload: { width: 0 } }).ok, false);
});

test('redimensionar um grupo escala os filhos', () => {
  const { e, shape } = slide();
  const a = shape(0, 0, 50, 50), b = shape(50, 50, 50, 50);
  const g = e.run({ type: 'GROUP', targetIds: [a, b] });
  e.run({ type: 'RESIZE', targetId: g, payload: { width: 200, height: 200 } });
  assert.deepEqual([e.get(b).layout.x, e.get(b).layout.y, e.get(b).layout.width], [100, 100, 100]);
});

test('encaixe (snap) em objetos vizinhos, guias e grade', () => {
  const { e, shape } = slide();
  const a = shape(0, 0, 100, 50), b = shape(300, 300);
  assert.equal(e.run({ type: 'SNAP', targetId: b, payload: { x: 103, y: 300 } }).x, 100);
  e.run({ type: 'ADD_GUIDE', payload: { orientation: 'HORIZONTAL', position: 250 } });
  assert.equal(e.run({ type: 'SNAP', targetId: b, payload: { x: 300, y: 247 } }).y, 250);
  e.run({ type: 'SET_GRID', payload: { enabled: true, size: 20 } });
  assert.equal(e.run({ type: 'SNAP', targetId: b, payload: { x: 437, y: 333 } }).x, 440);
  e.run({ type: 'SET_POSITION', targetId: b, payload: { x: 437, y: 333, snap: true } });
  assert.equal(e.get(b).layout.x, 440);
  assert.equal(e.get(a).layout.x, 0);
});

test('elemento em fluxo não aceita coordenadas; trocar o modo libera', () => {
  const e = createEngine(createDocument());
  const t = e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', data: { text: 'oi' } } });
  assert.equal(t.layout.mode, 'FLOW');
  assert.equal(e.execute({ type: 'MOVE', targetId: t.id, payload: { x: 10, y: 10 } }).ok, false);
  e.run({ type: 'SET_LAYOUT', targetId: t.id, payload: { mode: 'ABSOLUTE', x: 0, y: 0, width: 100, height: 20 } });
  assert.equal(e.execute({ type: 'MOVE', targetId: t.id, payload: { x: 10, y: 10 } }).ok, true);
});

test('texto com trechos: formatar parte, inserir herdando formato, substituir e maiúsculas', () => {
  const e = createEngine(createDocument());
  const t = e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', data: { text: 'Meu primeiro documento' } } }).id;
  e.run({ type: 'TEXT_FORMAT', targetId: t, payload: { start: 13, end: 22, format: { bold: true } } });
  e.run({ type: 'TEXT_INSERT', targetId: t, payload: { offset: 22, text: ' novo' } });
  const runs = () => e.get(t).data.runs.map((r: any) => [r.text, r.format]);
  assert.deepEqual(runs(), [['Meu primeiro ', {}], ['documento novo', { bold: true }]]);
  assert.equal(e.run({ type: 'REPLACE', payload: { query: 'primeiro', replacement: 'segundo' } }), 1);
  e.run({ type: 'CHANGE_CASE', targetId: t, payload: { mode: 'TITLE' } });
  assert.deepEqual(runs(), [['Meu Segundo ', {}], ['Documento Novo', { bold: true }]]);
  e.run({ type: 'TEXT_DELETE', targetId: t, payload: { start: 3, end: 11 } });
  assert.equal(e.get(t).data.runs.map((r: any) => r.text).join(''), 'Meu Documento Novo');
  assert.deepEqual(e.run({ type: 'TEXT_STATS' }), { paragraphs: 1, words: 3, characters: 18, charactersNoSpaces: 16 });
  assert.equal(e.run({ type: 'FIND', payload: { query: 'novo', wholeWord: true } }).length, 1);
});

test('inserção: construtores e validadores por tipo', () => {
  const { e, s } = slide();
  const ins = (contentType: string, data: any) => e.execute({ type: 'INSERT_CONTENT', payload: { contentType, data, parentId: s } });
  const asset = e.run({ type: 'IMPORT_ASSET', payload: { type: 'IMAGE', name: 'a.webp', source: '/a.webp', width: 1600, height: 900 } });
  const img = ins('IMAGE', { assetId: asset, alt: 'Foto' });
  assert.ok(img.ok && img.value.layout.width === 480 && img.value.layout.height === 270);
  assert.equal(ins('IMAGE', { assetId: 'ASSET_X', alt: '' }).ok, false);
  assert.equal(ins('SHAPE', { shapeType: 'NUVEM' }).ok, false);
  assert.equal(ins('LINK', { url: 'javascript:alert(1)' }).ok, false);
  assert.equal(ins('LINE', { lineType: 'CONNECTOR', start: { targetId: 'X' }, end: { point: { x: 0, y: 0 } } }).ok, false);
  assert.equal(ins('DIAGRAM', { items: [{ id: 'a', label: 'A' }], connections: [{ from: 'a', to: 'z' }] }).ok, false);
  assert.equal(ins('EQUATION', { latex: 'E=mc^2' }).ok, true);
  assert.equal(ins('CITATION', { source: { author: 'Tufte' } }).ok, true);
  assert.equal(e.run({ type: 'REMOVE_UNUSED_ASSETS' }).length, 0);
});

test('estruturas: listas com níveis, cabeçalho, quebra, novos slides e planilhas com nome único', () => {
  const d = createEngine(createDocument());
  const list = d.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'LIST', listType: 'NUMBERED', items: ['um', { text: 'dois', level: 1 }] } });
  assert.equal(d.get(list).children.length, 2);
  const item = d.get(list).children[1];
  d.run({ type: 'SET_LIST_LEVEL', targetId: item, payload: { delta: 1 } });
  assert.equal(d.get(item).data.level, 2);
  const header = d.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'REGION', regionType: 'HEADER', parentId: d.doc.document.rootId } });
  assert.equal(d.get(d.doc.document.rootId).children[0], header);
  const s = createEngine(createDocument('SPREADSHEET_EDITOR'));
  const second = s.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SHEET' } });
  assert.equal(s.get(second).data.name, 'Planilha2');
  assert.equal(s.execute({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SHEET', name: 'Planilha1' } }).ok, false);
});
