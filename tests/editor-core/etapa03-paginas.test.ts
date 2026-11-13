// Etapa 03: layout de páginas, paginação, cabeçalho/rodapé, colunas, fundo, impressão, slides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument } from '../../src/editor-core/index.ts';

const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40);
function doc(paragraphs = 6) {
  const e = createEngine(createDocument());
  const blk = e.state.activeSurface!;
  const ids = Array.from({ length: paragraphs }, (_, i) => e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data: { text: `${i} ${lorem}` } } }).id as string);
  return { e, blk, ids, root: e.doc.document.rootId };
}

test('paginação: parágrafos longos se dividem entre páginas, sem perder linhas', () => {
  const { e, ids } = doc();
  const pages = e.run({ type: 'PAGINATE' });
  assert.ok(pages.length > 1);
  const pieces = pages.flatMap((p: any) => p.columns.flatMap((c: any) => c.items));
  for (const id of ids) {
    const parts = pieces.filter((x: any) => x.nodeId === id);
    const split = parts.filter((x: any) => x.lines);
    if (split.length) {
      assert.equal(split[0].lines[0], 0);
      for (let i = 1; i < split.length; i++) assert.equal(split[i].lines[0], split[i - 1].lines[1], 'linhas contínuas');
    }
  }
  for (const p of pages) for (const it of p.columns[0].items) assert.ok(it.y + it.height <= p.contentArea.height + 1, 'nada passa da área útil');
});

test('configuração: tamanho, orientação, margens ABNT e validação', () => {
  const { e } = doc(1);
  const s = e.run({ type: 'SET_PAGE', payload: { size: 'A4', orientation: 'LANDSCAPE', margins: 'ABNT' } });
  assert.deepEqual([s.width, s.height, s.margins.top, s.margins.left, s.margins.right], [1123, 794, 113, 113, 76]);
  assert.equal(e.execute({ type: 'SET_PAGE', payload: { margins: { left: 600, right: 600 } } }).ok, false);
  assert.equal(e.execute({ type: 'SET_PAGE', payload: { size: 'B9' } }).ok, false);
  e.run({ type: 'UNDO' });
  assert.equal(e.run({ type: 'PAGE_SETUP' }).width, 794);
});

test('colunas, quebra de página manual e seção com página própria', () => {
  const { e, blk, ids } = doc(3);
  e.run({ type: 'SET_COLUMNS', payload: { count: 2 } });
  const p1 = e.run({ type: 'PAGINATE' })[0];
  assert.equal(p1.columns.length, 2);
  assert.ok(p1.columns[1].items.length > 0, 'texto continua na segunda coluna');
  e.run({ type: 'SET_COLUMNS', payload: { count: 1 } });
  e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'BREAK', breakType: 'PAGE', parentId: blk, index: 1 } });
  const pages = e.run({ type: 'PAGINATE' });
  const second = pages.find((p: any) => p.columns[0].items.some((x: any) => x.nodeId === ids[1]));
  assert.ok(pages.slice(0, pages.indexOf(second)).every((p: any) => p.columns[0].items.every((x: any) => x.nodeId === ids[0])), 'depois da quebra só começa o segundo');
  const sec = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SECTION', title: 'Anexo' } });
  e.run({ type: 'SET_PAGE', targetId: sec, payload: { orientation: 'LANDSCAPE' } });
  e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: e.get(sec).children[0], data: { text: 'Anexo A' } } });
  const last = e.run({ type: 'PAGINATE' }).at(-1);
  assert.deepEqual([last.sectionId, last.width], [sec, 1123]);
  assert.equal(e.run({ type: 'PAGE_SETUP' }).width, 794, 'o resto do documento continua em retrato');
});

test('cabeçalho e rodapé: todas, primeira diferente, pares e ímpares', () => {
  const { e, root } = doc(6);
  const all = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'REGION', regionType: 'HEADER', parentId: root } });
  const first = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'REGION', regionType: 'HEADER', parentId: root, applyTo: 'FIRST' } });
  const even = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'REGION', regionType: 'HEADER', parentId: root, applyTo: 'EVEN' } });
  const foot = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'REGION', regionType: 'FOOTER', parentId: root } });
  let pages = e.run({ type: 'PAGINATE' });
  assert.ok(pages.every((p: any) => p.headerId === all && p.footerId === foot));
  e.run({ type: 'SET_HEADER_FOOTER', payload: { differentFirstPage: true, differentOddEven: true } });
  pages = e.run({ type: 'PAGINATE' });
  assert.deepEqual(pages.slice(0, 3).map((p: any) => p.headerId), [first, even, all]);
  assert.ok(!pages[0].columns.some((c: any) => c.items.some((x: any) => [all, first, even, foot].includes(x.nodeId))), 'cabeçalho não entra no fluxo');
});

test('medição plugável: a interface pode trocar a estimativa pela medida real', () => {
  const { e } = doc(3);
  e.services.measure = () => ({ height: 2000 });   // cada elemento maior que uma página
  assert.equal(e.run({ type: 'PAGINATE' }).length, 3);
});

test('plano de fundo, impressão e tamanho de slide (conteúdo acompanha)', () => {
  const { e } = doc(1);
  e.run({ type: 'SET_BACKGROUND', payload: { color: '#FFFDF5' } });
  assert.equal(e.run({ type: 'PAGINATE' })[0].background.color, '#FFFDF5');
  assert.equal(e.execute({ type: 'SET_BACKGROUND', payload: { assetId: 'ASSET_X' } }).ok, false);
  assert.equal(e.run({ type: 'SET_PRINT', payload: { range: '1-2,4', copies: 2 } }).copies, 2);
  assert.equal(e.execute({ type: 'SET_PRINT', payload: { range: 'metade' } }).ok, false);
  const p = createEngine(createDocument('PRESENTATION_EDITOR'));
  const s = p.state.activeSurface!;
  const sh = p.run({ type: 'INSERT_CONTENT', payload: { contentType: 'SHAPE', parentId: s, layout: { x: 640, y: 360, width: 100, height: 100 } } }).id;
  p.run({ type: 'SET_SLIDE_SIZE', payload: { preset: '4:3' } });
  assert.deepEqual([p.get(s).layout.width, p.get(sh).layout.x, p.get(sh).layout.width], [1024, 512, 80]);
  p.run({ type: 'SET_BACKGROUND', targetId: s, payload: { gradient: { from: '#000000', to: '#FBBF00', angle: 90 } } });
  assert.equal(p.get(s).data.background.gradient.to, '#FBBF00');
});
