// Roda antes do `astro build`: aplica as migrações de drizzle/ e faz a carga inicial do banco.
// A carga é idempotente: departamentos, assuntos, tipos de conteúdo e o autor entram só se faltarem.
// Sem DATABASE_URL (build local ou do artefato) o script só avisa e sai. Os previews do Vercel usam o mesmo banco,
// então só o build de produção mexe nele: assim dois builds nunca migram ao mesmo tempo.
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import * as s from '../src/db/schema.ts';
import { departments, areas } from '../src/lab/data.ts';
import { refreshAllVectors } from '../src/lib/search-index.ts';
import { refsFromList } from '../src/lib/refs.ts';
import { eq } from 'drizzle-orm';

const url = process.env.DATABASE_URL;
if (!url || (process.env.VERCEL && process.env.VERCEL_ENV !== 'production')) {
  console.log('[db] fora do build de produção: migrações e carga inicial puladas.');
  process.exit(0);
}
// DB_DRIVER=pg: Postgres local (testes); no Vercel, sempre o Neon por HTTP
const local = process.env.DB_DRIVER === 'pg';
const db: any = local
  ? (await import('drizzle-orm/node-postgres')).drizzle(url, { schema: s })
  : drizzle(neon(url), { schema: s });

await (local ? (await import('drizzle-orm/node-postgres/migrator')).migrate : migrate)(db, { migrationsFolder: 'drizzle' });
console.log('[db] migrações aplicadas');

const slugify = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

await db.insert(s.departments)
  .values(departments.map((d, i) => ({ slug: d.slug, code: d.code, name: d.name, short: d.short, about: d.about, icon: d.icon, sortOrder: i })))
  .onConflictDoNothing();
await db.insert(s.areas).values(areas.map((a) => ({ slug: slugify(a.name), name: a.name, about: a.about }))).onConflictDoNothing();
const types = ['Artigo', 'Apresentação', 'Documento técnico', 'Relatório', 'Estudo de caso', 'Pesquisa', 'Experimento', 'Ensaio visual', 'Nota', 'Projeto documentado'];
await db.insert(s.contentTypes).values(types.map((name) => ({ slug: slugify(name), name }))).onConflictDoNothing();
const githubId = Number(process.env.ADMIN_GITHUB_ID) || null;
await db.insert(s.authors).values({
  slug: 'hallan', name: 'Hallan', githubId, sameAs: ['https://hallan-dante.vercel.app/'], jobTitle: 'Designer e desenvolvedor de sites',
  specialties: ['Design de interfaces', 'Desenvolvimento web', 'Experiências 3D na web', 'Percepção visual'],
}).onConflictDoNothing();
console.log('[db] catálogos conferidos');

// referências: a seção "## Referências" em lista numerada (formato antigo) vira marcadores :::ref (idempotente)
try {
  const all = await db.select({ id: s.posts.id, body: s.posts.body }).from(s.posts);
  let n = 0;
  for (const p of all) { const next = refsFromList(p.body ?? ''); if (next) { await db.update(s.posts).set({ body: next }).where(eq(s.posts.id, p.id)); n++; } }
  if (n) console.log(`[db] referências convertidas para o marcador ref em ${n} publicação(ões)`);
} catch (err) { console.warn('[db] referências não convertidas:', (err as Error).message); }

// busca por significado: recalcula os vetores do que mudou desde o último build (sem gateway, só avisa)
try {
  const r = await refreshAllVectors(db);
  console.log(r.updated === null ? '[busca] AI Gateway indisponível: vetores não atualizados (a busca usa palavras e tags)' : `[busca] ${r.total} itens, ${r.updated} vetores novos, ${r.removed} removidos`);
} catch (err) { console.warn('[busca] vetores não atualizados:', (err as Error).message); }
if (local) await db.$client.end();
