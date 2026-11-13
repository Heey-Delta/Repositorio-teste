// Etapa 06: motor de diagramas — itens, ligações, layout automático e traçado dos conectores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument } from '../../src/editor-core/index.ts';

function diagram(data: any) {
  const e = createEngine(createDocument());
  const id = e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'DIAGRAM', data } }).id as string;
  const d = () => e.get(id).data;
  const item = (label: string) => d().items.find((x: any) => x.label === label);
  const run = (type: string, payload: any) => e.run({ type, targetId: id, payload });
  return { e, id, d, item, run };
}
const overlap = (a: any, b: any) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const noOverlaps = (items: any[]) => { for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) assert.ok(!overlap(items[i], items[j]), `${items[i].label} × ${items[j].label}`); };

test('organograma a partir de tópicos: árvore com pai centrado sobre os filhos', () => {
  const { d, item, run } = diagram({ diagramType: 'ORGCHART', outline: 'Diretoria\n  Vendas\n    Loja A\n    Loja B\n  TI\n  RH' });
  assert.equal(d().items.length, 6);
  const dir = item('Diretoria'), ven = item('Vendas'), a = item('Loja A'), b = item('Loja B');
  assert.ok(ven.y > dir.y && a.y > ven.y, 'níveis de cima para baixo');
  assert.equal(Math.round(ven.x + ven.width / 2), Math.round((a.x + b.x + b.width) / 2), 'pai centrado nos filhos');
  noOverlaps(d().items);
  assert.equal(d().routes.filter((r: any) => r.implicit).length, 5, 'uma ligação por relação pai→filho');
  assert.equal(d().routes[0].points.length, 4, 'organograma usa cotovelo');
  assert.ok(d().bounds.width > 0 && d().bounds.height > 0);
  assert.equal(run('DIAGRAM_TO_TEXT', {}), 'Diretoria\n  Vendas\n    Loja A\n    Loja B\n  TI\n  RH');
});

test('fluxograma: camadas pelo caminho mais longo, decisão com ramos e retorno sem quebrar', () => {
  const { e, d, item, run } = diagram({ diagramType: 'FLOWCHART', items: [{ id: 'i', label: 'Início', kind: 'START' }, { id: 'p', label: 'Preencher pedido' }, { id: 'q', label: 'Pedido ok?', kind: 'DECISION' }, { id: 'f', label: 'Fim', kind: 'END' }], connections: [{ from: 'i', to: 'p' }, { from: 'p', to: 'q' }, { from: 'q', to: 'f', label: 'Sim' }, { from: 'q', to: 'p', label: 'Não' }] });
  const ys = ['Início', 'Preencher pedido', 'Pedido ok?', 'Fim'].map((l) => item(l).y);
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, 'uma camada por passo, o retorno não sobe ninguém');
  assert.equal(item('Pedido ok?').resolvedShape, 'DIAMOND');
  assert.equal(item('Início').resolvedShape, 'ELLIPSE');
  assert.equal(d().routes.find((r: any) => r.label === 'Não').to, 'p');
  const corr = run('DIAGRAM_ADD_ITEM', { label: 'Corrigir', connectFrom: 'q', connectionLabel: 'Não' });
  assert.equal(item('Corrigir').y + item('Corrigir').height / 2, item('Fim').y + item('Fim').height / 2, 'ramos da decisão ficam na mesma camada');
  noOverlaps(d().items);
  e.run({ type: 'UNDO' });
  assert.equal(d().items.some((x: any) => x.id === corr), false);
  run('DIAGRAM_LAYOUT', { direction: 'LR' });
  const xs = ['Início', 'Preencher pedido', 'Pedido ok?', 'Fim'].map((l) => item(l).x);
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, 'da esquerda para a direita');
});

test('itens: editar, promover, rebaixar, mover, remover (filhos sobem) e validação', () => {
  const { e, id, d, item, run } = diagram({ diagramType: 'HIERARCHY', outline: 'A\n  B\n  C\n    D' });
  run('DIAGRAM_DEMOTE', { itemId: item('C').id });
  assert.equal(item('C').parentId, item('B').id);
  run('DIAGRAM_PROMOTE', { itemId: item('C').id });
  assert.equal(item('C').parentId, item('A').id);
  run('DIAGRAM_MOVE_ITEM', { itemId: item('C').id, direction: 'UP' });
  assert.equal(run('DIAGRAM_TO_TEXT', {}), 'A\n  C\n    D\n  B');
  run('DIAGRAM_REMOVE_ITEM', { itemId: item('C').id });
  assert.equal(item('D').parentId, item('A').id, 'o filho sobe para o avô');
  run('DIAGRAM_UPDATE_ITEM', { itemId: item('D').id, label: 'Delta', kind: 'NOTE' });
  assert.equal(item('Delta').resolvedShape, 'CALLOUT');
  assert.equal(e.execute({ type: 'DIAGRAM_SET_PARENT', targetId: id, payload: { itemId: item('A').id, parentId: item('Delta').id } }).ok, false, 'ciclo na hierarquia');
  assert.equal(e.execute({ type: 'DIAGRAM_UPDATE_ITEM', targetId: id, payload: { itemId: item('A').id, kind: 'BOLHA' } }).ok, false);
  assert.equal(e.execute({ type: 'DIAGRAM_CONNECT', targetId: id, payload: { from: item('A').id, to: item('A').id } }).ok, false, 'ligar a si mesmo');
  assert.equal(e.execute({ type: 'DIAGRAM_ADD_ITEM', targetId: id, payload: { label: 'X', parentId: 'NADA' } }).ok, false);
  assert.equal(d().items.length, 3, 'operações recusadas não deixam rastro');
  run('DIAGRAM_REMOVE_ITEM', { itemId: item('A').id, withChildren: true });
  assert.equal(d().items.length, 0);
});

test('ligações: conectar, mudar traçado, desconectar', () => {
  const { e, id, d, run } = diagram({ diagramType: 'FLOWCHART', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  const c = run('DIAGRAM_CONNECT', { from: 'a', to: 'b' });
  assert.equal(e.execute({ type: 'DIAGRAM_CONNECT', targetId: id, payload: { from: 'a', to: 'b' } }).ok, false, 'repetida');
  run('DIAGRAM_UPDATE_CONNECTION', { connectionId: c, routing: 'STRAIGHT', label: 'segue' });
  const r = d().routes.find((x: any) => x.id === c);
  assert.equal(r.points.length, 2);
  assert.deepEqual(r.points[0], { x: d().items[0].x + d().items[0].width / 2, y: d().items[0].y + d().items[0].height }, 'sai da base de A');
  assert.equal(r.points[1].y, d().items[1].y, 'chega no topo de B');
  run('DIAGRAM_DISCONNECT', { connectionId: c });
  assert.equal(d().routes.length, 0);
});

test('mover à mão entra no modo manual; DIAGRAM_LAYOUT volta ao automático', () => {
  const { d, item, run } = diagram({ diagramType: 'PROCESS', items: [{ label: 'Planejar' }, { label: 'Fazer' }, { label: 'Checar' }] });
  assert.ok(item('Planejar').x < item('Fazer').x && item('Fazer').x < item('Checar').x, 'processo da esquerda para a direita');
  assert.equal(d().routes.length, 2, 'sequência implícita');
  run('DIAGRAM_UPDATE_ITEM', { itemId: item('Fazer').id, x: 400, y: 300 });
  assert.equal(d().autoLayout, false);
  assert.deepEqual([item('Fazer').x, item('Fazer').y], [400, 300]);
  run('DIAGRAM_ADD_ITEM', { label: 'Agir' });
  assert.ok(item('Agir').y >= 300 + item('Fazer').height, 'item novo entra abaixo');
  run('DIAGRAM_LAYOUT', {});
  assert.equal(d().autoLayout, undefined);
  assert.ok(item('Fazer').x < item('Checar').x && item('Checar').x < item('Agir').x);
});

test('mapa mental radial, ciclo, Venn e troca de tipo', () => {
  const m = diagram({ diagramType: 'MINDMAP', outline: 'Projeto\n  Prazo\n  Custo\n  Equipe\n  Riscos' });
  const c = m.item('Projeto');
  const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
  const dist = ['Prazo', 'Custo', 'Equipe', 'Riscos'].map((l) => { const x = m.item(l); return Math.hypot(x.x + x.width / 2 - cx, x.y + x.height / 2 - cy); });
  for (const v of dist) assert.ok(Math.abs(v - 200) < 2, 'ramos à mesma distância do centro');
  noOverlaps(m.d().items);

  const cy1 = diagram({ diagramType: 'CYCLE', items: [{ label: '1' }, { label: '2' }, { label: '3' }, { label: '4' }] });
  assert.equal(cy1.d().routes.length, 4, 'o ciclo fecha');
  noOverlaps(cy1.d().items);

  const v = diagram({ diagramType: 'VENN', items: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] });
  assert.ok(overlap(v.item('A'), v.item('B')) && overlap(v.item('B'), v.item('C')), 'círculos se sobrepõem');
  assert.equal(v.item('A').resolvedShape, 'CIRCLE');
  assert.equal(v.d().routes.length, 0);

  const f = diagram({ diagramType: 'FLOWCHART', items: [{ id: 'a', label: 'Chefe' }, { id: 'b', label: 'Ana' }, { id: 'c', label: 'Bia' }], connections: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }] });
  f.run('DIAGRAM_CHANGE_TYPE', { diagramType: 'ORGCHART' });
  assert.deepEqual([f.item('Ana').parentId, f.item('Bia').parentId], ['a', 'a'], 'hierarquia deduzida das ligações');
  assert.equal(f.d().connections.length, 0);
  assert.equal(f.d().routes.length, 2);
});
