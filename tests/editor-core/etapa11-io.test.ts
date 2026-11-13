// Etapa 11: importação e exportação (ida e volta por todos os formatos), impressão e conversão em lote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, exportDocument, importFile, openFile, convertFiles, readDocument } from '../../src/editor-core/index.ts';
import { crc32, readZip, writeZip, fromUtf8 } from '../../src/editor-core/io/zip.ts';
import { parseCsv, toCsv, fromMarkdown, parseMdInline } from '../../src/editor-core/io/text-formats.ts';
import { toExcelFormula } from '../../src/editor-core/io/office.ts';

const make = (app: any) => createEngine(createDocument(app));
function sampleDoc() {
  const e = createEngine(createDocument('DOCUMENT_EDITOR', 'Relatório de Ação'));
  const blk = e.state.activeSurface!;
  const ins = (contentType: string, data: any) => e.run({ type: 'INSERT_CONTENT', payload: { contentType, parentId: blk, data } }).id;
  ins('TEXT', { textType: 'TITLE', text: 'Relatório de Ação' });
  ins('TEXT', { textType: 'HEADING_1', text: 'Introdução' });
  ins('TEXT', { runs: [{ id: 'a', text: 'Texto com ', format: {} }, { id: 'b', text: 'negrito', format: { bold: true } }, { id: 'c', text: ', itálico', format: { italic: true } }, { id: 'd', text: ' e acentos: ção, €.', format: {} }] });
  e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'LIST', parentId: blk, listType: 'NUMBERED', items: ['Primeiro', { text: 'Sub', level: 1 }, 'Segundo'] } });
  ins('TABLE', { header: true, values: [['Produto', 'Preço'], ['Notebook', 3500], ['Monitor', 1200.5]] });
  return e;
}
const summary = (e: any) => readDocument(e).blocks!.map((b: any) => b.kind === 'text' ? `${b.textType}:${b.runs.map((r: any) => r.text).join('')}${b.runs.some((r: any) => r.format?.bold) ? '*' : ''}` : b.kind === 'list' ? `${b.listType}:${b.items.map((i: any) => `${i.level}${i.runs[0].text}`).join(',')}` : b.kind === 'table' ? JSON.stringify(b.rows) : b.kind);
const reopen = async (data: any, name: string) => { const doc = await openFile(make, { name, data }); const e = make(doc.document.application); e.doc = doc; return e; };

test('zip: escreve e lê (CRC e nomes UTF-8)', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const z = writeZip([{ name: 'pasta/ação.txt', data: 'olá' }, { name: 'b.bin', data: new Uint8Array([1, 2, 3]) }]);
  const back = await readZip(z);
  assert.equal(fromUtf8(back.get('pasta/ação.txt')!), 'olá');
  assert.deepEqual([...back.get('b.bin')!], [1, 2, 3]);
});

test('documento: ida e volta por DOCX, Markdown, HTML e JSON mantém estrutura e formatação', async () => {
  const e = sampleDoc();
  const want = summary(e);
  for (const f of ['DOCX', 'HTML', 'JSON']) {
    const r = exportDocument(e, f);
    assert.equal(r.fileName, `Relatório de Ação.${f.toLowerCase()}`);
    assert.deepEqual(summary(await reopen(r.data, r.fileName)), want, f);
  }
  const md = summary(await reopen(exportDocument(e, 'MD').data, 'x.md'));
  assert.deepEqual(md, want.map((x) => x.replace(/^TITLE:/, 'HEADING_1:')), 'Markdown não distingue título de título 1');
  assert.match(exportDocument(e, 'TXT').data as string, /^Relatório de Ação\n\nIntrodução\n\nTexto com negrito, itálico e acentos: ção, €\.\n\n1\. Primeiro\n  a\. Sub\n2\. Segundo/);
});

test('planilha: XLSX com fórmulas em inglês e volta em português; CSV com ; e vírgula decimal', async () => {
  const e = make('SPREADSHEET_EDITOR');
  const sh = e.state.activeSurface!;
  e.run({ type: 'SET_CELLS', targetId: sh, payload: { start: 'A1', values: [['Mês', 'Vendas'], ['Jan', 120], ['Fev', 180.5]] } });
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'B4', value: '=SOMA(B2:B3)' } });
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'C4', value: '=SE(B4>200;"alto";VERDADEIRO)' } });
  assert.equal(toExcelFormula('=SE(B4>200;"alto";VERDADEIRO)'), 'IF(B4>200,"alto",TRUE())');
  const x = exportDocument(e, 'XLSX');
  const files = await readZip(x.data as Uint8Array);
  assert.match(fromUtf8(files.get('xl/worksheets/sheet1.xml')!), /<f>SUM\(B2:B3\)<\/f><v>300.5<\/v>/);
  const back = await reopen(x.data, 'v.xlsx');
  const s2 = back.state.activeSurface!;
  const get = (c: string) => back.run({ type: 'GET_CELL', targetId: s2, payload: { cell: c } });
  assert.deepEqual([get('B4').display, get('C4').display, get('A2').display], [300.5, 'alto', 'Jan']);
  back.run({ type: 'SET_CELL', targetId: s2, payload: { cell: 'B2', value: 20 } });
  assert.equal(get('B4').display, 200.5, 'a fórmula importada continua viva');

  const csv = exportDocument(e, 'CSV', { options: { delimiter: ';', decimal: ',' } }).data as string;
  assert.equal(csv.split('\r\n')[2], 'Fev;180,5;');
  assert.deepEqual(parseCsv(csv)[2], ['Fev', 180.5, null], 'detecta ; e vírgula decimal');
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\n1,2.5,'), [['a', 'b, c', 'd "e"'], [1, 2.5, null]]);
  assert.equal(toCsv([['x;y', 1.5]], { delimiter: ';', decimal: ',' }), '"x;y";1,5\r\n');
});

test('apresentação: PPTX ida e volta (posições, forma, tabela) e SVG do slide', async () => {
  const e = make('PRESENTATION_EDITOR');
  const sl = e.state.activeSurface!;
  const put = (contentType: string, data: any, layout: any) => e.run({ type: 'INSERT_CONTENT', payload: { contentType, parentId: sl, data, layout } }).id;
  put('TEXT', { textType: 'TITLE', text: 'Resultados' }, { x: 60, y: 40, width: 1160, height: 90 });
  const c = put('SHAPE', { shapeType: 'ELLIPSE', text: 'Meta' }, { x: 100, y: 200, width: 240, height: 160 });
  e.run({ type: 'FORMAT', targetId: c, payload: { fill: '#FBBF00' } });
  put('TABLE', { values: [['A', 'B'], [1, 2]] }, { x: 500, y: 200, width: 400, height: 120 });
  const back = await reopen(exportDocument(e, 'PPTX').data, 'deck.pptx');
  const items = readDocument(back).slides![0].items.map((i: any) => [i.kind, i.x, i.y, i.width, i.height, i.shapeType ?? null, i.fill ?? null]);
  assert.deepEqual(items, [['text', 60, 40, 1160, 90, null, null], ['shape', 100, 200, 240, 160, 'ELLIPSE', '#FBBF00'], ['table', 500, 200, 400, 120, null, null]]);
  const svg = exportDocument(e, 'SVG', { targetId: sl }).data as string;
  assert.match(svg, /^<svg[^>]+viewBox="0 0 1280 720"/);
  assert.match(svg, /<path d="M0,80 A120,80[^"]*" fill="#FBBF00"/);
  assert.equal(e.execute({ type: 'EXPORT', payload: { format: 'SVG' }, targetId: e.doc.document.rootId }).ok, false);
});

test('PDF: estrutura válida (xref aponta para os objetos) e acentos em WinAnsi', () => {
  const pdf = exportDocument(sampleDoc(), 'PDF').data as Uint8Array;
  const s = Array.from(pdf, (b) => String.fromCharCode(b)).join('');
  assert.ok(s.startsWith('%PDF-1.4'));
  const start = Number(/startxref\n(\d+)/.exec(s)![1]);
  assert.ok(s.slice(start).startsWith('xref'));
  const offsets = [...s.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(s.slice(o).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1}`));
  assert.match(s, /\(\\347\\343o,\) Tj/, 'ç=347 e ã=343 (octal WinAnsi)');
  assert.match(s, /\(\\200\.\) Tj/, '€=200');
  assert.match(s, /\/BaseFont \/Helvetica-Bold/);
});

test('importar no documento aberto: Markdown e HTML entram como conteúdo e um desfazer tira tudo', async () => {
  const e = make('DOCUMENT_EDITOR');
  const before = Object.keys(e.doc.nodes).length;
  await importFile(e, { name: 'notas.md', data: '# Notas\n\nUm **ponto** e um [link](https://x.dev).\n\n- a\n  - b\n\n| x | y |\n| --- | --- |\n| 1 | 2 |\n' });
  const s = summary(e);
  assert.deepEqual(s.slice(-4), ['HEADING_1:Notas', 'PARAGRAPH:Um ponto e um link.*', 'BULLET:0a,1b', '[["x","y"],[1,2]]']);
  e.run({ type: 'UNDO' });
  assert.equal(Object.keys(e.doc.nodes).length, before);
  e.run({ type: 'IMPORT', payload: { format: 'HTML', content: '<h2>Oi</h2><p>Texto <b>forte</b> <span style="color:#ff0000">vermelho</span></p><ol><li>um<ol><li>dois</li></ol></li></ol>' } });
  const html = readDocument(e).blocks!.slice(-3) as any[];
  assert.equal(html[0].textType, 'HEADING_2');
  assert.deepEqual(html[1].runs.map((r: any) => [r.text, r.format?.bold ?? false, r.format?.color ?? null]), [['Texto ', false, null], ['forte', true, null], [' ', false, null], ['vermelho', false, '#FF0000']]);
  assert.deepEqual(html[2].items.map((i: any) => i.level), [0, 1]);
  assert.deepEqual(parseMdInline('a **b _c_** \\*d'), [{ text: 'a ', format: {} }, { text: 'b ', format: { bold: true } }, { text: 'c', format: { bold: true, italic: true } }, { text: ' *d', format: {} }]);
  assert.equal(fromMarkdown('---').blocks![0].kind, 'break');
});

test('Markdown numa apresentação vira slides (um por título)', async () => {
  const e = make('PRESENTATION_EDITOR');
  await importFile(e, { name: 'p.md', data: '# Capa\n\nSubtítulo\n\n# Problema\n\n- custo\n- prazo\n' });
  const sl = readDocument(e).slides!;
  assert.equal(sl.length, 2, 'o slide vazio inicial é aproveitado');
  assert.equal(sl[1].items[0].runs![0].text, 'Problema');
});

test('impressão: intervalo de páginas, slides e planilha dividida com linhas repetidas', () => {
  const d = make('DOCUMENT_EDITOR');
  const blk = d.state.activeSurface!;
  for (let i = 0; i < 3; i++) { d.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data: { text: 'x' } } }); d.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'BREAK', parentId: blk, breakType: 'PAGE' } }); }
  d.run({ type: 'SET_PRINT', payload: { range: '2-3', copies: 2 } });
  const pl = d.run({ type: 'PRINT_LAYOUT' }) as any;
  assert.deepEqual([pl.pages.map((p: any) => p.number), pl.copies], [[2, 3], 2]);
  const s = make('SPREADSHEET_EDITOR');
  const sh = s.state.activeSurface!;
  s.run({ type: 'SET_CELLS', targetId: sh, payload: { start: 'A1', values: Array.from({ length: 80 }, (_, i) => [`linha ${i + 1}`, i]) } });
  s.run({ type: 'SET_PRINT', payload: { repeatRows: 1 } });
  const sp = s.run({ type: 'PRINT_LAYOUT' }) as any;
  assert.ok(sp.pages.length >= 2);
  assert.equal(sp.pages[0].range.startsWith('A1:B'), true);
  assert.equal(sp.pages[1].repeatRows, '1:1');
  const p = make('PRESENTATION_EDITOR');
  p.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SLIDE' } });
  assert.equal((p.run({ type: 'PRINT_LAYOUT' }) as any).pages.length, 2);
});

test('conversão em lote (inclusive pacotes ZIP pela versão assíncrona)', async () => {
  const e = make('DOCUMENT_EDITOR');
  const out = e.run({ type: 'CONVERT_BATCH', payload: { to: 'HTML', files: [{ name: 'a.md', content: '# A' }, { name: 'b.csv', content: 'x;y\n1;2' }, { name: 'c.docx', content: '' }, { name: 'd.exe', content: '' }] } }) as any[];
  assert.deepEqual(out.map((r) => r.ok), [true, true, false, false]);
  assert.match(out[0].data, /<h1>A<\/h1>/);
  assert.match(out[1].data, /<td>x<\/td><td>y<\/td>/);
  const docx = exportDocument(sampleDoc(), 'DOCX').data;
  const all = await convertFiles(make, [{ name: 'r.docx', data: docx }, { name: 'q.md', data: '**oi**' }], 'PDF');
  assert.deepEqual(all.map((r) => [r.ok, r.fileName]), [[true, 'r.pdf'], [true, 'q.pdf']]);
});

test('formas no documento saem no HTML e no PDF e voltam na importação', async () => {
  const e = make('DOCUMENT_EDITOR');
  const c = e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'SHAPE', parentId: e.state.activeSurface, data: { shapeType: 'CIRCLE', text: '112%' }, layout: { width: 180, height: 180 } } }).id;
  e.run({ type: 'FORMAT', targetId: c, payload: { fill: '#FBBF00', color: '#000000', bold: true } });
  const html = exportDocument(e, 'HTML').data as string;
  assert.match(html, /<div class="shape" role="img" aria-label="112%" style="width:180px;height:180px;[^"]*background:#FBBF00;color:#000000;font-weight:700;border-radius:50%;/);
  const pdf = Array.from(exportDocument(e, 'PDF').data as Uint8Array, (x) => String.fromCharCode(x)).join('');
  assert.match(pdf, / c f/, 'círculo desenhado com curvas');
  assert.match(pdf, /\(112%\) Tj/);
  const back = await reopen(exportDocument(e, 'JSON').data, 'x.json');
  const shape = readDocument(back).blocks!.find((b: any) => b.kind === 'shape') as any;
  assert.deepEqual([shape.shapeType, shape.fill, shape.bold, shape.runs[0].text], ['CIRCLE', '#FBBF00', true, '112%']);
  assert.equal(exportDocument(e, 'TXT').data, '112%\n', 'forma não vira quebra de página no texto');
});
