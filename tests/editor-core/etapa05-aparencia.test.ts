// Etapa 05: bordas, sombras e efeitos; formatação condicional; filtros combinados; modelos e layouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, documentFromTemplate, MemoryTemplateLibrary } from '../../src/editor-core/index.ts';

function slide() {
  const e = createEngine(createDocument('PRESENTATION_EDITOR'));
  const s = e.state.activeSurface!;
  const shape = (x = 0) => e.run({ type: 'CREATE', payload: { parentId: s, nodeType: 'SHAPE', data: { shapeType: 'RECTANGLE' }, layout: { mode: 'ABSOLUTE', x, y: 0, width: 50, height: 50 } } }).id as string;
  return { e, s, shape };
}
function sheet(values: unknown[][]) {
  const e = createEngine(createDocument('SPREADSHEET_EDITOR'));
  const sh = e.state.activeSurface!;
  e.run({ type: 'SET_CELLS', targetId: sh, payload: { start: 'A1', values } });
  return { e, sh, looks: (range?: string) => e.run({ type: 'CONDITIONAL_STYLES', targetId: sh, payload: { range } }) as Record<string, any> };
}

test('bordas por lado, sombra e efeitos são validados', () => {
  const { e, shape } = slide();
  const a = shape();
  assert.equal(e.execute({ type: 'FORMAT', targetId: a, payload: { border: { top: { color: '#000000', width: 2, style: 'DASHED' } }, shadow: { x: 2, y: 4, blur: 8, color: '#00000080' }, effects: { glow: { color: '#FBBF00', size: 6 }, grayscale: 0.5 } } }).ok, true);
  assert.equal(e.execute({ type: 'FORMAT', targetId: a, payload: { border: { diagonal: { color: '#000000', width: 1, style: 'SOLID' } } } }).ok, false, 'lado desconhecido');
  assert.equal(e.execute({ type: 'FORMAT', targetId: a, payload: { border: { all: { color: '#000000', width: 1, style: 'WAVY' } } } }).ok, false, 'estilo de linha');
  assert.equal(e.execute({ type: 'FORMAT', targetId: a, payload: { shadow: { x: 0, y: 0, blur: -1, color: '#000000' } } }).ok, false, 'desfoque negativo');
  assert.equal(e.execute({ type: 'FORMAT', targetId: a, payload: { effects: { grayscale: 3 } } }).ok, false, 'efeito fora da faixa');
  assert.equal(e.execute({ type: 'FORMAT', targetId: a, payload: { effects: { sparkle: 1 } } }).ok, false, 'efeito desconhecido');
});

test('formatação condicional: valor, texto, duplicados, maiores e média', () => {
  const { e, sh, looks } = sheet([['Nome', 'Nota'], ['Ana', 9], ['Bia', 4], ['Caio', 7], ['Ana', 10]]);
  e.run({ type: 'ADD_CONDITIONAL_FORMAT', targetId: sh, payload: { range: 'B2:B5', rule: { type: 'CELL_VALUE', operator: 'LT', value: 5 }, style: { fill: '#FF0000' } } });
  e.run({ type: 'ADD_CONDITIONAL_FORMAT', targetId: sh, payload: { range: 'A2:A5', rule: { type: 'DUPLICATES' }, style: { bold: true } } });
  e.run({ type: 'ADD_CONDITIONAL_FORMAT', targetId: sh, payload: { range: 'B2:B5', rule: { type: 'TOP', count: 1 }, style: { color: '#00AA00' } } });
  e.run({ type: 'ADD_CONDITIONAL_FORMAT', targetId: sh, payload: { range: 'B2:B5', rule: { type: 'ABOVE_AVERAGE' }, style: { italic: true } } });
  const l = looks();
  assert.equal(l.B3.style.fill, '#FF0000');
  assert.equal(l.B2.style.fill, undefined);
  assert.equal(l.A2.style.bold, true);
  assert.equal(l.A5.style.bold, true);
  assert.equal(l.A3, undefined);
  assert.equal(l.B5.style.color, '#00AA00');
  assert.equal(l.B2.style.italic, true);
  assert.equal(l.B4, undefined, '7 está abaixo da média 7,5');
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'B3', value: 8 } });
  assert.equal(looks().B3?.style.fill, undefined, 'mudar o valor muda a aparência na hora');
});

test('formatação condicional: escala de cores, barras, ícones e fórmula', () => {
  const { e, sh, looks } = sheet([[0, 1], [50, 0], [100, 1]]);
  e.run({ type: 'ADD_CONDITIONAL_FORMAT', targetId: sh, payload: { range: 'A1:A3', rule: { type: 'COLOR_SCALE', min: { color: '#000000' }, max: { color: '#FFFFFF' } } } });
  e.run({ type: 'ADD_CONDITIONAL_FORMAT', targetId: sh, payload: { range: 'A1:A3', rule: { type: 'DATA_BAR', color: '#3366FF' } } });
  e.run({ type: 'ADD_CONDITIONAL_FORMAT', targetId: sh, payload: { range: 'A1:A3', rule: { type: 'ICON_SET', icons: 'ARROWS' } } });
  e.run({ type: 'ADD_CONDITIONAL_FORMAT', targetId: sh, payload: { range: 'B1:B3', rule: { type: 'FORMULA', formula: '=B1=1' }, style: { fill: '#FFFF00' } } });
  const l = looks();
  assert.deepEqual([l.A1.style.fill, l.A2.style.fill, l.A3.style.fill], ['#000000', '#808080', '#FFFFFF']);
  assert.deepEqual([l.A1.dataBar.ratio, l.A2.dataBar.ratio, l.A3.dataBar.ratio], [0, 0.5, 1]);
  assert.deepEqual([l.A1.icon, l.A2.icon, l.A3.icon], ['↓', '→', '↑']);
  assert.equal(l.B1.style.fill, '#FFFF00');
  assert.equal(l.B2, undefined, 'fórmula relativa desce linha a linha');
  assert.equal(l.B3.style.fill, '#FFFF00');
});

test('formatação condicional: prioridade, parar se verdadeiro, editar, remover e desfazer', () => {
  const { e, sh, looks } = sheet([[1], [5]]);
  const r1 = e.run({ type: 'ADD_CONDITIONAL_FORMAT', targetId: sh, payload: { range: 'A1:A2', rule: { type: 'CELL_VALUE', operator: 'GT', value: 0 }, style: { fill: '#0000FF' } } });
  e.run({ type: 'ADD_CONDITIONAL_FORMAT', targetId: sh, payload: { range: 'A1:A2', rule: { type: 'CELL_VALUE', operator: 'GT', value: 3 }, style: { fill: '#FF0000', bold: true }, stopIfTrue: true, priority: 0 } });
  assert.deepEqual(looks().A2.style, { fill: '#FF0000', bold: true }, 'a primeira regra vence e para');
  assert.deepEqual(looks().A1.style, { fill: '#0000FF' });
  e.run({ type: 'UPDATE_CONDITIONAL_FORMAT', targetId: sh, payload: { ruleId: r1, style: { fill: '#00FF00' } } });
  assert.equal(looks().A1.style.fill, '#00FF00');
  e.run({ type: 'REMOVE_CONDITIONAL_FORMAT', targetId: sh, payload: { ruleId: r1 } });
  assert.equal(looks().A1, undefined);
  e.run({ type: 'UNDO' });
  assert.equal(looks().A1.style.fill, '#00FF00');
  assert.equal(e.execute({ type: 'ADD_CONDITIONAL_FORMAT', targetId: sh, payload: { range: 'A1:A2', rule: { type: 'CELL_VALUE', operator: 'GT', value: 1 } } }).ok, false, 'sem estilo');
  assert.equal(e.execute({ type: 'ADD_CONDITIONAL_FORMAT', targetId: sh, payload: { range: 'A1:A2', rule: { type: 'MAGIC' }, style: { fill: '#000000' } } }).ok, false);
  assert.equal((e.run({ type: 'LIST_CONDITIONAL_FORMATS', targetId: sh }) as unknown[]).length, 2);
});

test('filtro combinado (E / OU) em tabela', () => {
  const e = createEngine(createDocument());
  const t = e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TABLE', data: { header: true, values: [['Produto', 'Preço', 'Estoque'], ['Notebook', 3500, 2], ['Monitor', 1200, 0], ['Mouse', 80, 30], ['Teclado', 150, 0]] } } }).id;
  e.run({ type: 'FILTER', targetId: t, payload: { conditions: [{ column: 2, rule: { type: 'GT', value: 100 } }, { column: 3, rule: { type: 'GT', value: 0 } }], join: 'AND' } });
  assert.deepEqual(e.run({ type: 'FILTERED_ROWS', targetId: t }), [1, 2]);
  e.run({ type: 'FILTER', targetId: t, payload: { conditions: [{ column: 2, rule: { type: 'GT', value: 1000 } }, { column: 3, rule: { type: 'GTE', value: 30 } }], join: 'OR' } });
  assert.deepEqual(e.run({ type: 'FILTERED_ROWS', targetId: t }), [1, 2, 3, 4]);
  assert.equal(e.execute({ type: 'FILTER', targetId: t, payload: { conditions: [{ column: 2, rule: { type: 'ABOUT' } }] } }).ok, false);
});

test('modelos: criar, listar, aplicar a identidade e criar documento novo', () => {
  const { e } = slide();
  e.services.templates = new MemoryTemplateLibrary();
  e.run({ type: 'UPDATE_THEME', payload: { colors: { accent: '#FBBF00' } } });
  const st = e.run({ type: 'CREATE_STYLE', payload: { name: 'Título /H', type: 'TEXT', properties: { fontSize: 48 } } });
  const tpl = e.run({ type: 'CREATE_TEMPLATE', payload: { name: 'Marca /H', keepContent: false } }) as string;
  assert.equal((e.run({ type: 'LIST_TEMPLATES', payload: { application: 'PRESENTATION_EDITOR' } }) as any[])[0].name, 'Marca /H');

  const other = createEngine(createDocument('PRESENTATION_EDITOR'));
  other.services.templates = e.services.templates;
  other.run({ type: 'APPLY_TEMPLATE', targetId: tpl });
  assert.equal(other.doc.themes[other.doc.document.themeId!].colors.accent, '#FBBF00');
  assert.ok(other.doc.styles[st as string]);
  other.run({ type: 'UNDO' });
  assert.equal(other.doc.styles[st as string], undefined, 'aplicar modelo pode ser desfeito');

  const fresh = documentFromTemplate(other.services.templates.get(tpl), 'Proposta');
  assert.equal(fresh.document.name, 'Proposta');
  assert.equal(Object.values(fresh.nodes).filter((n) => n.type === 'SHAPE').length, 0, 'modelo sem conteúdo');
  const ne = createEngine(fresh);
  assert.equal(ne.doc.themes[ne.doc.document.themeId!].colors.accent, '#FBBF00');
  e.run({ type: 'DELETE_TEMPLATE', targetId: tpl });
  assert.equal((e.run({ type: 'LIST_TEMPLATES' }) as any[]).length, 0);
});

test('layouts: salvar um slide e criar novos a partir dele', () => {
  const { e, s, shape } = slide();
  shape(10); shape(80);
  const lay = e.run({ type: 'SAVE_LAYOUT', targetId: s, payload: { name: 'Dois blocos' } }) as string;
  assert.equal(e.execute({ type: 'SAVE_LAYOUT', targetId: s, payload: { name: 'dois blocos' } }).ok, false, 'nome repetido');
  assert.deepEqual(e.run({ type: 'LIST_LAYOUTS' }), [{ id: lay, name: 'Dois blocos', surfaceType: 'SLIDE' }]);
  const novo = e.run({ type: 'APPLY_LAYOUT', payload: { name: 'Dois blocos' } }) as string;
  assert.notEqual(novo, s);
  assert.equal(e.get(novo).children.length, 2);
  assert.ok(e.get(novo).children.every((c: string) => !e.get(s).children.includes(c)), 'IDs novos');
  assert.equal(e.state.activeSurface, novo);
  e.run({ type: 'UNDO' });
  assert.equal(e.find(novo), undefined);
  e.run({ type: 'DELETE_LAYOUT', targetId: lay });
  assert.equal(e.execute({ type: 'APPLY_LAYOUT', payload: { layoutId: lay } }).ok, false);
});
