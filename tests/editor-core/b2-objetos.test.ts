// B2 · imagens (recorte, ajustes), formas (biblioteca, pontos, booleanas) e tabelas (dividir, estilos, ajuste).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, exportDocument, imageFilter, imageClip, tableCellLook, shapeSvg, SHAPES } from '../../src/editor-core/index.ts';
import { fitPath } from '../../src/editor-core/io/shapes.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const setup = (app: any = 'DOCUMENT_EDITOR') => {
  const e = createEngine(createDocument(app));
  const blk = e.state.activeSurface!;
  const ins = (contentType: string, data: any, layout?: any) => e.run({ type: 'INSERT_CONTENT', payload: { contentType, parentId: blk, data, ...(layout ? { layout } : {}) } }).id as string;
  return { e, blk, ins };
};
const img = (e: any, ins: any) => { const a = e.run({ type: 'IMPORT_ASSET', payload: { type: 'IMAGE', name: 'x.png', source: PNG, width: 400, height: 200 } }) as string; return ins('IMAGE', { assetId: a, alt: 'teste' }, { width: 400, height: 200 }); };

test('imagem: recorte por margens, proporção e forma; ajustes viram filtro; redefinir volta', () => {
  const { e, ins } = setup();
  const id = img(e, ins);
  e.run({ type: 'IMAGE_CROP', targetId: id, payload: { left: 0.1, right: 0.1 } });
  assert.equal(imageClip(e.get(id).data.crop), 'inset(0% 10% 0% 10%)');
  e.run({ type: 'IMAGE_CROP', targetId: id, payload: { aspect: '1:1' } });
  assert.deepEqual([e.get(id).layout.width, e.get(id).data.crop.left], [200, 0.25]);
  e.run({ type: 'IMAGE_CROP', targetId: id, payload: { shape: 'CIRCLE' } });
  assert.match(imageClip(e.get(id).data.crop), /^path\('M0,50 A50,50/);
  assert.throws(() => e.run({ type: 'IMAGE_CROP', targetId: id, payload: { left: 0.5, right: 0.5 } }), /margem vai de 0 a 0,9|inteira/);
  const r = e.run({ type: 'IMAGE_ADJUST', targetId: id, payload: { brightness: 20, contrast: -10, grayscale: true, transparency: 0.3 } }) as any;
  assert.equal(r.filter, 'brightness(1.2) contrast(0.9) grayscale(1)');
  assert.equal(r.opacity, 0.7);
  assert.match(imageFilter({ recolor: '#0000FF' }), /hue-rotate\(200deg\)/);
  assert.throws(() => e.run({ type: 'IMAGE_ADJUST', targetId: id, payload: { brightness: 300 } }), /vai de/);
  e.run({ type: 'TRANSFORM', targetId: id, payload: { rotation: 90, flipH: true } });
  e.run({ type: 'IMAGE_RESET', targetId: id, payload: { size: true } });
  const n = e.get(id);
  assert.deepEqual([n.data.crop, n.data.adjust, n.layout.rotation, n.layout.flipH, n.layout.width], [null, undefined, 0, false, 400]);
});

test('formas: biblioteca com 30 desenhos; caminho estica para a caixa; pontos editáveis', () => {
  const { e, ins } = setup('PRESENTATION_EDITOR');
  assert.ok(Object.keys(SHAPES).length >= 30);
  assert.equal(fitPath('M0,0 H100 V100 H0 Z', 10, 20, 200, 50), 'M10,20 H210 V70 H10 Z');
  assert.equal(fitPath('M0,50 A50,50 0 1 1 100,50', 0, 0, 200, 100), 'M0,50 A100,50 0 1 1 200,50');
  for (const k of ['HEART', 'CLOUD', 'LIGHTNING', 'CYLINDER', 'ARROW_UP']) ins('SHAPE', { shapeType: k });
  const s = ins('SHAPE', { shapeType: 'TRIANGLE' }, { x: 0, y: 0, width: 100, height: 100 });
  assert.deepEqual(e.run({ type: 'SHAPE_EDIT_POINTS', targetId: s }), [[50, 0], [100, 100], [0, 100]]);
  e.run({ type: 'SHAPE_EDIT_POINTS', targetId: s, payload: { points: [[0, 0], [100, 0], [50, 80]] } });
  assert.deepEqual([e.get(s).data.shapeType, e.get(s).data.path], ['CUSTOM', 'M0,0 L100,0 L50,80 Z']);
  assert.match(shapeSvg(e.get(s).data, 100, 100, { fill: '#F00' }), /<path d="M0,0 L100,0 L50,80 Z" fill="#F00"/);
  assert.equal((e.run({ type: 'SHAPE_GALLERY' }) as any[]).find((g) => g.id === 'HEART').label, 'Coração');
});

test('formas: unir, combinar, subtrair e interseção geram uma forma só; desfazer volta as originais', () => {
  const { e, blk, ins } = setup('PRESENTATION_EDITOR');
  const a = ins('SHAPE', { shapeType: 'RECTANGLE' }, { x: 0, y: 0, width: 100, height: 100 });
  const b = ins('SHAPE', { shapeType: 'CIRCLE' }, { x: 50, y: 50, width: 100, height: 100 });
  e.run({ type: 'FORMAT', targetId: a, payload: { fill: '#FBBF00', stroke: '#000000' } });
  for (const mode of ['UNION', 'COMBINE', 'SUBTRACT', 'INTERSECT']) {
    const id = e.run({ type: 'SHAPE_BOOLEAN', payload: { ids: [a, b], mode } }) as string;
    const n = e.get(id);
    assert.deepEqual([n.layout.x, n.layout.y, n.layout.width, n.layout.height, n.data.boolean.mode, n.data.boolean.parts.length, n.styleOverrides.fill], [0, 0, 150, 150, mode, 2, '#FBBF00']);
    assert.equal(n.data.boolean.parts[0], 'M0,0 H66.67 V66.67 H0 Z');
    const svg = shapeSvg(n.data, 150, 150, { fill: '#FBBF00', stroke: '#000' });
    assert.match(svg, mode === 'UNION' ? /stroke-width="4"/ : mode === 'COMBINE' ? /evenodd/ : mode === 'SUBTRACT' ? /<mask/ : /clip-path/);
    assert.deepEqual([e.find(a), e.find(b)], [undefined, undefined]);
    e.run({ type: 'UNDO' });
    assert.ok(e.find(a) && e.find(b) && !e.find(id));
  }
  assert.throws(() => e.run({ type: 'SHAPE_BOOLEAN', payload: { ids: [a], mode: 'UNION' } }), /pelo menos duas/);
  assert.match(exportDocument(e, 'SVG', { targetId: blk } as any).data as string, /<path/);
  assert.ok(e.get(blk));
});

test('tabela: dividir, estilos da galeria, ajuste automático e propriedades', () => {
  const { e, blk, ins } = setup();
  const t = ins('TABLE', { values: [['Produto', 'Preço'], ['Notebook muito bom', '3500'], ['Mouse', '50'], ['Total', '3550']] });
  const lower = e.run({ type: 'TABLE_SPLIT', targetId: t, payload: { row: 2, repeatHeader: true } }) as string;
  assert.deepEqual([e.get(t).data.rows.length, e.get(lower).data.rows.length, e.get(lower).data.rows[0].cells[0].value], [2, 3, 'Produto']);
  assert.equal(e.get(blk).children.indexOf(lower), e.get(blk).children.indexOf(t) + 1);
  e.run({ type: 'TABLE_STYLE', targetId: lower, payload: { style: 'ACCENT', totalRow: true, bandedRows: true } });
  const d = e.get(lower).data;
  assert.deepEqual([tableCellLook(d, 0, 0).fill, tableCellLook(d, 2, 1).bold, tableCellLook(d, 1, 0).fill], ['#FBBF00', true, undefined]);
  assert.throws(() => e.run({ type: 'TABLE_STYLE', targetId: t, payload: { style: 'ROXO' } }), /Estilo de tabela/);
  const w = e.run({ type: 'TABLE_AUTOFIT', targetId: t, payload: { mode: 'CONTENT' } }) as number[];
  assert.ok(w[0] > w[1]);
  const ww = e.run({ type: 'TABLE_AUTOFIT', targetId: t, payload: { mode: 'WINDOW', width: 600 } }) as number[];
  assert.ok(Math.abs(ww.reduce((x, y) => x + y, 0) - 600) <= 2);
  assert.deepEqual(e.run({ type: 'TABLE_PROPERTIES', targetId: t, payload: { repeatHeader: true, align: 'CENTER' } }), { repeatHeader: true, align: 'CENTER', allowRowBreak: true, caption: '' });
  assert.ok((e.run({ type: 'TABLE_STYLES' }) as any[]).length >= 8);
});
