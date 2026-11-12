// Roda antes do `astro build`: aplica as migrações de drizzle/ e faz a carga inicial do banco.
// A carga é idempotente: departamentos, assuntos, tipos de conteúdo e o autor entram só se faltarem.
// Sem DATABASE_URL (build local ou do artefato) o script só avisa e sai. Os previews do Vercel usam o mesmo banco,
// então só o build de produção mexe nele: assim dois builds nunca migram ao mesmo tempo.
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import * as s from '../src/db/schema.ts';
import { departments, areas } from '../src/lab/data.ts';

const url = process.env.DATABASE_URL;
if (!url || (process.env.VERCEL && process.env.VERCEL_ENV !== 'production')) {
  console.log('[db] fora do build de produção: migrações e carga inicial puladas.');
  process.exit(0);
}
const db = drizzle(neon(url), { schema: s });

await migrate(db, { migrationsFolder: 'drizzle' });
console.log('[db] migrações aplicadas');

const slugify = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

await db.insert(s.departments)
  .values(departments.map((d, i) => ({ slug: d.slug, code: d.code, name: d.name, short: d.short, about: d.about, icon: d.icon, sortOrder: i })))
  .onConflictDoNothing();
await db.insert(s.areas).values(areas.map((a) => ({ slug: slugify(a.name), name: a.name, about: a.about }))).onConflictDoNothing();
const types = ['Artigo', 'Apresentação', 'Documento técnico', 'Relatório', 'Estudo de caso', 'Pesquisa', 'Experimento', 'Ensaio visual', 'Nota', 'Projeto documentado'];
await db.insert(s.contentTypes).values(types.map((name) => ({ slug: slugify(name), name }))).onConflictDoNothing();
const githubId = Number(process.env.ADMIN_GITHUB_ID) || null;
await db.insert(s.authors).values({ slug: 'hallan', name: 'Hallan', githubId, sameAs: ['https://hallan-dante.vercel.app/'] }).onConflictDoNothing();
console.log('[db] catálogos conferidos');
