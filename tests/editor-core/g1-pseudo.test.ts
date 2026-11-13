// G1 · Pseudocódigo: o padrão do Hallan → publicação → pseudocódigo de novo, e até o PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePseudo, pseudoToPost, postToPseudo, pseudoToModel, tableRows, inlineToMd, inlineFromMd } from '../../src/lib/pseudo.ts';
import { dataItems } from '../../src/lib/data-items.ts';
import { slidesHtml } from '../../src/lib/rich-blocks.ts';
import { toPdf } from '../../src/editor-core/io/pdf.ts';

const EXEMPLO = `<doc: teste 1 (
<h1.anton: Resultados do trimestre>
<txt: Paragrafo com *negrito*>
<tbl: {hash}( Produto, Preço | Notebook | 500)>
<pln: {hash}(
<A.1: Produto>
<A.2: preço>
<B.1: Pc>
<B.2: 67>)>
<sld: {hash.nome}(
<h1: contexto>
<h4: - Ponto um, - Ponto 2>
)
)>`;

test('lê o exemplo do jeito que foi escrito (inclusive o <sld> fechado só com ")")', () => {
  const [doc] = parsePseudo(EXEMPLO);
  assert.equal(doc.tag, 'doc');
  assert.equal(doc.text, 'teste 1');
  assert.deepEqual(doc.children!.map((c) => c.tag), ['h1', 'txt', 'tbl', 'pln', 'sld']);
  assert.deepEqual(doc.children![0].mods, ['anton']);
  const pln = doc.children![3];
  assert.match(pln.id!, /^[a-z0-9]{6}$/);
  assert.deepEqual(pln.children!.map((c) => `${c.tag}=${c.text}`), ['A1=Produto', 'A2=preço', 'B1=Pc', 'B2=67']);
  assert.equal(doc.children![4].name, 'nome');
});

test('tabela: cabeçalho por vírgula, células por "|", várias linhas', () => {
  assert.deepEqual(tableRows(' Produto, Preço | Notebook | 500'), [['Produto', 'Preço'], ['Notebook', '500']]);
  assert.deepEqual(tableRows('A, B | 1 | 2 | 3 | 4'), [['A', 'B'], ['1', '2'], ['3', '4']]);
  assert.deepEqual(tableRows('Nome\\, completo, Valor | Ana \\| Bia | 10'), [['Nome, completo', 'Valor'], ['Ana | Bia', '10']]);
});

test('texto: *negrito* _itálico_ ~riscado~ nos dois sentidos', () => {
  assert.equal(inlineToMd('a *b* _c_ ~d~'), 'a **b** *c* ~~d~~');
  assert.equal(inlineFromMd('a **b** *c* ~~d~~'), 'a *b* _c_ ~d~');
});

test('pseudocódigo → publicação: título, seções, tabela, planilha com fórmula e apresentação', () => {
  const { title, body } = pseudoToPost(EXEMPLO.replace('<B.2: 67>', '<B.2: 67>\n<B.3: =B2*2>'));
  assert.equal(title, 'teste 1');
  assert.match(body, /^## Resultados do trimestre/m);
  assert.match(body, /Paragrafo com \*\*negrito\*\*/);
  assert.match(body, /\| Produto \| Preço \|\n\| --- \| --- \|\n\| Notebook \| 500 \|/);
  assert.match(body, /:::sheet \{id="[a-z0-9]{6}" cells=/);
  assert.match(body, /:::slides \{id="[a-z0-9]{6}" name="nome" deck=/);
  const items = dataItems(body);
  assert.deepEqual(items.map((i) => [i.kind, i.slug]), [['tabela', 'tabela-1'], ['planilha', 'planilha-1'], ['apresentacao', 'nome']]);
  // A1 = coluna A, linha 1 (como no Excel); a fórmula é calculada
  assert.deepEqual(items[1].rows, [['Produto', 'Pc'], ['preço', 67], [null, 134]]);
  assert.equal(items[2].rows.length, 1);
});

test('publicação → pseudocódigo → publicação: volta igual (ids e nomes mantidos)', () => {
  const first = pseudoToPost(`<doc: Relatório (
<h1: Visão geral>
<txt: Texto com *destaque* e [link](https://exemplo.com).>
<lst: - um, - dois>
<lst.num: - primeiro, - segundo>
<cit: Uma citação>
<tbl: {hash}( Mês, Vendas | Jan | 120 | Fev | 180 )>
<grf.linhas: {g1a2b3.Vendas mensais} Vendas( Mês, Vendas | Jan | 120 | Fev | 180 )>
<dgm.organograma: {d9.Equipe}( Diretoria
- Vendas
-- Loja A
- Tecnologia )>
<eq: E = mc^2>
<frm.estrela#FBBF00: Novo>
<img: https://exemplo.com/a.png | Uma foto>
<pln: {p1.Custos}( <A.1: Item> <B.1: Valor> <A.2: Luz> <B.2: 100> <A.3: Total> <B.3: =SOMA(B2:B2)> )>
<apr: {s1.Abertura}( <sld: ( <h1: Capa> <h4: - a, - b> )> <sld#FFFFFF: ( <h2: Dados> )> )>
)>`);
  const pseudo = postToPseudo(first.title, first.body);
  const again = pseudoToPost(pseudo);
  assert.equal(again.title, 'Relatório');
  // ids das apresentações dos slides mudam (são internos); o resto do corpo volta igual
  const strip = (b: string) => b.replace(/"id\\&quot;:\\&quot;[^&]*\\&quot;/g, '').replace(/&quot;id&quot;:&quot;[a-z0-9]+&quot;,?/g, '');
  assert.equal(strip(again.body), strip(first.body));
  assert.match(pseudo, /<grf\.linhas: \{g1a2b3\.Vendas mensais\} Vendas\(/);
  assert.match(pseudo, /<pln: \{p1\.Custos\}\(/);
  assert.match(pseudo, /<B\.3: =SOMA\(B2:B2\)>/);
  assert.deepEqual(dataItems(again.body).map((i) => i.slug), ['tabela-1', 'vendas-mensais', 'equipe', 'uma-foto', 'custos', 'abertura']);
});

test('pseudocódigo → PDF (com os slides no fim)', () => {
  const m = pseudoToModel(EXEMPLO);
  assert.equal(m.name, 'teste 1');
  assert.deepEqual(m.blocks!.map((b) => b.kind + (b.kind === 'text' ? `:${b.textType ?? 'P'}` : '')), ['text:TITLE', 'text:HEADING_1', 'text:P', 'table', 'text:HEADING_3', 'table', 'text:P']);
  assert.equal(m.slides!.length, 1);
  const pdf = toPdf(m);
  const head = new TextDecoder().decode(pdf.slice(0, 8));
  assert.equal(head.slice(0, 5), '%PDF-');
  assert.ok(pdf.length > 1500);
});

test('erros com a linha', () => {
  assert.throws(() => parsePseudo('<doc: x (\n<txt: sem fechar'), /linha 2/);
  assert.throws(() => parsePseudo('<doc: x (\n<txt: ok>'), /parêntese/);
});

test('dados dentro do slide: gráfico, tabela e diagrama ida e volta', () => {
  const src = `<doc: Deck (
<sld: {hash.Painel}(
  <h1: Resultado>
  <grf.colunas@6,25,50,60: {hash} Vendas( , Vendas | Jan | 120 | Fev | 180)>
  <tbl@60,25,34,40: {hash}( Item, Valor | Luz | 100)>
  <dgm.organograma: {hash}(Diretor
    - Gerente)>
)
)>`;
  const { body } = pseudoToPost(src);
  const items = dataItems(body);
  const deck = items.find((i) => i.kind === 'apresentacao')!.extra.deck!;
  const kinds = deck.slides[0].items.map((i) => (i.type === 'block' ? i.block : i.type));
  assert.deepEqual(kinds, ['title', 'chart', 'sheet', 'diagram']);
  const chart = deck.slides[0].items[1];
  assert.deepEqual([chart.x, chart.y, chart.w, chart.h], [6, 25, 50, 60]);
  assert.match(chart.attrs!.data, /Jan;120/);
  assert.match(deck.slides[0].items[2].attrs!.cells, /"A2":"Luz"/);
  const back = postToPseudo('Deck', body);
  assert.match(back, /<grf\.colunas@6,25,50,60: /);
  assert.match(back, /<pln@60,25,34,40: /);
  const again = dataItems(pseudoToPost(back).body).find((i) => i.kind === 'apresentacao')!.extra.deck!;
  assert.deepEqual(again.slides[0].items.map((i) => (i.type === 'block' ? i.block : i.type)), kinds);
  const html = slidesHtml({ deck: JSON.stringify(deck) });
  assert.match(html, /lab-si-block lab-si-chart[^>]*><figure class="lab-chart"/);
  const model = pseudoToModel(src);
  assert.ok(model.slides?.[0].items.some((i) => i.kind === 'text' && i.runs?.[0].text.startsWith('Gráfico')));
});
