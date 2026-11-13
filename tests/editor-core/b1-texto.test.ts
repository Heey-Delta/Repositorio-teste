// B1 · processador de texto: numeração com letras/romanos, reiniciar/continuar, classificar, estilos prontos e novas propriedades.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, roman, alpha, formatNumber } from '../../src/editor-core/index.ts';

const setup = () => {
  const e = createEngine(createDocument());
  const blk = e.state.activeSurface!;
  const p = (text: string) => e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data: { text } } }).id as string;
  const list = (items: any[], listType = 'NUMBERED') => e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'LIST', parentId: blk, listType, items } }) as string;
  return { e, blk, p, list };
};
const labels = (e: any, id: string) => Object.values(e.run({ type: 'LIST_LABELS', targetId: id }));

test('números: romanos, letras e ordinais', () => {
  assert.deepEqual([roman(4), roman(1994), alpha(1), alpha(27), formatNumber(3, 'UPPER_ROMAN'), formatNumber(2, 'ORDINAL'), formatNumber(7, 'DECIMAL_ZERO')], ['IV', 'MCMXCIV', 'a', 'aa', 'III', '2º', '07']);
});

test('lista: formato por nível, separador, multinível e marcadores', () => {
  const { e, list } = setup();
  const l = list([{ text: 'a', level: 0 }, { text: 'b', level: 1 }, { text: 'c', level: 1 }, { text: 'd', level: 0 }]);
  assert.deepEqual(labels(e, l), ['1.', 'a.', 'b.', '2.']);
  e.run({ type: 'LIST_SET_FORMAT', targetId: l, payload: { levelFormats: ['UPPER_ROMAN', 'UPPER_ALPHA'], separator: ')' } });
  assert.deepEqual(labels(e, l), ['I)', 'A)', 'B)', 'II)']);
  e.run({ type: 'LIST_SET_FORMAT', targetId: l, payload: { listType: 'MULTILEVEL', levelFormats: null as any, separator: '.' } });
  e.run({ type: 'LIST_SET_FORMAT', targetId: l, payload: { levelFormats: ['DECIMAL', 'DECIMAL'] } });
  assert.deepEqual(labels(e, l), ['1.', '1.1.', '1.2.', '2.']);
  const b = list(['x', 'y'], 'BULLET');
  assert.deepEqual(labels(e, b), ['•', '•']);
  assert.throws(() => e.run({ type: 'LIST_SET_FORMAT', targetId: l, payload: { numberFormat: 'HEBRAICO' } }), /Formato de número/);
});

test('reiniciar no meio divide a lista; continuar soma a anterior; desfazer volta', () => {
  const { e, blk, list } = setup();
  const l = list(['um', 'dois', 'três', 'quatro']);
  const third = e.get(l).children[2];
  const nl = e.run({ type: 'LIST_RESTART', targetId: third }) as string;
  assert.deepEqual([labels(e, l), labels(e, nl)], [['1.', '2.'], ['1.', '2.']]);
  assert.equal(e.get(blk).children.indexOf(nl), e.get(blk).children.indexOf(l) + 1);
  e.run({ type: 'LIST_CONTINUE', targetId: nl });
  assert.deepEqual(labels(e, nl), ['3.', '4.']);
  e.run({ type: 'LIST_RESTART', targetId: nl, payload: { start: 10 } });
  assert.deepEqual(labels(e, nl), ['10.', '11.']);
  e.run({ type: 'UNDO' }); e.run({ type: 'UNDO' }); e.run({ type: 'UNDO' });
  assert.deepEqual([e.get(l).children.length, e.find(nl)], [4, undefined]);
});

test('classificar parágrafos por texto, número e data', () => {
  const { e, blk, p } = setup();
  const ids = ['banana', 'Abacate', 'cereja'].map(p);
  e.run({ type: 'SORT_PARAGRAPHS', payload: { ids } });
  const txt = (id: string) => e.get(id).data.runs.map((r: any) => r.text).join('');
  const order = () => e.get(blk).children.filter((id: string) => ids.includes(id)).map(txt);
  assert.deepEqual(order(), ['Abacate', 'banana', 'cereja']);
  e.run({ type: 'SORT_PARAGRAPHS', payload: { ids, order: 'DESC' } });
  assert.deepEqual(order(), ['cereja', 'banana', 'Abacate']);
  const n = ['item 10', 'item 9', 'item 100'].map(p);
  e.run({ type: 'SORT_PARAGRAPHS', payload: { ids: n, by: 'NUMBER' } });
  assert.deepEqual(e.get(blk).children.filter((id: string) => n.includes(id)).map(txt), ['item 9', 'item 10', 'item 100']);
  const d = ['02/03/2024', '15/01/2024', '01/12/2023'].map(p);
  e.run({ type: 'SORT_PARAGRAPHS', payload: { ids: d, by: 'DATE' } });
  assert.deepEqual(e.get(blk).children.filter((id: string) => d.includes(id)).map(txt), ['01/12/2023', '15/01/2024', '02/03/2024']);
});

test('estilos prontos, inspetor e selecionar semelhantes', () => {
  const { e, p } = setup();
  const st = e.run({ type: 'INSTALL_BUILTIN_STYLES' }) as Record<string, string>;
  assert.ok(st['Título 1'] && st['Citação'] && st['Normal']);
  assert.deepEqual(e.run({ type: 'INSTALL_BUILTIN_STYLES' }), st);   // não duplica
  const a = p('a'), b = p('b'), c = p('c');
  for (const id of [a, c]) e.run({ type: 'APPLY_STYLE', targetId: id, payload: { styleId: st['Título 1'] } });
  e.run({ type: 'FORMAT', targetId: a, payload: { color: '#FF0000' } });
  e.run({ type: 'FORMAT', targetId: c, payload: { color: '#FF0000' } });
  assert.deepEqual((e.run({ type: 'SELECT_SIMILAR', targetId: a }) as string[]).sort(), [a, c].sort());
  assert.ok(!e.state.selection.selectedIds.includes(b));
  const insp = e.run({ type: 'STYLE_INSPECTOR', targetId: a }) as any;
  assert.deepEqual([insp.color.from, insp.fontSize.from], ['DIRECT', 'STYLE:Título 1']);
  const uses = (e.run({ type: 'LIST_STYLES' }) as any[]).find((s) => s.name === 'Título 1').uses;
  assert.equal(uses, 2);
});

test('novas propriedades de caractere e parágrafo são validadas', () => {
  const { e, p } = setup();
  const a = p('texto');
  e.run({ type: 'FORMAT', targetId: a, payload: { underlineStyle: 'WAVY', underlineColor: '#00AA00', smallCaps: true, scale: 150, keepWithNext: true, widowControl: true, tabStops: [{ position: 72, align: 'RIGHT', leader: 'DOTS' }], dropCap: { mode: 'DROPPED', lines: 3 }, outlineLevel: 2, language: 'pt-BR' } });
  assert.equal(e.get(a).styleOverrides.underlineStyle, 'WAVY');
  for (const bad of [{ underlineStyle: 'ZIGZAG' }, { scale: 900 }, { tabStops: [{ position: -1 }] }, { dropCap: { mode: 'X', lines: 3 } }, { outlineLevel: 12 }, { smallCaps: 'sim' }, { language: 'português' }])
    assert.throws(() => e.run({ type: 'FORMAT', targetId: a, payload: bad }), /VALIDATION|vai de|Tabula|Capitular|Nível|sim\/não|Idioma|Sublinhado|Posição/);
  assert.ok((e.run({ type: 'SPECIAL_CHARACTERS' }) as any[]).some((c) => c.name === 'Espaço inseparável' && c.code === 'U+00A0'));
});
