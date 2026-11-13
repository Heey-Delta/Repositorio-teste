// Etapa 09: comentários, menções, permissões, presença, controle de alterações e edição simultânea.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, SyncSession, merge3, mergeList } from '../../src/editor-core/index.ts';

const ANA = { id: 'ana', name: 'Ana', email: 'ana@x.com' }, BIA = { id: 'bia', name: 'Bia' }, CAIO = { id: 'caio', name: 'Caio' };
function doc() {
  const e = createEngine(createDocument());
  e.services.now = () => new Date(2026, 10, 13, 10, 0);
  const txt = (text: string) => e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: e.state.activeSurface, data: { text } } }).id as string;
  const as = (u: any) => e.run({ type: 'SET_USER', payload: u });
  const text = (id: string) => e.get(id).data.runs.map((r: any) => r.text).join('');
  return { e, txt, as, text };
}

test('comentários: trecho, resposta, edição pelo autor, resolver, reabrir, apagar', () => {
  const { e, txt, as } = doc();
  as(ANA);
  const p = txt('O prazo é sexta-feira.');
  const c = e.run({ type: 'ADD_COMMENT', targetId: p, payload: { text: 'Confirmar o prazo', start: 10, end: 21 } });
  const t = e.doc.comments![c];
  assert.deepEqual([t.anchor.quote, t.status, t.messages[0].authorName], ['sexta-feira', 'OPEN', 'Ana']);
  as(BIA);
  e.run({ type: 'REPLY_COMMENT', payload: { commentId: c, text: 'Confirmado' } });
  assert.equal(e.execute({ type: 'EDIT_COMMENT', payload: { commentId: c, text: 'mudei' } }).error?.code, 'PERMISSION_DENIED', 'só o autor edita');
  e.run({ type: 'RESOLVE_COMMENT', payload: { commentId: c } });
  assert.equal(e.doc.comments![c].resolvedBy, 'bia');
  e.run({ type: 'REPLY_COMMENT', payload: { commentId: c, text: 'Na verdade não' } });
  assert.equal(e.doc.comments![c].status, 'OPEN', 'responder reabre');
  as(ANA);
  e.run({ type: 'EDIT_COMMENT', payload: { commentId: c, text: 'Confirmar o prazo com o cliente' } });
  assert.ok(e.doc.comments![c].messages[0].editedAt);
  assert.equal((e.run({ type: 'LIST_COMMENTS', targetId: p }) as any[]).length, 1);
  assert.equal((e.run({ type: 'LIST_COMMENTS', payload: { status: 'RESOLVED' } }) as any[]).length, 0);
  e.run({ type: 'DELETE_COMMENT', payload: { commentId: c } });
  assert.equal(e.doc.comments![c], undefined);
  e.run({ type: 'UNDO' });
  assert.equal((e.doc.comments as Record<string, any>)[c].messages.length, 3);
  assert.equal(e.execute({ type: 'ADD_COMMENT', targetId: p, payload: { text: '  ' } }).ok, false);
  assert.equal(e.execute({ type: 'ADD_COMMENT', targetId: p, payload: { text: 'x', start: 5, end: 99 } }).ok, false);
});

test('comentário acompanha o texto editado e fica solto quando o elemento some', () => {
  const { e, txt } = doc();
  const p = txt('Venda de carros usados.');
  const c = e.run({ type: 'ADD_COMMENT', targetId: p, payload: { text: '?', start: 9, end: 15 } });   // "carros"
  e.run({ type: 'TEXT_INSERT', targetId: p, payload: { offset: 0, text: 'Nova ' } });
  const a = () => e.doc.comments![c].anchor;
  assert.deepEqual([a().start, a().end], [14, 20]);
  e.run({ type: 'TEXT_DELETE', targetId: p, payload: { start: 0, end: 5 } });
  assert.deepEqual([a().start, a().end], [9, 15]);
  e.run({ type: 'TEXT_DELETE', targetId: p, payload: { start: 12, end: 22 } });   // apaga "ros usados"
  assert.deepEqual([a().start, a().end], [9, 12]);
  e.run({ type: 'DELETE', targetId: p });
  assert.equal(a().detached, true);
});

test('menções avisam as pessoas citadas depois de gravar', () => {
  const { e, txt, as } = doc();
  as(ANA);
  e.run({ type: 'SHARE', payload: { userId: 'bia', name: 'Bia', role: 'COMMENTER' } });
  e.run({ type: 'SHARE', payload: { email: 'caio@x.com', name: 'Caio', role: 'EDITOR' } });
  const got: any[] = [];
  e.on('mention', (m) => got.push(m));
  const c = e.run({ type: 'ADD_COMMENT', targetId: txt('Oi'), payload: { text: '@Bia e @caio podem ver?' } });
  assert.deepEqual(got.map((m) => m.userId).sort(), ['bia', 'caio@x.com']);
  assert.deepEqual((e.run({ type: 'LIST_COMMENTS', payload: { mentioning: 'bia' } }) as any[]).map((t) => t.id), [c]);
  assert.equal(e.execute({ type: 'ADD_COMMENT', targetId: 'NADA', payload: { text: '@Bia' } }).ok, false);
  assert.equal(got.length, 2, 'operação que falha não avisa ninguém');
});

test('permissões: dono, editor, comentador, leitor, acesso por link e passar a posse', () => {
  const { e, txt, as } = doc();
  const p = txt('Texto');
  assert.equal(e.run({ type: 'MY_ROLE' }), 'OWNER', 'sem compartilhamento: uso local');
  assert.equal(e.execute({ type: 'SHARE', payload: { userId: 'bia', role: 'EDITOR' } }).ok, false, 'precisa de usuário');
  as(ANA);
  e.run({ type: 'SHARE', payload: { userId: 'bia', name: 'Bia', role: 'EDITOR' } });
  e.run({ type: 'SHARE', payload: { userId: 'caio', name: 'Caio', role: 'COMMENTER' } });
  e.run({ type: 'SHARE', payload: { userId: 'dani', name: 'Dani', role: 'VIEWER' } });

  as(BIA);
  assert.equal(e.execute({ type: 'TEXT_SET', targetId: p, payload: { text: 'editado' } }).ok, true);
  assert.equal(e.execute({ type: 'SET_PERMISSION', payload: { userId: 'caio', role: 'EDITOR' } }).error?.code, 'PERMISSION_DENIED');

  as(CAIO);
  assert.equal(e.execute({ type: 'TEXT_SET', targetId: p, payload: { text: 'x' } }).error?.code, 'PERMISSION_DENIED');
  assert.equal(e.execute({ type: 'ADD_COMMENT', targetId: p, payload: { text: 'posso comentar' } }).ok, true);
  assert.equal(e.execute({ type: 'FIND', payload: { query: 'editado' } }).ok, true, 'consultas sempre podem');

  as({ id: 'dani', name: 'Dani' });
  assert.equal(e.execute({ type: 'ADD_COMMENT', targetId: p, payload: { text: 'e eu?' } }).error?.code, 'PERMISSION_DENIED');
  as({ id: 'eva', name: 'Eva' });
  assert.equal(e.run({ type: 'MY_ROLE' }), 'NONE');
  as(ANA);
  e.run({ type: 'SET_LINK_ACCESS', payload: { access: 'COMMENTER' } });
  as({ id: 'eva', name: 'Eva' });
  assert.equal(e.run({ type: 'MY_ROLE' }), 'COMMENTER');

  as(ANA);
  e.run({ type: 'SET_PERMISSION', payload: { userId: 'bia', role: 'OWNER' } });
  assert.deepEqual([e.run({ type: 'MY_ROLE' }), (e.run({ type: 'LIST_MEMBERS' }) as any[]).find((m) => m.owner).userId], ['EDITOR', 'bia']);
  as(BIA);
  assert.equal(e.execute({ type: 'UNSHARE', payload: { userId: 'bia' } }).ok, false, 'dono não sai');
  e.run({ type: 'UNSHARE', payload: { userId: 'dani' } });
});

test('presença: quem está no documento, cor fixa, inativos somem', () => {
  const { e, as } = doc();
  as(ANA);
  let t = new Date(2026, 10, 13, 10, 0);
  e.services.now = () => t;
  e.run({ type: 'SET_PRESENCE', payload: { userId: 'bia', name: 'Bia', selection: ['TXT_1'] } });
  e.run({ type: 'SET_PRESENCE' });
  const list = e.run({ type: 'LIST_PRESENCE' }) as any[];
  assert.deepEqual(list.map((x) => [x.userId, x.selection]), [['bia', ['TXT_1']]], 'sem a própria pessoa');
  assert.match(list[0].color, /^#[0-9A-F]{6}$/);
  assert.equal(e.history.past.length, 0, 'presença não entra no histórico');
  t = new Date(2026, 10, 13, 10, 5);
  assert.equal((e.run({ type: 'LIST_PRESENCE' }) as any[]).length, 0);
});

test('controle de alterações: autor por alteração, aceitar, rejeitar sem perder o que veio depois', () => {
  const { e, txt, as, text } = doc();
  as(ANA);
  const p = txt('Versão um.');
  e.run({ type: 'SET_TRACK_CHANGES', payload: { enabled: true } });
  as(BIA);
  e.run({ type: 'TEXT_INSERT', targetId: p, payload: { offset: 9, text: ' revisada' } });
  const q = txt('Parágrafo novo.');
  as(CAIO);
  e.run({ type: 'FORMAT', targetId: p, payload: { color: '#FF0000' } });
  const ch = e.run({ type: 'LIST_CHANGES' }) as any[];
  assert.deepEqual(ch.map((c) => c.userName), ['Bia', 'Bia', 'Caio']);
  assert.deepEqual(ch[0].items[0].text, { at: 9, deleted: '', inserted: ' revisada' });
  assert.equal(ch[1].items.find((i: any) => i.nodeId === q).kind, 'INSERTED');

  e.run({ type: 'REJECT_CHANGE', payload: { changeId: ch[0].id } });
  assert.equal(text(p), 'Versão um.');
  assert.equal(e.get(p).styleOverrides.color, '#FF0000', 'a formatação do Caio, feita depois, ficou');
  e.run({ type: 'REJECT_CHANGE', payload: { changeId: ch[1].id } });
  assert.equal(e.find(q), undefined);
  assert.ok(!e.get(e.state.activeSurface!).children.includes(q));
  e.run({ type: 'ACCEPT_CHANGE', payload: { all: true } });
  assert.equal((e.run({ type: 'LIST_CHANGES' }) as any[]).length, 0);
  assert.equal(e.get(p).styleOverrides.color, '#FF0000');
  e.run({ type: 'UNDO' });
  assert.equal((e.run({ type: 'LIST_CHANGES' }) as any[]).length, 1, 'desfazer o aceite volta a marca');
});

test('mesclagem em três vias e listas de filhos', () => {
  assert.deepEqual(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 }).value, { a: 2, b: 3 });
  const m = merge3({ a: 1 }, { a: 2 }, { a: 3 });
  assert.deepEqual([m.value, m.conflicts], [{ a: 3 }, ['a']]);
  assert.deepEqual(mergeList(['x', 'y'], ['x', 'm', 'y'], ['x', 'y', 't']), ['x', 'm', 'y', 't']);
  assert.deepEqual(mergeList(['x', 'y', 'z'], ['x', 'z'], ['x', 'y', 'z', 't']), ['x', 'z', 't']);
});

test('edição simultânea: dois editores, sem eco, campos diferentes se juntam, desfazer não apaga o outro', () => {
  const base = createDocument();
  const a = createEngine(structuredClone(base)), b = createEngine(structuredClone(base));
  a.user = { id: 'ana', name: 'Ana' }; b.user = { id: 'bia', name: 'Bia' };
  const sa = new SyncSession(a), sb = new SyncSession(b);
  const blk = a.state.activeSurface!;
  const t = a.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data: { text: 'Olá' } } }).id;
  sb.receive(sa.drain());
  assert.equal(b.get(t).data.runs[0].text, 'Olá');
  assert.equal(b.history.past.length, 0, 'o que veio de fora não entra no desfazer local');
  assert.equal(sb.drain().length, 0, 'sem eco');

  a.run({ type: 'FORMAT', targetId: t, payload: { color: '#FF0000' } });
  b.run({ type: 'FORMAT', targetId: t, payload: { fontSize: 20 } });
  const fromA = sa.drain(), fromB = sb.drain();
  sb.receive(fromA); sa.receive(fromB);
  assert.deepEqual(a.get(t).styleOverrides, { color: '#FF0000', fontSize: 20 });
  assert.deepEqual(b.get(t).styleOverrides, a.get(t).styleOverrides, 'os dois chegam no mesmo estado');

  const t2 = b.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data: { text: 'da Bia' } } }).id;
  const t3 = a.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data: { text: 'da Ana' } } }).id;
  sa.receive(sb.drain()); sb.receive(sa.drain());
  assert.ok([t2, t3].every((id) => a.get(blk).children.includes(id) && b.get(blk).children.includes(id)), 'inserções simultâneas no mesmo pai');

  a.run({ type: 'UNDO' });   // Ana desfaz a inserção dela
  assert.ok(a.get(blk).children.includes(t2), 'desfazer não apaga o parágrafo da Bia');
  assert.equal(a.find(t3), undefined);
  sb.receive(sa.drain());
  assert.equal(b.find(t3), undefined);
  assert.deepEqual(b.get(blk).children, a.get(blk).children);
  const r = sa.receive([{ id: 'x', changes: [] }]);
  assert.equal(r.applied, 1);
  assert.equal(sa.receive([{ id: 'x', changes: [] }]).applied, 0, 'a mesma transação não é aplicada duas vezes');
});
