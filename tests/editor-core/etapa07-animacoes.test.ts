// Etapa 07: animações (entrada, ênfase, saída, trajetória), sequência, gatilhos, transições e reprodução.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, motionPath } from '../../src/editor-core/index.ts';

function slide() {
  const e = createEngine(createDocument('PRESENTATION_EDITOR'));
  const s = e.state.activeSurface!;
  const shape = (x = 0) => e.run({ type: 'CREATE', payload: { parentId: s, nodeType: 'SHAPE', data: { shapeType: 'RECTANGLE' }, layout: { mode: 'ABSOLUTE', x, y: 0, width: 50, height: 50 } } }).id as string;
  const anim = (target: string, p: any) => e.run({ type: 'ADD_ANIMATION', targetId: target, payload: p }) as string;
  return { e, s, shape, anim };
}

test('linha do tempo: ao clicar, com a anterior, após a anterior, atraso e repetição', () => {
  const { e, s, shape, anim } = slide();
  const a = shape(0), b = shape(60), c = shape(120);
  const t1 = anim(a, { kind: 'ENTRANCE', effect: 'FADE', duration: 500 });
  const t2 = anim(b, { kind: 'ENTRANCE', effect: 'FLY_IN', duration: 400, trigger: 'WITH_PREVIOUS', delay: 100 });
  const t3 = anim(c, { kind: 'EMPHASIS', effect: 'PULSE', duration: 300, trigger: 'AFTER_PREVIOUS', repeat: 2 });
  const t4 = anim(a, { kind: 'EXIT', effect: 'DISAPPEAR' });
  const tl = e.run({ type: 'ANIMATION_TIMELINE', targetId: s }) as any;
  assert.equal(tl.clicks, 2);
  assert.equal(tl.steps[0].trigger, 'AUTO');
  assert.equal(tl.steps[0].items.length, 0, 'a 1ª espera clique: passo automático vazio');
  assert.deepEqual(tl.steps[1].items.map((i: any) => [i.animationId, i.start, i.end]), [[t1, 0, 500], [t2, 100, 500], [t3, 500, 1100]]);
  assert.equal(tl.steps[1].duration, 1100);
  assert.deepEqual(tl.steps[2].items.map((i: any) => [i.animationId, i.end]), [[t4, 0]], 'desaparecer é instantâneo');
  assert.equal((e.run({ type: 'LIST_ANIMATIONS', targetId: b }) as any[])[0].direction, 'LEFT', 'direção padrão');
});

test('estado por passo: entrada começa escondida, saída esconde', () => {
  const { e, s, shape, anim } = slide();
  const a = shape(0), b = shape(60), c = shape(120);
  anim(a, { kind: 'ENTRANCE', effect: 'APPEAR', trigger: 'AFTER_PREVIOUS' });
  anim(b, { kind: 'ENTRANCE', effect: 'ZOOM' });
  anim(c, { kind: 'EXIT', effect: 'FADE' });
  const st = (step: number) => e.run({ type: 'ANIMATION_STATE', targetId: s, payload: { step } }) as any;
  assert.deepEqual(st(0).hidden, [b], 'a entra sozinho ao abrir o slide');
  assert.deepEqual(st(1).hidden, []);
  assert.deepEqual(st(2).hidden, [c]);
  assert.equal(st(2).done, true);
});

test('sequência: reordenar, editar, remover e gatilho por objeto', () => {
  const { e, s, shape, anim } = slide();
  const a = shape(0), b = shape(60), btn = shape(200);
  const x = anim(a, { kind: 'ENTRANCE', effect: 'FADE' });
  const y = anim(b, { kind: 'ENTRANCE', effect: 'FADE' });
  e.run({ type: 'REORDER_ANIMATION', payload: { animationId: y, newIndex: 0 } });
  assert.deepEqual((e.run({ type: 'LIST_ANIMATIONS', targetId: s }) as any[]).map((q) => q.id), [y, x]);
  e.run({ type: 'UPDATE_ANIMATION', payload: { animationId: x, trigger: 'ON_OBJECT_CLICK', triggerId: btn, duration: 1000 } });
  const tl = e.run({ type: 'ANIMATION_TIMELINE', targetId: s }) as any;
  assert.equal(tl.clicks, 1, 'x saiu da sequência principal');
  assert.equal(tl.interactive[0].triggerId, btn);
  assert.equal(tl.interactive[0].steps[0].items[0].end, 1000);
  e.run({ type: 'UPDATE_ANIMATION', payload: { animationId: x, kind: 'EMPHASIS' } });
  assert.equal((e.run({ type: 'LIST_ANIMATIONS', targetId: a }) as any[])[0].effect, 'PULSE', 'troca de tipo escolhe um efeito válido');
  e.run({ type: 'REMOVE_ANIMATION', payload: { animationId: y } });
  assert.equal((e.run({ type: 'LIST_ANIMATIONS', targetId: s }) as any[]).length, 1);
  e.run({ type: 'UNDO' });
  assert.equal((e.run({ type: 'LIST_ANIMATIONS', targetId: s }) as any[]).length, 2);
});

test('validação', () => {
  const { e, shape } = slide();
  const a = shape(0), b = shape(60);
  const bad = (p: any) => assert.equal(e.execute({ type: 'ADD_ANIMATION', targetId: a, payload: p }).ok, false, JSON.stringify(p));
  bad({ kind: 'ENTRANCE', effect: 'SPIN' });
  bad({ kind: 'DANCE', effect: 'FADE' });
  bad({ kind: 'ENTRANCE', effect: 'FADE', duration: -1 });
  bad({ kind: 'ENTRANCE', effect: 'FADE', trigger: 'ON_OBJECT_CLICK' });
  bad({ kind: 'EMPHASIS', effect: 'COLOR_CHANGE' });
  bad({ kind: 'MOTION_PATH', effect: 'CUSTOM', path: [{ x: 0, y: 0 }] });
  bad({ kind: 'ENTRANCE', effect: 'FADE', direction: 'NORTE' });
  assert.equal(e.execute({ type: 'ADD_ANIMATION', targetId: a, payload: { kind: 'ENTRANCE', effect: 'FADE', trigger: 'ON_OBJECT_CLICK', triggerId: b } }).ok, true);
  const doc = createEngine(createDocument());
  const t = doc.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', data: { text: 'oi' } } }).id;
  assert.match(doc.execute({ type: 'ADD_ANIMATION', targetId: t, payload: { kind: 'ENTRANCE', effect: 'FADE' } }).error!.message, /slides/);
});

test('trajetórias de movimento', () => {
  const { e, shape, anim } = slide();
  const a = shape(0);
  const id = anim(a, { kind: 'MOTION_PATH', effect: 'LINE', direction: 'DOWN' });
  const m = (e.run({ type: 'LIST_ANIMATIONS', targetId: a }) as any[]).find((x) => x.id === id);
  assert.deepEqual(motionPath(m), [{ x: 0, y: 0 }, { x: 0, y: 200 }]);
  assert.equal(motionPath({ ...m, effect: 'CIRCLE' }).length, 13);
  assert.deepEqual(motionPath({ ...m, effect: 'CUSTOM', path: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }), [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
});

test('transições: por slide, em todos, avanço automático e remoção', () => {
  const { e, s } = slide();
  const s2 = e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SLIDE' } }) as string;
  e.run({ type: 'SET_TRANSITION', targetId: s, payload: { effect: 'PUSH', duration: 900, advanceAfter: 5000 } });
  assert.deepEqual(e.get(s).data.transition, { effect: 'PUSH', duration: 900, direction: 'LEFT', advanceAfter: 5000 });
  e.run({ type: 'SET_TRANSITION', payload: { effect: 'FADE', all: true } });
  assert.deepEqual([e.get(s).data.transition.effect, e.get(s2).data.transition.effect], ['FADE', 'FADE']);
  e.run({ type: 'SET_TRANSITION', targetId: s2, payload: { effect: null } });
  assert.equal(e.get(s2).data.transition, null);
  assert.equal(e.execute({ type: 'SET_TRANSITION', targetId: s, payload: { effect: 'EXPLODIR' } }).ok, false);
});

test('apagar o elemento leva as animações; duplicar o slide copia com IDs próprios', () => {
  const { e, s, shape, anim } = slide();
  const a = shape(0), btn = shape(100);
  anim(a, { kind: 'ENTRANCE', effect: 'FADE' });
  anim(btn, { kind: 'EMPHASIS', effect: 'SPIN' });
  anim(a, { kind: 'EXIT', effect: 'FADE', trigger: 'ON_OBJECT_CLICK', triggerId: btn });
  const [dup] = e.run({ type: 'DUPLICATE', targetId: s }) as string[];
  const anims = e.get(dup).data.animations;
  assert.equal(anims.length, 3);
  assert.ok(anims.every((x: any) => !e.get(s).data.animations.some((y: any) => y.id === x.id)), 'IDs novos');
  assert.ok(anims.every((x: any) => e.get(dup).children.includes(x.targetId)), 'apontam para as cópias');
  e.run({ type: 'DELETE', targetId: btn });
  const left = e.get(s).data.animations;
  assert.equal(left.length, 2);
  assert.equal(left[1].trigger, 'ON_CLICK', 'gatilho apagado vira ao clicar');
  e.run({ type: 'DELETE', targetId: a });
  assert.equal(e.get(s).data.animations.length, 0);
});
