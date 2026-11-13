// Gera docs/editor/CATALOGO.md a partir de src/editor-core/catalog.ts (npm run catalog:editor).
import { writeFileSync } from 'node:fs';
import { CATEGORIES, ENGINES, FEATURES, summary } from '../src/editor-core/catalog.ts';

const icon = { DONE: '✅', PARTIAL: '🟡', TODO: '⬜' } as const;
const s = summary();
const lines: string[] = [
  '# Catálogo de funcionalidades do editor',
  '',
  '> Gerado de `src/editor-core/catalog.ts` com `npm run catalog:editor`. Não edite à mão.',
  '',
  `**${s.total} funcionalidades** · ✅ ${s.done} prontas · 🟡 ${s.partial} parciais · ⬜ ${s.todo} a fazer`,
  '',
  '## Resumo por categoria',
  '',
  '| ID | Categoria | Responsabilidade | ✅ | 🟡 | ⬜ |',
  '| --- | --- | --- | --- | --- | --- |',
];
for (const [n, c] of Object.entries(CATEGORIES)) {
  const fs = FEATURES.filter((f) => f.category === Number(n));
  const k = (st: string) => fs.filter((f) => f.status === st).length;
  lines.push(`| ${n.padStart(2, '0')} | ${c.name} | ${c.responsibility} | ${k('DONE')} | ${k('PARTIAL')} | ${k('TODO')} |`);
}
lines.push('', '## Motores', '', '| Motor | Camada | Funcionalidades |', '| --- | --- | --- |');
for (const [id, eng] of Object.entries(ENGINES)) {
  const n = FEATURES.filter((f) => f.engine === id).length;
  if (n) lines.push(`| ${eng.name} (\`${id}\`) | ${eng.layer} | ${n} |`);
}
for (const [n, c] of Object.entries(CATEGORIES)) {
  lines.push('', `## ${n.padStart(2, '0')}. ${c.name}`, '', '| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |', '| --- | --- | --- | --- | --- | --- | --- |');
  let group: string | undefined;
  for (const f of FEATURES.filter((x) => x.category === Number(n))) {
    if (f.group && f.group !== group) { group = f.group; lines.push(`| | | **${group}** | | | | |`); }
    const note = [f.description, f.deps?.length ? `Depende de ${f.deps.join(', ')}.` : '', f.note ?? ''].filter(Boolean).join(' ');
    lines.push(`| ${icon[f.status]} | ${f.id} | ${f.name} | ${f.engine} | ${f.ops.map((o) => `\`${o}\``).join(' ')} | ${(f.params ?? '').replace(/\|/g, '\\|')} | ${note.replace(/\|/g, '\\|')} |`);
  }
}
writeFileSync(new URL('../docs/editor/CATALOGO.md', import.meta.url), lines.join('\n') + '\n');
console.log(`CATALOGO.md: ${s.total} funcionalidades (${s.done} prontas, ${s.partial} parciais, ${s.todo} a fazer)`);
