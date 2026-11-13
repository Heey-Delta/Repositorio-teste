// Etapa 13: modos, zoom, apresentação, navegação, painéis, janelas, leitura assistida e régua.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument } from '../../src/editor-core/index.ts';

function deck() {
  const e = createEngine(createDocument('PRESENTATION_EDITOR'));
  const s1 = e.state.activeSurface!;
  const put = (slide: string, contentType: string, data: any, layout: any) => e.run({ type: 'INSERT_CONTENT', payload: { contentType, parentId: slide, data, layout } }).id as string;
  const title = put(s1, 'TEXT', { textType: 'TITLE', text: 'Capa' }, { x: 60, y: 40, width: 1000, height: 80 });
  const right = put(s1, 'TEXT', { text: 'direita' }, { x: 700, y: 200, width: 300, height: 40 });
  const left = put(s1, 'TEXT', { text: 'esquerda' }, { x: 60, y: 200, width: 300, height: 40 });
  const s2 = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SLIDE' } }) as string;
  put(s2, 'TEXT', { textType: 'TITLE', text: 'Resultados' }, { x: 60, y: 40, width: 1000, height: 80 });
  return { e, s1, s2, title, right, left, put };
}

test('modos: leitura bloqueia alterações (mas deixa comentar); edição volta ao normal', () => {
  const e = createEngine(createDocument());
  const t = e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: e.state.activeSurface, data: { text: 'oi' } } }).id;
  e.run({ type: 'SET_VIEW', payload: { mode: 'READ' } });
  assert.match(e.execute({ type: 'TEXT_SET', targetId: t, payload: { text: 'x' } }).error!.message, /leitura/);
  assert.equal(e.execute({ type: 'ADD_COMMENT', targetId: t, payload: { text: 'revisar' } }).ok, true);
  assert.equal(e.execute({ type: 'FIND', payload: { query: 'oi' } }).ok, true);
  e.run({ type: 'SET_VIEW', payload: { mode: 'EDIT' } });
  assert.equal(e.execute({ type: 'TEXT_SET', targetId: t, payload: { text: 'x' } }).ok, true);
  assert.equal(e.execute({ type: 'SET_VIEW', payload: { mode: 'PRESENT' } }).ok, false, 'apresentação só em slides');
});

test('zoom: valor, passos, ajustar à largura/página; auxiliares e tela cheia', () => {
  const e = createEngine(createDocument());
  assert.equal(e.execute({ type: 'SET_VIEW', payload: { zoom: 900 } }).ok, false);
  e.run({ type: 'SET_VIEW', payload: { zoom: 100 } });
  assert.equal((e.run({ type: 'SET_VIEW', payload: { zoomIn: true } }) as any).zoom, 110);
  assert.equal((e.run({ type: 'SET_VIEW', payload: { zoomOut: true } }) as any).zoom, 100);
  const w = e.run({ type: 'SET_VIEW', payload: { fit: 'WIDTH', viewport: { width: 1640, height: 900 } } }) as any;
  assert.equal(w.zoom, Math.floor(((1640 - 48) / 794) * 100));
  const p = e.run({ type: 'SET_VIEW', payload: { fit: 'PAGE', viewport: { width: 1640, height: 900 } } }) as any;
  assert.equal(p.zoom, Math.floor(((900 - 48) / 1123) * 100));
  const v = e.run({ type: 'SET_VIEW', payload: { showGrid: true, showMarks: true, fullscreen: true, rulerUnit: 'IN' } }) as any;
  assert.deepEqual([v.showGrid, v.showMarks, v.fullscreen, v.rulerUnit], [true, true, true, 'IN']);
  assert.equal(e.history.past.length, 0, 'visualização não entra no histórico');
});

test('apresentação: animações passo a passo, transição, voltar, ir para slide e sair', () => {
  const { e, s1, s2, right, left } = deck();
  e.run({ type: 'ADD_ANIMATION', targetId: left, payload: { kind: 'ENTRANCE', effect: 'FADE' } });
  e.run({ type: 'ADD_ANIMATION', targetId: right, payload: { kind: 'ENTRANCE', effect: 'FADE' } });
  e.run({ type: 'SET_TRANSITION', targetId: s2, payload: { effect: 'PUSH' } });
  let st = e.run({ type: 'SET_VIEW', payload: { mode: 'PRESENT' } }) as any;
  assert.deepEqual([st.slideId, st.step, st.hidden.sort()], [s1, 0, [left, right].sort()]);
  assert.equal(e.state.mode, 'PRESENT');
  assert.equal(e.execute({ type: 'TEXT_SET', targetId: left, payload: { text: 'x' } }).ok, false, 'não edita apresentando');
  st = e.run({ type: 'PRESENT_NEXT' }); assert.deepEqual(st.hidden, [right]);
  st = e.run({ type: 'PRESENT_NEXT' }); assert.deepEqual(st.hidden, []);
  st = e.run({ type: 'PRESENT_NEXT' }); assert.deepEqual([st.slideId, st.transition?.effect], [s2, 'PUSH']);
  st = e.run({ type: 'PRESENT_NEXT' }); assert.equal(st.ended, true);
  st = e.run({ type: 'PRESENT_PREV' }); assert.deepEqual([st.slideId, st.hidden], [s1, []], 'volta ao slide anterior já completo');
  st = e.run({ type: 'PRESENT_GOTO', payload: { slide: 1 } }); assert.equal(st.step, 0);
  assert.equal(e.execute({ type: 'HIDE', targetId: s2 }).ok, false, 'apresentando, o documento não muda');
  e.run({ type: 'PRESENT_END' });
  e.run({ type: 'HIDE', targetId: s2 });
  st = e.run({ type: 'PRESENT_START' });
  assert.equal(st.slides, 1, 'slide oculto fica fora');
  e.run({ type: 'PRESENT_END' });
  assert.equal(e.state.mode, 'EDIT');
});

test('navegação: ir para página, título, indicador, slide, planilha e célula', () => {
  const d = createEngine(createDocument());
  const blk = d.state.activeSurface!;
  const ins = (data: any) => d.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data } }).id as string;
  ins({ textType: 'HEADING_1', text: 'Introdução' });
  d.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'BREAK', parentId: blk, breakType: 'PAGE' } });
  const h2 = ins({ textType: 'HEADING_1', text: 'Conclusão' });
  d.run({ type: 'ADD_BOOKMARK', targetId: h2, payload: { name: 'fim' } });
  assert.deepEqual([(d.run({ type: 'GO_TO', payload: { page: 2 } }) as any).nodeId, d.state.selection.primaryId], [h2, h2]);
  assert.equal((d.run({ type: 'GO_TO', payload: { heading: 'conclu' } }) as any).page, 2);
  assert.equal((d.run({ type: 'GO_TO', payload: { bookmark: 'fim' } }) as any).nodeId, h2);
  assert.equal(d.execute({ type: 'GO_TO', payload: { page: 9 } }).ok, false);
  const { e, s2 } = deck();
  assert.equal((e.run({ type: 'GO_TO', payload: { slide: 2 } }) as any).surfaceId, s2);
  const x = createEngine(createDocument('SPREADSHEET_EDITOR'));
  const p2 = x.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SHEET', name: 'Resumo' } });
  const r = x.run({ type: 'GO_TO', payload: { sheet: 'resumo', cell: 'c7' } }) as any;
  assert.deepEqual([r.surfaceId, r.cell], [p2, 'C7']);
});

test('teclado: células, elementos na ordem de leitura, slides e títulos', () => {
  const x = createEngine(createDocument('SPREADSHEET_EDITOR'));
  x.run({ type: 'SET_CELL', targetId: x.state.activeSurface, payload: { cell: 'C3', value: 1 } });
  x.state.activeCell = 'A1';
  const nav = (e: any, payload: any) => e.run({ type: 'NAVIGATE', payload });
  assert.equal(nav(x, { direction: 'DOWN' }).cell, 'A2');
  assert.equal(nav(x, { direction: 'RIGHT' }).cell, 'B2');
  assert.equal(nav(x, { direction: 'UP' }).cell, 'B1');
  assert.equal(nav(x, { direction: 'UP' }).cell, 'B1', 'não sai da planilha');
  assert.equal(nav(x, { direction: 'LAST' }).cell, 'C3');
  const { e, s1, s2, title, left, right } = deck();
  e.state.activeSurface = s1;
  assert.deepEqual([nav(e, { direction: 'NEXT' }).nodeId, nav(e, { direction: 'NEXT' }).nodeId, nav(e, { direction: 'NEXT' }).nodeId], [title, left, right], 'de cima para baixo, da esquerda para a direita');
  assert.equal(nav(e, { direction: 'NEXT', unit: 'SLIDE' }).surfaceId, s2);
  assert.equal(nav(e, { direction: 'PREV', unit: 'SLIDE' }).surfaceId, s1);
});

test('painéis: navegação (títulos com página), slides, camadas; leitura assistida', () => {
  const d = createEngine(createDocument());
  const blk = d.state.activeSurface!;
  const ins = (textType: string, text: string) => d.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data: { textType, text } } });
  ins('HEADING_1', 'Um'); ins('HEADING_2', 'Um.a'); ins('PARAGRAPH', 'texto'); ins('HEADING_1', 'Dois');
  const tree = d.run({ type: 'NAVIGATION_TREE' }) as any[];
  assert.deepEqual(tree.map((n) => [n.title, n.page, n.children.map((c: any) => c.title)]), [['Um', 1, ['Um.a']], ['Dois', 1, []]]);
  const { e, s1, title, right, left } = deck();
  assert.deepEqual((e.run({ type: 'NAVIGATION_TREE' }) as any[]).map((s) => s.title), ['Capa', 'Resultados']);
  e.run({ type: 'BRING_TO_FRONT', targetId: title });
  e.run({ type: 'LOCK', targetId: left });
  const layers = e.run({ type: 'SELECTION_PANEL', targetId: s1 }) as any[];
  assert.equal(layers[0].id, title, 'quem está na frente vem primeiro');
  assert.equal(layers.find((l) => l.id === left).locked, true);
  assert.deepEqual((e.run({ type: 'READING_ORDER', targetId: s1 }) as any[]).map((r) => r.text), ['Capa', 'esquerda', 'direita']);
  e.run({ type: 'UPDATE', targetId: right, payload: { metadata: { readingOrder: 0 } } });
  assert.equal((e.run({ type: 'READING_ORDER', targetId: s1 }) as any[])[0].nodeId, right, 'ordem de leitura explícita vence a posição');
});

test('janelas: várias visões do mesmo documento, cada uma com zoom e superfície', () => {
  const { e, s1, s2 } = deck();
  e.state.activeSurface = s1;
  e.run({ type: 'SET_VIEW', payload: { zoom: 80 } });
  const v2 = e.run({ type: 'OPEN_VIEW', payload: { surfaceId: s2, zoom: 150 } }) as any;
  e.run({ type: 'SWITCH_VIEW', payload: { viewId: v2.id } });
  assert.deepEqual([e.state.activeSurface, e.state.zoom], [s2, 150]);
  e.run({ type: 'UPDATE_VIEW', payload: { viewId: v2.id, scroll: { x: 0, y: 300 } } });
  e.run({ type: 'SWITCH_VIEW', payload: { viewId: 'VIEW_1' } });
  assert.deepEqual([e.state.activeSurface, e.state.zoom], [s1, 80]);
  assert.equal((e.run({ type: 'LIST_VIEWS' }) as any[]).length, 2);
  e.run({ type: 'CLOSE_VIEW', payload: { viewId: v2.id } });
  assert.equal(e.execute({ type: 'CLOSE_VIEW', payload: { viewId: 'VIEW_1' } }).ok, false, 'a última janela fica');
});

test('régua: unidade, escala com zoom, margens e recuos do parágrafo', () => {
  const e = createEngine(createDocument());
  const t = e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: e.state.activeSurface, data: { text: 'oi' } } }).id;
  e.run({ type: 'FORMAT', targetId: t, payload: { indentLeft: 96 } });
  e.run({ type: 'SELECT', targetId: t });
  e.run({ type: 'SET_VIEW', payload: { zoom: 200, rulerUnit: 'IN' } });
  const r = e.run({ type: 'RULER' }) as any;
  assert.equal(r.unit, 'IN');
  assert.equal(r.pxPerUnit, 192);
  assert.equal(r.length, Math.round((794 / 96) * 100) / 100);
  assert.equal(r.indents.left, 1);
  assert.ok(r.marginStart > 0 && r.marginEnd < r.length);
});
