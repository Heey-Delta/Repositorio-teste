// Etapa 12: funções do usuário, macros, scripts, automações, atalhos, extensões e serviços externos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, callService, installCodeExtension, normalizeKeys } from '../../src/editor-core/index.ts';

function sheet() {
  const e = createEngine(createDocument('SPREADSHEET_EDITOR'));
  const sh = e.state.activeSurface!;
  const set = (cell: string, value: unknown) => e.run({ type: 'SET_CELL', targetId: sh, payload: { cell, value } });
  const get = (cell: string) => e.run({ type: 'GET_CELL', targetId: sh, payload: { cell } }).display;
  return { e, sh, set, get };
}

test('função do usuário: definir, usar, redefinir, desfazer e validar', () => {
  const { e, set, get } = sheet();
  e.run({ type: 'DEFINE_FUNCTION', payload: { name: 'imposto', params: ['valor', 'taxa'], body: '=valor*taxa' } });
  set('A1', 1000);
  set('B1', '=IMPOSTO(A1;0.15)');
  assert.equal(get('B1'), 150);
  e.run({ type: 'DEFINE_FUNCTION', payload: { name: 'BRUTO', params: ['v'], body: '=v+IMPOSTO(v;0.1)' } });
  set('C1', '=BRUTO(A1)');
  assert.equal(get('C1'), 1100, 'função do usuário chamando outra');
  e.run({ type: 'DEFINE_FUNCTION', payload: { name: 'IMPOSTO', params: ['valor', 'taxa'], body: '=ARRED(valor*taxa*2;0)' } });
  assert.deepEqual([get('B1'), get('C1')], [300, 1200], 'redefinir recalcula quem usa');
  e.run({ type: 'UNDO' });
  assert.deepEqual([get('B1'), get('C1')], [150, 1100], 'desfazer volta a definição e os valores');
  set('D1', '=IMPOSTO(A1;"x")');
  assert.equal(get('D1'), '#VALUE!');
  const bad = (p: any) => assert.equal(e.execute({ type: 'DEFINE_FUNCTION', payload: p }).ok, false, JSON.stringify(p));
  bad({ name: 'SOMA', params: ['x'], body: '=x' });
  bad({ name: 'F', params: ['x'], body: '=x+A1' });
  bad({ name: 'F', params: ['x'], body: '=y' });
  bad({ name: 'F', params: ['B2'], body: '=B2' });
  bad({ name: 'F', params: ['x', 'X'], body: '=x' });
  e.run({ type: 'DEFINE_FUNCTION', payload: { name: 'LOOP', params: ['x'], body: '=LOOP(x)' } });
  set('E1', '=LOOP(1)');
  assert.equal(get('E1'), '#NUM!', 'recursão sem fim vira erro, não trava');
  e.run({ type: 'DELETE_FUNCTION', payload: { name: 'bruto' } });
  assert.equal(get('C1'), '#NAME?');
});

test('macros: gravar, rodar na seleção (um desfazer) e apagar', () => {
  const e = createEngine(createDocument('PRESENTATION_EDITOR'));
  const s = e.state.activeSurface!;
  const shape = () => e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'SHAPE', parentId: s, data: {} } }).id as string;
  const a = shape(), b = shape();
  e.run({ type: 'START_RECORDING', payload: { name: 'Destaque' } });
  e.run({ type: 'FORMAT', targetId: a, payload: { fill: '#FBBF00' } });
  e.run({ type: 'SELECT', targetId: a });
  e.run({ type: 'FORMAT', targetId: a, payload: { strokeWidth: 4 } });
  const m = e.run({ type: 'STOP_RECORDING' }) as any;
  assert.equal(m.steps, 2, 'só o que mudou o documento');
  e.run({ type: 'SELECT', targetId: b });
  e.run({ type: 'RUN_MACRO', payload: { name: 'destaque', applyToSelection: true } });
  assert.deepEqual([e.get(b).styleOverrides.fill, e.get(b).styleOverrides.strokeWidth], ['#FBBF00', 4]);
  e.run({ type: 'UNDO' });
  assert.equal(e.get(b).styleOverrides.fill, undefined, 'a macro inteira desfaz de uma vez');
  assert.deepEqual((e.run({ type: 'LIST_MACROS' }) as any[]).map((x) => x.name), ['Destaque']);
  assert.equal(e.execute({ type: 'STOP_RECORDING' }).ok, false);
  e.run({ type: 'START_RECORDING', payload: { name: 'vazia' } });
  assert.equal(e.execute({ type: 'STOP_RECORDING' }).ok, false, 'nada gravado');
});

test('scripts: variáveis, repetição, forEach, condição e limites', () => {
  const e = createEngine(createDocument());
  const blk = e.state.activeSurface!;
  const r = e.run({ type: 'RUN_SCRIPT', payload: {
    variables: { nomes: ['Ana', 'Bia'] },
    steps: [
      { forEach: '{{nomes}}', as: 'nome', steps: [{ op: { type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data: { text: 'Olá, {{nome}}!' } } }, saveAs: 'ultimo' }] },
      { repeat: 3, as: 'i', steps: [{ if: { var: 'i', equals: 1 }, then: [{ set: 'meio', value: 'passou no {{i}}' }] }] },
      { if: { var: 'ultimo.id', exists: true }, then: [{ op: { type: 'FORMAT', targetId: '{{ultimo.id}}', payload: { bold: true } } }] },
    ] } }) as any;
  assert.equal(r.variables.meio, 'passou no 1');
  const texts = e.get(blk).children.map((id) => e.get(id)).filter((n) => n.type === 'TEXT').map((n) => n.data.runs[0].text);
  assert.deepEqual(texts.slice(-2), ['Olá, Ana!', 'Olá, Bia!']);
  assert.equal(e.get(r.variables.ultimo.id).styleOverrides.bold, true);
  e.run({ type: 'UNDO' });
  assert.equal(e.get(blk).children.filter((id) => e.get(id).type === 'TEXT').length, texts.length - 2, 'o script inteiro desfaz de uma vez');
  assert.equal(e.execute({ type: 'RUN_SCRIPT', payload: { steps: [{ repeat: 5000, steps: [] }] } }).ok, false);
  assert.equal(e.execute({ type: 'RUN_SCRIPT', payload: { steps: [{ eval: 'process.exit()' }] } }).ok, false, 'não existe passo que roda código');
  const before = Object.keys(e.doc.nodes).length;
  assert.equal(e.execute({ type: 'RUN_SCRIPT', payload: { steps: [{ op: { type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data: { text: 'x' } } } }, { op: { type: 'NADA' } }] } }).ok, false);
  assert.equal(Object.keys(e.doc.nodes).length, before, 'erro no meio desfaz o que o script já tinha feito');
});

test('automações: célula alterada no intervalo dispara passos na mesma transação', () => {
  const { e, sh, set, get } = sheet();
  e.run({ type: 'ADD_AUTOMATION', payload: { name: 'Total', event: 'CELL_CHANGED', condition: { range: 'B2:B10' }, steps: [{ op: { type: 'SET_CELL', targetId: '{{sheetId}}', payload: { cell: 'D1', value: 'mudou {{cell}} para {{value}}' } } }] } });
  set('B3', 50);
  assert.equal(get('D1'), 'mudou B3 para 50');
  set('A1', 1);
  assert.equal(get('D1'), 'mudou B3 para 50', 'fora do intervalo não dispara');
  e.run({ type: 'UNDO' }); e.run({ type: 'UNDO' });
  assert.deepEqual([get('B3'), get('D1')], [null, null], 'um desfazer leva a ação e a automação');
  e.run({ type: 'ADD_AUTOMATION', payload: { name: 'Quebrada', event: 'CELL_CHANGED', steps: [{ op: { type: 'NADA' } }] } });
  const r = e.execute({ type: 'SET_CELL', targetId: sh, payload: { cell: 'B4', value: 1 } });
  assert.match(r.error!.message, /Quebrada.*Desative/);
  const id = (e.run({ type: 'LIST_AUTOMATIONS' }) as any[]).find((a) => a.name === 'Quebrada').id;
  e.run({ type: 'UPDATE_AUTOMATION', payload: { automationId: id, enabled: false } });
  assert.equal(e.execute({ type: 'SET_CELL', targetId: sh, payload: { cell: 'B4', value: 1 } }).ok, true);
  assert.equal(e.execute({ type: 'ADD_AUTOMATION', payload: { name: 'x', event: 'NUNCA', steps: [{ stop: true }] } }).ok, false);
});

test('automação respeita permissões e entra no controle de alterações', () => {
  const e = createEngine(createDocument());
  const blk = e.state.activeSurface!;
  e.run({ type: 'SET_USER', payload: { id: 'ana', name: 'Ana' } });
  e.run({ type: 'SHARE', payload: { userId: 'bia', name: 'Bia', role: 'COMMENTER' } });
  e.run({ type: 'ADD_AUTOMATION', payload: { name: 'Responder', event: 'COMMENT_ADDED', steps: [{ op: { type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data: { text: 'novo comentário: {{text}}' } } } }] } });
  const t = e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data: { text: 'oi' } } }).id;
  e.run({ type: 'SET_USER', payload: { id: 'bia', name: 'Bia' } });
  assert.equal(e.execute({ type: 'ADD_COMMENT', targetId: t, payload: { text: 'teste' } }).error?.code, 'PERMISSION_DENIED', 'a automação mexeria no texto, e a Bia só comenta');
  e.run({ type: 'SET_USER', payload: { id: 'ana', name: 'Ana' } });
  e.run({ type: 'SET_TRACK_CHANGES', payload: { enabled: true } });
  e.run({ type: 'ADD_COMMENT', targetId: t, payload: { text: 'da Ana' } });
  const ch = e.run({ type: 'LIST_CHANGES' }) as any[];
  assert.ok(ch.at(-1).items.some((i: any) => i.kind === 'INSERTED' && i.text?.inserted === 'novo comentário: da Ana'));
});

test('atalhos: normalização, padrões, personalizar e apagar', () => {
  const e = createEngine(createDocument());
  assert.equal(normalizeKeys('shift+cmd+b'), 'Ctrl+Shift+B');
  assert.deepEqual(e.run({ type: 'RESOLVE_SHORTCUT', payload: { keys: 'Cmd+Z' } }), { operation: { type: 'UNDO' } });
  const r = e.run({ type: 'SET_SHORTCUT', payload: { keys: 'ctrl+d', command: 'BOOKMARK' } }) as any;
  assert.deepEqual(r.previous, { operation: { type: 'DUPLICATE' } }, 'avisa o que substituiu');
  assert.equal(e.execute({ type: 'SET_SHORTCUT', payload: { keys: 'Ctrl+Q', operation: { type: 'NAO_EXISTE' } } }).ok, false);
  e.run({ type: 'SET_SHORTCUT', payload: { keys: 'Ctrl+D', operation: null } });
  assert.equal(e.run({ type: 'RESOLVE_SHORTCUT', payload: { keys: 'Ctrl+D' } }), null);
  e.run({ type: 'RESET_SHORTCUTS' });
  assert.ok(e.run({ type: 'RESOLVE_SHORTCUT', payload: { keys: 'Ctrl+D' } }));
  assert.equal(e.history.past.length, 0, 'atalhos são preferência da sessão, não do documento');
});

test('extensões: instalar (função, operação composta, macro, atalho), desativar, desinstalar', () => {
  const { e, sh, set, get } = sheet();
  const manifest = {
    id: 'notas-fiscais', name: 'Notas fiscais', version: '1.0.0',
    functions: [{ name: 'ICMS', params: ['v'], body: '=v*0.18' }],
    operations: [{ type: 'NOTAS_FISCAIS.CABECALHO', steps: [{ op: { type: 'SET_CELLS', targetId: '{{targetId}}', payload: { start: 'A1', values: [['Produto', 'Valor', 'ICMS']] } } }, { set: 'result', value: 'ok' }] }],
    shortcuts: [{ keys: 'Ctrl+Alt+N', operation: { type: 'NOTAS_FISCAIS.CABECALHO' } }],
  };
  e.run({ type: 'INSTALL_EXTENSION', payload: { manifest } });
  assert.equal(e.run({ type: 'NOTAS_FISCAIS.CABECALHO', targetId: sh }), 'ok');
  assert.equal(get('C1'), 'ICMS');
  set('B2', 100); set('C2', '=ICMS(B2)');
  assert.equal(get('C2'), 18);
  assert.deepEqual(e.run({ type: 'RESOLVE_SHORTCUT', payload: { keys: 'ctrl+alt+n' } }), { operation: { type: 'NOTAS_FISCAIS.CABECALHO' } });
  e.run({ type: 'DISABLE_EXTENSION', payload: { id: 'notas-fiscais' } });
  assert.equal(get('C2'), '#NAME?');
  assert.equal(e.has('NOTAS_FISCAIS.CABECALHO'), false);
  e.run({ type: 'UNDO' });
  assert.equal(get('C2'), 18, 'desfazer reativa');
  assert.equal(e.has('NOTAS_FISCAIS.CABECALHO'), true);
  e.run({ type: 'UNINSTALL_EXTENSION', payload: { id: 'notas-fiscais' } });
  assert.equal((e.run({ type: 'LIST_EXTENSIONS' }) as any[]).length, 0);
  assert.equal(e.execute({ type: 'INSTALL_EXTENSION', payload: { manifest: { ...manifest, operations: [{ type: 'DELETE', steps: [] }] } } }).ok, false, 'não sobrescreve operação do sistema');
  installCodeExtension(e, { id: 'sistema', handlers: { 'SISTEMA.OI': () => 'olá' } });
  assert.equal(e.run({ type: 'SISTEMA.OI' }), 'olá');
});

test('serviços externos: webhook por evento e chamada com resposta usada num script', async () => {
  const { e, sh, set, get } = sheet();
  const calls: any[] = [];
  e.services.http = async (url: string, init: any) => { calls.push({ url, ...init, body: init.body && JSON.parse(init.body) }); return { ok: true, status: 200, text: async () => JSON.stringify({ cotacao: 5.42 }) }; };
  assert.equal(e.execute({ type: 'ADD_WEBHOOK', payload: { url: 'http://inseguro.dev/x' } }).ok, false, 'só https');
  e.run({ type: 'ADD_WEBHOOK', payload: { url: 'https://hooks.exemplo.dev/editor', events: ['CELL_CHANGED'] } });
  set('A1', 7);
  await Promise.all(e.services.pendingDeliveries);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].method, calls[0].body.event, calls[0].body.data.cell, calls[0].body.data.value], ['POST', 'CELL_CHANGED', 'A1', 7]);
  assert.equal(e.services.webhookLog[0].ok, true);
  const r = await callService(e, { url: 'https://api.exemplo.dev/dolar', then: [{ op: { type: 'SET_CELL', targetId: sh, payload: { cell: 'B1', value: '{{response.cotacao}}' } } }] });
  assert.deepEqual([r.status, get('B1')], [200, 5.42]);
  const got: any[] = [];
  e.on('service-result', (x) => got.push(x));
  const { requestId } = e.run({ type: 'CALL_SERVICE', payload: { url: 'https://api.exemplo.dev/dolar' } });
  await e.services.pendingRequests.get(requestId);
  assert.deepEqual([got[0].requestId, got[0].data.cotacao], [requestId, 5.42]);
});
