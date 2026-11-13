// Fórmulas, planilhas, tabelas e gráficos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, registerFunction } from '../../src/editor-core/index.ts';
import { parse, stringify } from '../../src/editor-core/formula/parse.ts';
import { evaluate } from '../../src/editor-core/formula/evaluate.ts';
import { createRegistry } from '../../src/editor-core/formula/functions.ts';

const cells: Record<string, unknown> = { '1,1': 10, '2,1': 20, '3,1': 'abc', '1,2': 'Ana', '2,2': 'Bia' };
const ctx = {
  getCell: (_s: unknown, r: number, c: number) => (cells[`${r},${c}`] ?? null) as any,
  getRange: (_s: unknown, r1: number, c1: number, r2: number, c2: number) => Array.from({ length: r2 - r1 + 1 }, (_, i) => Array.from({ length: c2 - c1 + 1 }, (_, j) => (cells[`${r1 + i},${c1 + j}`] ?? null) as any)),
  getName: () => null,
  functions: createRegistry(),
  now: () => new Date(2026, 10, 13),
};
const calc = (f: string) => evaluate(parse(f), ctx);

test('fórmulas: precedência, operadores e funções em português e inglês', () => {
  assert.equal(calc('=A1+A2*2'), 50);
  assert.equal(calc('=-2^2'), 4);
  assert.equal(calc('=1-(2-3)'), 2);
  assert.equal(calc('=50%*A2'), 10);
  assert.equal(calc('=SOMA(A1:A3)'), 30, 'texto em intervalo é ignorado');
  assert.equal(calc('=SUM(A1:A2)'), 30);
  assert.equal(calc('=MEDIA(A1:A2)'), 15, 'acento opcional no nome da função');
  assert.equal(calc('=SE(A1>5;"alto";"baixo")'), 'alto');
  assert.equal(calc('=SEERRO(A1/0;"x")'), 'x');
  assert.equal(calc('=SE(VERDADEIRO;1;1/0)'), 1, 'SE não calcula o ramo que não usa');
  assert.equal(calc('=CONCATENAR(B1;" e ";B2)'), 'Ana e Bia');
  assert.equal(calc('=SOMASE(A1:A2;">15")'), 20);
  assert.equal(calc('=CONT.SE(B1:B2;"a*")'), 1);
  assert.equal(calc('=ARRED(2.345;2)'), 2.35);
  assert.equal(calc('=CORRESP(20;A1:A2;0)'), 2);
  assert.equal(calc('=PROCV(20;A1:B2;2;FALSO)'), 'Bia');
  assert.equal(calc('="R$ "&TEXTO(1234.5;"#.##0,00")'), 'R$ 1.234,50');
  assert.equal(calc('=DATA(2026;11;13)-HOJE()'), 0);
  assert.ok(Math.abs((calc('=PGTO(0.01;12;-1000)') as number) - 88.8488) < 1e-3);
  assert.ok(Math.abs((calc('=TAXA(12;-88.85;1000)') as number) - 0.01) < 1e-4);
});

test('fórmulas: erros padronizados e erros de escrita', () => {
  assert.deepEqual(calc('=A1/0'), { error: '#DIV/0!' });
  assert.deepEqual(calc('=A3+1'), { error: '#VALUE!' });
  assert.deepEqual(calc('=XYZ(1)'), { error: '#NAME?' });
  assert.deepEqual(calc('=RAIZ(-1)'), { error: '#NUM!' });
  assert.deepEqual(calc('=PROCV(99;A1:B2;2;FALSO)'), { error: '#N/A' });
  for (const bad of ['=SOMA(1;', '=A1+', '="abc', '=1 2', '=A1:']) assert.throws(() => parse(bad));
});

test('fórmulas: ida e volta texto → AST → texto', () => {
  for (const f of ['A1+A2*2', "Planilha2!A1+'Minha planilha'!$B$2", 'SOMA(A1:B3;2)', '-(A1+1)^2', '"a""b"&C3', '1-(2-3)']) {
    assert.equal(stringify(parse(f)), f);
  }
});

function sheet() {
  const e = createEngine(createDocument('SPREADSHEET_EDITOR'));
  const sh = e.state.activeSurface!;
  e.run({ type: 'SET_CELLS', targetId: sh, payload: { start: 'A1', values: [['Mês', 'Vendas'], ['Janeiro', 120], ['Fevereiro', 180], ['Março', 150]] } });
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'B5', value: '=SOMA(B2:B4)' } });
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'B6', value: '=B5*2' } });
  const get = (c: string, id = sh) => e.run({ type: 'GET_CELL', targetId: id, payload: { cell: c } });
  return { e, sh, get };
}

test('planilha: recálculo só do que depende, em cadeia', () => {
  const { e, sh, get } = sheet();
  assert.deepEqual([get('B5').display, get('B6').display], [450, 900]);
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'B4', value: '250' } });
  assert.deepEqual([get('B5').display, get('B6').display], [550, 1100]);
  assert.equal(get('B4').value, 250, 'texto numérico vira número');
});

test('planilha: ciclo vira #CYCLE!, fórmula inválida é recusada, desfazer volta o resultado', () => {
  const { e, sh, get } = sheet();
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'C1', value: '=D1+1' } });
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'D1', value: '=C1+1' } });
  assert.equal(get('C1').error.code, '#CYCLE!');
  assert.equal(get('D1').error.code, '#CYCLE!');
  assert.equal(e.execute({ type: 'SET_CELL', targetId: sh, payload: { cell: 'D2', value: '=SOMA(1;' } }).error!.code, 'VALIDATION');
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'B2', value: 0 } });
  assert.equal(get('B5').display, 330);
  e.run({ type: 'UNDO' });
  assert.equal(get('B5').display, 450);
});

test('planilha: inserir/excluir linhas corrige fórmulas, gráficos e intervalos', () => {
  const { e, sh, get } = sheet();
  const slide = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SLIDE' } });
  const ch = e.run({ type: 'CREATE_CHART', payload: { parentId: slide, chartType: 'COLUMN', source: { type: 'RANGE', targetId: sh, range: 'A1:B4' } } });
  e.run({ type: 'INSERT_ROW', targetId: sh, payload: { index: 3 } });
  assert.equal(get('B6').formula, '=SOMA(B2:B5)');
  assert.equal(get('B7').formula, '=B6*2');
  assert.equal(get('B7').display, 900);
  assert.equal(e.get(ch.id).data.source.range, 'A1:B5');
  e.run({ type: 'DELETE_ROW', targetId: sh, payload: { index: 2 } });
  assert.equal(get('B5').formula, '=SOMA(B2:B4)');
  assert.equal(get('B5').display, 330);
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'D1', value: '=A2' } });
  e.run({ type: 'DELETE_ROW', targetId: sh, payload: { index: 2 } });
  assert.equal(get('D1').formula, '=#REF!', 'referência para linha excluída');
});

test('planilha: outra planilha, nomes definidos, copiar e preencher fórmula', () => {
  const { e, sh, get } = sheet();
  const s2 = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SHEET', name: 'Resumo' } });
  e.run({ type: 'SET_CELL', targetId: s2, payload: { cell: 'A1', value: '=Planilha1!B5+1' } });
  e.run({ type: 'DEFINE_NAME', payload: { name: 'vendas', range: 'Planilha1!B2:B4' } });
  e.run({ type: 'SET_CELL', targetId: s2, payload: { cell: 'A2', value: '=MÁXIMO(VENDAS)' } });
  assert.deepEqual([get('A1', s2).display, get('A2', s2).display], [451, 180]);
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'B3', value: 500 } });
  assert.deepEqual([get('A1', s2).display, get('A2', s2).display], [771, 500], 'mudança se propaga entre planilhas');
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'C2', value: '=B2*$B$5' } });
  e.run({ type: 'FILL', targetId: sh, payload: { range: 'C2:C4', direction: 'DOWN' } });
  assert.equal(get('C4').formula, '=B4*$B$5');
  e.run({ type: 'COPY_FORMULA', targetId: sh, payload: { from: 'C2', to: 'D2' } });
  assert.equal(get('D2').formula, '=C2*$B$5');
});

test('planilha: ordenar (vazios no fim), filtrar, validar, mesclar', () => {
  const { e, sh, get } = sheet();
  e.run({ type: 'SORT', targetId: sh, payload: { range: 'A1:B4', column: 'B', direction: 'DESC', header: true } });
  assert.deepEqual(e.run({ type: 'GET_RANGE', targetId: sh, payload: { range: 'A2:A4' } }).flat(), ['Fevereiro', 'Março', 'Janeiro']);
  assert.equal(get('B5').display, 450, 'soma não muda com a ordem');
  assert.deepEqual(e.run({ type: 'FILTER', targetId: sh, payload: { column: 'B', range: 'A1:B4', rule: { type: 'GT', value: 140 } } }), [1, 2, 3, 5, 6]);
  e.run({ type: 'SET_VALIDATION', targetId: sh, payload: { range: 'E1:E5', rule: { type: 'LIST', values: ['Sim', 'Não'] } } });
  assert.equal(e.execute({ type: 'SET_CELL', targetId: sh, payload: { cell: 'E1', value: 'Talvez' } }).error!.code, 'VALIDATION');
  assert.equal(e.execute({ type: 'SET_CELL', targetId: sh, payload: { cell: 'E1', value: 'Sim' } }).ok, true);
  e.run({ type: 'MERGE_CELLS', targetId: sh, payload: { range: 'F1:G1' } });
  assert.equal(e.execute({ type: 'SET_CELL', targetId: sh, payload: { cell: 'G1', value: 1 } }).ok, false);
});

test('tabela de documento: fórmulas, linhas, mesclar, ordenar, filtrar, converter', () => {
  const e = createEngine(createDocument());
  const t = e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TABLE', data: { values: [['Produto', 'Preço'], ['Notebook', 3500], ['Monitor', 1200], ['Total', '=SOMA(B2:B3)']] } } }).id;
  const cell = (c: string) => e.run({ type: 'GET_CELL', targetId: t, payload: { cell: c } });
  assert.equal(cell('B4').display, 4700);
  e.run({ type: 'SET_CELL', targetId: t, payload: { cell: 'B3', value: 1300 } });
  assert.equal(cell('B4').display, 4800);
  e.run({ type: 'INSERT_COLUMN', targetId: t, payload: { index: 2 } });
  assert.equal(e.get(t).data.columns.length, 3);
  e.run({ type: 'DELETE_COLUMN', targetId: t, payload: { index: 2 } });
  e.run({ type: 'MERGE_CELLS', targetId: t, payload: { range: 'A1:B1' } });
  assert.deepEqual(e.get(t).data.rows[0].cells[0].span, { rows: 1, columns: 2 });
  assert.equal(e.execute({ type: 'SORT', targetId: t, payload: { column: 2 } }).ok, false, 'mesclada impede ordenar');
  e.run({ type: 'SPLIT_CELLS', targetId: t, payload: { cell: 'A1' } });
  assert.deepEqual(e.run({ type: 'FILTER', targetId: t, payload: { column: 2, rule: { type: 'GT', value: 2000 } } }), [1, 2, 4]);
  assert.equal(e.execute({ type: 'DELETE_ROW', targetId: t, payload: { index: 1, count: 4 } }).ok, false, 'tabela precisa de uma linha');
  const lines = e.run({ type: 'TABLE_TO_TEXT', targetId: t });
  assert.equal(e.get(lines[3]).data.runs[0].text, 'Total\t4800');
  const back = e.run({ type: 'TEXT_TO_TABLE', targetIds: lines });
  assert.equal(e.get(back).data.rows.length, 4);
});

test('gráfico lê da planilha (sem copiar), atualiza sozinho e valida opções por tipo', () => {
  const { e, sh } = sheet();
  const slide = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SLIDE' } });
  const ch = e.run({ type: 'CREATE_CHART', payload: { parentId: slide, chartType: 'COLUMN', source: { type: 'RANGE', targetId: sh, range: 'A1:B4' } } });
  const data = e.run({ type: 'CHART_DATA', targetId: ch.id });
  assert.deepEqual(data.categories, ['Janeiro', 'Fevereiro', 'Março']);
  assert.deepEqual(data.series[0].values, [120, 180, 150]);
  assert.equal(ch.data.series.length, 0, 'o gráfico guarda a fonte, não os valores');
  const events: any[] = [];
  e.on('chart', (x) => events.push(x));
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'B4', value: 250 } });
  assert.deepEqual(events.at(-1).data.series[0].values, [120, 180, 250]);
  assert.match(e.execute({ type: 'SET_CHART_OPTION', targetId: ch.id, payload: { option: 'smooth', value: true } }).error!.message, /não tem a opção/);
  e.run({ type: 'SET_CHART_TYPE', targetId: ch.id, payload: { chartType: 'PIE' } });
  assert.equal(e.execute({ type: 'SET_CHART_OPTION', targetId: ch.id, payload: { option: 'axes', value: { x: {} } } }).ok, false, 'pizza não tem eixos');
  e.run({ type: 'UPDATE_SERIES', targetId: ch.id, payload: { index: 0, name: 'Receita', color: '#FBBF00' } });
  assert.equal(e.run({ type: 'CHART_DATA', targetId: ch.id }).series[0].name, 'Receita');
  e.run({ type: 'DELETE', targetId: sh });
  assert.match(e.run({ type: 'CHART_DATA', targetId: ch.id }).error, /excluída/);
});

test('gráfico com dados digitados e função personalizada', () => {
  const e = createEngine(createDocument('PRESENTATION_EDITOR'));
  const ch = e.run({ type: 'CREATE_CHART', payload: { chartType: 'LINE', source: { type: 'MANUAL', categories: ['T1', 'T2'], series: [{ name: 'A', values: [1, 2] }] } } });
  e.run({ type: 'ADD_SERIES', targetId: ch.id, payload: { name: 'B', values: [3, 4] } });
  assert.equal(e.run({ type: 'CHART_DATA', targetId: ch.id }).series.length, 2);
  const s = createEngine(createDocument('SPREADSHEET_EDITOR'));
  registerFunction(s, { name: 'DOBRO', category: 'CUSTOM', min: 1, max: 1, fn: (a) => (a[0] as number) * 2 });
  s.run({ type: 'SET_CELL', targetId: s.state.activeSurface, payload: { cell: 'A1', value: '=DOBRO(21)' } });
  assert.equal(s.run({ type: 'GET_CELL', targetId: s.state.activeSurface, payload: { cell: 'A1' } }).display, 42);
});
