// C1 · funções de planilha que faltavam e formatos numéricos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument } from '../../src/editor-core/index.ts';
import { createRegistry } from '../../src/editor-core/formula/functions.ts';
import { formatValue } from '../../src/editor-core/formula/number-format.ts';

const sheet = () => {
  const e = createEngine(createDocument('SPREADSHEET_EDITOR'));
  const sh = e.state.activeSurface!;
  e.run({ type: 'SET_CELLS', targetId: sh, payload: { start: 'A1', values: [
    ['Nome', 'Região', 'Vendas', 'Data'],
    ['Ana', 'Sul', 100, 45000],
    ['Bruno', 'Norte', 250, 45031],
    ['Caio', 'Sul', 300, 45061],
    ['Duda', 'Norte', 50, 45092],
    ['Eva', 'Sul', 300, 45122],
  ] } });
  let k = 0;
  const f = (formula: string) => { const c = `H${++k}`; e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: c, value: `=${formula}` } }); const r = e.run({ type: 'GET_CELL', targetId: sh, payload: { cell: c } }) as any; return r.error?.code ?? r.display; };
  return { e, sh, f };
};
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('registro: mais de 240 funções, nomes em português e inglês', () => {
  const r = createRegistry();
  assert.ok(r.list().length >= 240);
  for (const n of ['PROCX', 'XLOOKUP', 'SOMASES', 'SUMIFS', 'FILTRO', 'TIR', 'IRR', 'DATADIF', 'UNIRTEXTO', 'CONVERTER', 'DIST.NORM.N']) assert.ok(r.get(n), n);
});

test('matemáticas e trigonometria', () => {
  const { f } = sheet();
  assert.deepEqual([f('SOMARPRODUTO({1;2;3};{4;5;6})'), f('TRUNCAR(8,97)'), f('TETO(4,3;0,5)'), f('ARREDMULTB(4,7;2)'), f('MARRED(10;3)'), f('PAR(3)'), f('ÍMPAR(2)'), f('FATORIAL(5)'), f('COMBIN(5;2)'), f('MDC(24;36)'), f('MMC(4;6)'), f('ROMANO(1994)'), f('ARÁBICO("XIV")'), f('QUOCIENTE(7;2)')],
    [32, 8, 4.5, 4, 9, 4, 3, 120, 10, 12, 12, 'MCMXCIV', 14, 3]);
  close(f('SEN(PI()/2)'), 1); close(f('LOG(8;2)'), 3); close(f('GRAUS(PI())'), 180);
  assert.equal(f('SOMASES(C2:C6;B2:B6;"Sul";C2:C6;">150")'), 600);
  assert.equal(f('SUBTOTAL(9;C2:C6)'), 1000);
  assert.equal(f('MATRIZ.DETERM({1\\2;3\\4})'), -2);
});

test('estatísticas', () => {
  const { f } = sheet();
  assert.deepEqual([f('MÉDIASE(B2:B6;"Sul";C2:C6)'), f('CONT.SES(B2:B6;"Sul";C2:C6;">=300")'), f('MÁXIMOSES(C2:C6;B2:B6;"Norte")'), f('MÍNIMOSES(C2:C6;B2:B6;"Sul")'), f('MODO(C2:C6)'), f('MAIOR(C2:C6;2)'), f('MENOR(C2:C6;1)'), f('ORDEM(250;C2:C6)')],
    [233.33333333333334, 2, 250, 100, 300, 300, 50, 3]);
  close(f('PERCENTIL(C2:C6;0,5)'), 250); close(f('QUARTIL(C2:C6;1)'), 100);
  close(f('DESVPADP(C2:C6)'), 104.88088481701516); close(f('VAR(C2:C6)'), 13750);
  close(f('INCLINAÇÃO({2;4;6};{1;2;3})'), 2); close(f('INTERCEPÇÃO({2;4;6};{1;2;3})'), 0); close(f('PREVISÃO(4;{2;4;6};{1;2;3})'), 8);
  close(f('CORREL({1;2;3};{2;4;7})'), 0.9933992677987828);
  close(f('DIST.NORMP.N(1,96;VERDADEIRO)'), 0.9750021, 1e-6); close(f('INV.NORMP.N(0,975)'), 1.959964, 1e-5);
  close(f('MÉDIA.GEOMÉTRICA({2;8})'), 4);
});

test('lógicas, informação e texto', () => {
  const { f } = sheet();
  assert.deepEqual([f('SES(C2>200;"alto";C2>50;"médio";VERDADEIRO;"baixo")'), f('PARÂMETRO(B3;"Sul";1;"Norte";2;0)'), f('ESCOLHER(2;"a";"b";"c")'), f('SES(1=1;"ok";1/0;"x")'), f('XOU(VERDADEIRO;FALSO)'), f('ÉTEXTO(A2)'), f('ÉPAR(4)'), f('É.NÃO.DISP(NÃO.DISP())')],
    ['médio', 2, 'b', 'ok', true, true, true, true]);
  assert.deepEqual([f('PROCURAR("a";"banana")'), f('LOCALIZAR("N*";"banana")'), f('MUDAR("abcdef";2;3;"X")'), f('REPT("ab";3)'), f('UNIRTEXTO(", ";VERDADEIRO;A2:A4)'), f('TEXTOANTES("a@b.com";"@")'), f('TEXTODEPOIS("a@b.com";"@")'), f('EXATO("A";"a")'), f('FIXO(1234,567;1)'), f('TEXTO(0,256;"0,0%")'), f('TEXTO(45000;"dd/mm/aaaa")'), f('VALORNUMÉRICO("1.234,5")')],
    [2, 3, 'aXef', 'ababab', 'Ana, Bruno, Caio', 'a', 'b.com', false, '1.234,6', '25,6%', '15/03/2023', 1234.5]);
});

test('datas e horas', () => {
  const { f } = sheet();
  assert.deepEqual([f('DATAM(D2;1)'), f('FIMMÊS(D2;0)'), f('DATADIF(D2;D6;"M")'), f('DATADIF(D2;D6;"D")'), f('DIATRABALHOTOTAL(D2;D2+13)'), f('NÚMSEMANAISO(D2)'), f('HORA(0,75)'), f('MINUTO(TEMPO(10;35;0))'), f('DATA.VALOR("15/03/2023")'), f('DIAS360(DATA(2023;1;31);DATA(2023;3;31))')],
    [45031, 45016, 4, 122, 10, 11, 18, 35, 45000, 60]);
});

test('financeiras', () => {
  const { f } = sheet();
  close(f('VPL(10%;-10000;3000;4200;6800)'), 1188.4434123352207);
  close(f('TIR({-70000;12000;15000;18000;21000;26000})'), 0.08663094803653171, 1e-9);
  close(f('IPGTO(10%/12;1;36;8000)'), -66.66666666666667);
  close(f('PPGTO(10%/12;1;24;2000)'), -75.62318600836664, 1e-6);
  close(f('EFETIVA(5,25%;4)'), 0.053542667370758974);
  close(f('DPD(30000;7500;10)'), 2250);
  close(f('BDD(2400;300;10;1)'), 480);
  close(f('XTIR({-10000;2750;4250;3250;2750};{39448;39508;39751;39859;39904})'), 0.3733625335188315, 1e-6);
});

test('pesquisa e matrizes dinâmicas', () => {
  const { f, e, sh } = sheet();
  assert.deepEqual([f('PROCX("Caio";A2:A6;C2:C6)'), f('PROCX("Zé";A2:A6;C2:C6;"não achei")'), f('PROCX("C*";A2:A6;A2:A6;;2)'), f('CORRESPX(250;C2:C6)'), f('PROCX(275;C2:C6;A2:A6;;-1)'), f('LINS(A1:D6)'), f('COLS(A1:D6)')],
    [300, 'não achei', 'Caio', 2, 'Bruno', 6, 4]);
  // resultados em matriz: o primeiro valor aparece na célula; a matriz inteira vem no valor calculado
  const m = (formula: string) => { e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'J1', value: `=${formula}` } }); return (e.run({ type: 'GET_CELL', targetId: sh, payload: { cell: 'J1' } }) as any); };
  assert.equal(m('ÚNICO(B2:B6)').display, 'Sul');
  assert.equal(m('CLASSIFICAR(C2:C6;1;-1)').display, 300);
  assert.equal(m('FILTRO(A2:A6;C2:C6>200)').display, 'Bruno');
  assert.equal(m('SEQUÊNCIA(3;1;10;5)').display, 10);
});

test('engenharia e conversões', () => {
  const { f } = sheet();
  assert.deepEqual([f('DECABIN(10)'), f('BINADEC("1010")'), f('DECAHEX(255)'), f('HEXADEC("FF")'), f('DECABIN(-1)'), f('BITAND(12;10)'), f('DELTA(5;5)')], ['1010', 10, 'FF', 255, '1111111111', 8, 1]);
  close(f('CONVERTER(100;"km/h";"m/s")'), 27.77777777777778); close(f('CONVERTER(32;"F";"C")'), 0); close(f('CONVERTER(1;"mi";"km")'), 1.609344);
  assert.equal(f('CONVERTER(1;"kg";"m")'), '#N/A');
});

test('formatos numéricos', () => {
  const cases: [unknown, string, string][] = [
    [1234.5, '#.##0,00', '1.234,50'], [1234.5, '#,##0.00', '1.234,50'], [0.256, '0%', '26%'], [-1234.5, 'CURRENCY', '-R$ 1.234,50'], [12345, '0,00E+00', '1,23E+04'],
    [1.75, '# ?/?', '1 3/4'], [45000, 'DATE_LONG', 'quarta-feira, 15 de março de 2023'], [1.5, '[h]:mm:ss', '36:00:00'], [12345678901, 'CPF', '123.456.789-01'], [11987654321, 'PHONE', '(11) 98765-4321'],
    [0, '0;-0;"zero"', 'zero'], [1234567, '#,##0,', '1.235'], [7, '000', '007'], [45000, 'mmm/aa', 'mar/23'],
  ];
  for (const [v, c, want] of cases) assert.equal(formatValue(v, c).text, want, `${v} ${c}`);
  assert.equal(formatValue(-5, 'CURRENCY').color, '#C00000');
});
