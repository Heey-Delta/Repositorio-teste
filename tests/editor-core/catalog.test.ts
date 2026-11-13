// O catálogo precisa bater com o motor: o que está pronto tem operações registradas de verdade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument } from '../../src/editor-core/index.ts';
import { CATEGORIES, FEATURES } from '../../src/editor-core/catalog.ts';

const engine = createEngine(createDocument());

test('catálogo: IDs únicos, 18 categorias, dependências existentes', () => {
  const ids = FEATURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...new Set(FEATURES.map((f) => f.category))].sort((a, b) => a - b), Object.keys(CATEGORIES).map(Number));
  for (const f of FEATURES) for (const d of f.deps ?? []) assert.ok(ids.includes(d), `${f.id} depende de ${d}, que não existe`);
});

test('catálogo: toda funcionalidade pronta aponta para operações existentes', () => {
  const missing = FEATURES.filter((f) => f.status === 'DONE').flatMap((f) => f.ops.filter((o) => !engine.has(o)).map((o) => `${f.id} ${f.name}: ${o}`));
  assert.deepEqual(missing, []);
});

test('catálogo: o que está a fazer ainda não foi marcado por engano (aviso de operações já existentes)', () => {
  const ready = FEATURES.filter((f) => f.status === 'TODO' && f.ops.every((o) => engine.has(o))).map((f) => f.id);
  assert.deepEqual(ready, [], `Já têm todas as operações; revise a situação: ${ready.join(', ')}`);
});
