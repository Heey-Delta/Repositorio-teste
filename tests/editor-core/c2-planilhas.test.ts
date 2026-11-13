// C2 · grade, tabela estruturada, proteção de planilha, dinâmica, atingir meta, cenários, estatística e transformação.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument } from '../../src/editor-core/index.ts';

const DATA = [
  ['Vendedor', 'Região', 'Mês', 'Vendas'],
  ['Ana', 'Sul', 'Jan', 100], ['Ana', 'Sul', 'Fev', 150], ['Bruno', 'Norte', 'Jan', 200],
  ['Bruno', 'Norte', 'Fev', 120], ['Caio', 'Sul', 'Jan', 80], ['Ana', 'Sul', 'Jan', 100],
];
const sheet = () => {
  const e = createEngine(createDocument('SPREADSHEET_EDITOR'));
  const sh = e.state.activeSurface!;
  e.run({ type: 'SET_CELLS', targetId: sh, payload: { start: 'A1', values: DATA } });
  const get = (c: string) => (e.run({ type: 'GET_CELL', targetId: sh, payload: { cell: c } }) as any).display;
  const range = (r: string) => e.run({ type: 'GET_RANGE', targetId: sh, payload: { range: r } }) as any[][];
  return { e, sh, get, range };
};

test('grade: congelar, ocultar/mostrar, agrupar e recolher, autoajuste', () => {
  const { e, sh } = sheet();
  assert.deepEqual(e.run({ type: 'FREEZE_PANES', targetId: sh, payload: { rows: 1, columns: 1 } }), { rows: 1, columns: 1 });
  assert.deepEqual(e.run({ type: 'HIDE_ROWS', targetId: sh, payload: { rows: '3:4' } }), [3, 4]);
  assert.deepEqual(e.run({ type: 'SHOW_ROWS', targetId: sh, payload: { rows: '3' } }), [4]);
  assert.deepEqual(e.run({ type: 'HIDE_COLUMNS', targetId: sh, payload: { columns: 'B:C' } }), [2, 3]);
  const g = e.run({ type: 'GROUP_LINES', targetId: sh, payload: { axis: 'ROW', range: '2:5' } }) as string;
  e.run({ type: 'COLLAPSE_GROUP', targetId: sh, payload: { groupId: g } });
  assert.deepEqual(e.get(sh).data.hiddenRows, [2, 3, 4, 5]);
  e.run({ type: 'EXPAND_GROUP', targetId: sh, payload: { groupId: g } });
  assert.deepEqual(e.get(sh).data.hiddenRows, []);
  const w = e.run({ type: 'AUTOFIT_COLUMNS', targetId: sh, payload: { columns: 'A:B' } }) as Record<string, number>;
  assert.ok(w[1] > w[2] || w[1] >= 70);
});

test('subtotais por grupo com total geral e estrutura', () => {
  const { e, sh, range } = sheet();
  e.run({ type: 'TRANSFORM_DATA', targetId: sh, payload: { source: 'A1:D7', steps: [{ op: 'SORT', column: 'Vendedor' }], dest: 'A1' } });
  const r = e.run({ type: 'SUBTOTALS', targetId: sh, payload: { range: 'A1:D7', groupBy: 'Vendedor', fn: 'SUM', columns: ['Vendas'] } }) as any;
  assert.deepEqual(r, { rows: 11, groups: 3 });
  const rows = range('A1:D11');
  assert.deepEqual(rows[4], ['Total Ana', null, null, 350]);
  assert.deepEqual(rows[10], ['Total geral', null, null, 750]);
});

test('tabela estruturada: nomes por coluna, linha de totais; remover duplicatas', () => {
  const { e, sh, get } = sheet();
  assert.equal(e.run({ type: 'REMOVE_DUPLICATES', targetId: sh, payload: { range: 'A1:D7' } }), 1);
  assert.equal(get('A7'), null);
  e.run({ type: 'CREATE_SHEET_TABLE', targetId: sh, payload: { range: 'A1:D6', name: 'Vendas', totalRow: true, totals: { Vendas: 'SUM' } } });
  assert.equal(get('D7'), 650);
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'F1', value: '=SOMA(Vendas_Vendas)' } });
  assert.equal(get('F1'), 650);
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'F2', value: '=SOMASE(Vendas_Regiao;"Sul";Vendas_Vendas)' } });
  assert.equal(get('F2'), 330);
});

test('proteção de planilha: células bloqueadas, desbloqueadas e senha', () => {
  const { e, sh, get } = sheet();
  e.run({ type: 'LOCK_CELLS', targetId: sh, payload: { range: 'D2:D7', locked: false } });
  e.run({ type: 'PROTECT_SHEET', targetId: sh, payload: { password: '1234' } });
  assert.throws(() => e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'A2', value: 'X' } }), /protegida/);
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'D2', value: 999 } });
  assert.equal(get('D2'), 999);
  assert.throws(() => e.run({ type: 'UNPROTECT_SHEET', targetId: sh, payload: { password: 'x' } }), /Senha incorreta/);
  e.run({ type: 'UNPROTECT_SHEET', targetId: sh, payload: { password: '1234' } });
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'A2', value: 'X' } });
  assert.deepEqual(e.run({ type: 'SHEET_PROPERTIES', targetId: sh, payload: { tabColor: '#FBBF00', name: 'Vendas 2024' } }), { name: 'Vendas 2024', hidden: false, tabColor: '#FBBF00' });
  assert.throws(() => e.run({ type: 'SHEET_PROPERTIES', targetId: sh, payload: { hidden: true } }), /visível/);
});

test('tabela dinâmica com linhas, colunas e totais; atualizar', () => {
  const { e, sh, range } = sheet();
  const p = e.run({ type: 'PIVOT_TABLE', targetId: sh, payload: { source: 'A1:D7', rows: ['Vendedor'], columns: ['Mês'], values: [{ column: 'Vendas', fn: 'SUM' }], dest: 'G1' } }) as any;
  const t = range('G1:J5');
  assert.deepEqual(t[0], ['Vendedor', 'Fev · Soma de Vendas', 'Jan · Soma de Vendas', 'Total · Soma de Vendas']);
  assert.deepEqual(t[1], ['Ana', 150, 200, 350]);
  assert.deepEqual(t[4], ['Total geral', 270, 480, 750]);
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'D2', value: 1000 } });
  e.run({ type: 'REFRESH_PIVOT', targetId: sh, payload: { id: p.id } });
  assert.equal(range('J2:J2')[0][0], 1250);
});

test('atingir meta, cenários e tabela de dados', () => {
  const e = createEngine(createDocument('SPREADSHEET_EDITOR'));
  const sh = e.state.activeSurface!;
  e.run({ type: 'SET_CELLS', targetId: sh, payload: { start: 'A1', values: [['Preço', 10], ['Qtde', 50], ['Receita', '=B1*B2']] } });
  const r = e.run({ type: 'GOAL_SEEK', targetId: sh, payload: { setCell: 'B3', toValue: 750, byChanging: 'B1' } }) as any;
  assert.deepEqual([r.value, r.result], [15, 750]);
  e.run({ type: 'ADD_SCENARIO', targetId: sh, payload: { name: 'Otimista', cells: { B1: 20, B2: 100 } } });
  e.run({ type: 'ADD_SCENARIO', targetId: sh, payload: { name: 'Pessimista', cells: { B1: 8, B2: 30 } } });
  const sum = e.run({ type: 'SCENARIO_SUMMARY', targetId: sh, payload: { resultCells: ['B3'] } }) as any;
  assert.deepEqual([sum.Atual.B3, sum.Otimista.B3, sum.Pessimista.B3], [750, 2000, 240]);
  assert.equal((e.run({ type: 'GET_CELL', targetId: sh, payload: { cell: 'B3' } }) as any).display, 750);
  assert.deepEqual(e.run({ type: 'DATA_TABLE', targetId: sh, payload: { formulaCell: 'B3', inputCell: 'B1', values: [1, 2], inputCell2: 'B2', values2: [10, 20] } }), [[10, 20], [20, 40]]);
  assert.equal((e.run({ type: 'GET_CELL', targetId: sh, payload: { cell: 'B3' } }) as any).display, 750);
});

test('estatística descritiva, regressão, previsão e rastrear fórmulas', () => {
  const { e, sh } = sheet();
  const d = e.run({ type: 'DESCRIPTIVE_STATS', targetId: sh, payload: { range: 'D2:D7' } }) as any;
  assert.deepEqual([d.count, d.sum, d.mean, d.median, d.mode, d.min, d.max], [6, 750, 125, 110, 100, 80, 200]);
  e.run({ type: 'SET_CELLS', targetId: sh, payload: { start: 'F1', values: [[1, 3], [2, 5], [3, 7], [4, 9]] } });
  const r = e.run({ type: 'REGRESSION', targetId: sh, payload: { y: 'G1:G4', x: 'F1:F4', predict: [5] } }) as any;
  assert.deepEqual([r.slope, r.intercept, r.r2, r.predict[0]], [2, 1, 1, 11]);
  assert.deepEqual(e.run({ type: 'FORECAST_SERIES', targetId: sh, payload: { range: 'G1:G4', periods: 2 } }), [11, 13]);
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'H1', value: '=SOMA(D2:D4)+G1' } });
  assert.deepEqual(e.run({ type: 'TRACE_PRECEDENTS', targetId: sh, payload: { cell: 'H1' } }), ['D2:D4', 'G1']);
  assert.deepEqual(e.run({ type: 'TRACE_DEPENDENTS', targetId: sh, payload: { cell: 'D3' } }), ['H1']);
});

test('transformar dados (Power Query) e preenchimento relâmpago', () => {
  const { e, sh } = sheet();
  const t = e.run({ type: 'TRANSFORM_DATA', targetId: sh, payload: { source: 'A1:D7', steps: [
    { op: 'REMOVE_DUPLICATES' }, { op: 'FILTER_ROWS', column: 'Vendas', operator: '>=', value: 100 },
    { op: 'GROUP_BY', columns: ['Região'], aggregations: [{ column: 'Vendas', fn: 'SUM', name: 'Total' }, { column: 'Vendedor', fn: 'DISTINCT', name: 'Pessoas' }] },
    { op: 'SORT', column: 'Total', order: 'DESC' },
  ], dest: 'G1', save: 'Resumo' } }) as any[][];
  assert.deepEqual(t, [['Região', 'Total', 'Pessoas'], ['Norte', 320, 1], ['Sul', 250, 1]]);
  const u = e.run({ type: 'TRANSFORM_DATA', targetId: sh, payload: { rows: [['Item', 'Jan', 'Fev'], ['A', 1, 2]], steps: [{ op: 'UNPIVOT', keep: ['Item'], attribute: 'Mês', value: 'Qtde' }] } });
  assert.deepEqual(u, [['Item', 'Mês', 'Qtde'], ['A', 'Jan', 1], ['A', 'Fev', 2]]);
  const sp = e.run({ type: 'TRANSFORM_DATA', targetId: sh, payload: { rows: [['Nome'], ['Ana Lima'], ['Bruno Sá']], steps: [{ op: 'SPLIT_COLUMN', column: 'Nome', delimiter: ' ' }, { op: 'ADD_COLUMN', name: 'Email', template: '{Nome.1}@ex.com' }] } }) as any[][];
  assert.deepEqual(sp[1], ['Ana', 'Lima', 'Ana@ex.com']);
  e.run({ type: 'SET_CELLS', targetId: sh, payload: { start: 'L1', values: [['Ana Maria Lima', 'AML'], ['Bruno Sá', null], ['Caio Dias Prado', null]] } });
  assert.deepEqual(e.run({ type: 'FLASH_FILL', targetId: sh, payload: { source: 'L1:L3', target: 'M1:M3' } }), { rule: 'iniciais', filled: 2 });
  assert.equal((e.run({ type: 'GET_CELL', targetId: sh, payload: { cell: 'M3' } }) as any).display, 'CDP');
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'D3', value: 500 } });
  const again = e.run({ type: 'REFRESH_QUERY', targetId: sh, payload: { name: 'Resumo' } }) as any[][];
  assert.deepEqual(again[1], ['Sul', 600, 1]);
});
