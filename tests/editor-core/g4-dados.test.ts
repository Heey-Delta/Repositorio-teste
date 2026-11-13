// G4 · Dados de cada publicação: rotas próprias, CSV e JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataItems, toCsv, toJsonRecords, describe } from '../../src/lib/data-items.ts';
import { pseudoToPost } from '../../src/lib/pseudo.ts';

const { body } = pseudoToPost(`<doc: Relatório (
<txt: Introdução>
<tbl: {hash}( Produto, Preço | Notebook | 3.500,50 | Mouse | 50 )>
<grf.colunas: {g1.Vendas por mês}( Mês, Vendas | Jan | 120 | Fev | 180 )>
<pln: {p1}( <A.1: Item> <B.1: Valor> <A.2: Luz> <B.2: 100> <A.3: Total> <B.3: =SOMA(B2:B2)> )>
<tbl: {hash}( Nome, Nota | Ana | 9 )>
<img: /img/foto.webp | Equipe reunida>
<apr: {s1.Abertura}( <sld: ( <h1: Capa> )> <sld: ( <h1: Números> )> )>
)>`);

test('cada dado tem rota única, na ordem do texto', () => {
  const items = dataItems(body);
  assert.deepEqual(items.map((i) => `${i.kind}:${i.slug}`), ['tabela:tabela-1', 'grafico:vendas-por-mes', 'planilha:planilha-1', 'tabela:tabela-2', 'foto:equipe-reunida', 'apresentacao:abertura']);
  assert.deepEqual(items[0].rows, [['Produto', 'Preço'], ['Notebook', 3500.5], ['Mouse', 50]]);
  assert.deepEqual(items[2].rows, [['Item', 'Valor'], ['Luz', 100], ['Total', 100]]);
  assert.deepEqual(items[5].rows.map((r) => r[1]), ['Capa', 'Números']);
});

test('CSV abre no Excel em português (;, vírgula decimal, BOM) e JSON vira registros', () => {
  const [t] = dataItems(body);
  assert.equal(toCsv(t.rows), '﻿Produto;Preço\r\nNotebook;3500,5\r\nMouse;50\r\n');
  assert.deepEqual(toJsonRecords(t.rows), [{ Produto: 'Notebook', Preço: 3500.5 }, { Produto: 'Mouse', Preço: 50 }]);
  assert.equal(describe(t, 'Relatório'), 'Tabela com 2 linhas e as colunas Produto, Preço, da publicação "Relatório".');
});

test('nomes repetidos ganham sufixo', () => {
  const items = dataItems(':::chart {name="Vendas" data="a;b&#10;x;1"} :::\n\n:::chart {name="Vendas" data="a;b&#10;x;2"} :::\n');
  assert.deepEqual(items.map((i) => i.slug), ['vendas', 'vendas-2']);
});
