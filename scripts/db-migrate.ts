// Roda antes do `astro build`: aplica as migrações de drizzle/ e faz a carga inicial do banco.
// A carga é idempotente: catálogos entram só se faltarem, e as publicações de src/content/lab só se o banco estiver vazio.
// Sem DATABASE_URL (build local ou do artefato) o script só avisa e sai. Os previews do Vercel usam o mesmo banco,
// então só o build de produção mexe nele: assim dois builds nunca migram ao mesmo tempo.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { count, eq } from 'drizzle-orm';
import { parse } from 'yaml';
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

const [{ n }] = await db.select({ n: count() }).from(s.posts);
if (n > 0) {
  console.log(`[db] ${n} publicações no banco: carga de exemplos pulada.`);
  process.exit(0);
}

// Publicações atuais (src/content/lab/<departamento>/<slug>.md) viram linhas do banco
const deps = new Map((await db.select().from(s.departments)).map((d) => [d.slug, d.id]));
const areaIds = new Map((await db.select().from(s.areas)).map((a) => [a.name, a.id]));
const typeIds = new Map((await db.select().from(s.contentTypes)).map((t) => [t.slug, t.id]));
const [author] = await db.select().from(s.authors).where(eq(s.authors.slug, 'hallan'));
const typeByDepartment: Record<string, string> = {
  experiments: 'experimento', 'field-notes': 'artigo', research: 'pesquisa', 'visual-archive': 'ensaio-visual', 'open-lab': 'projeto-documentado', observatory: 'nota',
};

const base = 'src/content/lab';
const byCode = new Map<string, string>();
const pending: { id: string; related: string[] }[] = [];
for (const dep of readdirSync(base)) {
  for (const file of readdirSync(join(base, dep)).filter((f) => f.endsWith('.md'))) {
    const raw = readFileSync(join(base, dep, file), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) continue;
    const fm = parse(m[1]);
    const body = m[2].trim();
    const words = body.split(/\s+/).filter(Boolean).length;
    const [post] = await db.insert(s.posts).values({
      code: fm.code, slug: file.replace(/\.md$/, ''), title: fm.title,
      departmentId: deps.get(fm.department)!, contentTypeId: typeIds.get(typeByDepartment[fm.department]) ?? null, authorId: author.id,
      summary: fm.description ?? '', body, status: fm.draft ? 'draft' : 'published', stage: fm.status ?? 'concept',
      level: fm.level ?? 'Introdutório', format: fm.format ?? null, readingMinutes: Math.max(1, Math.ceil(words / 200)),
      createdAt: new Date(fm.date), updatedAt: new Date(fm.updated ?? fm.date), publishedAt: fm.draft ? null : new Date(fm.date),
    }).returning({ id: s.posts.id });
    byCode.set(fm.code, post.id);
    pending.push({ id: post.id, related: fm.related ?? [] });

    const postAreaIds = (fm.areas ?? []).map((a: string) => areaIds.get(a)).filter(Boolean) as number[];
    if (postAreaIds.length) await db.insert(s.postAreas).values(postAreaIds.map((areaId) => ({ postId: post.id, areaId })));
    for (const name of fm.tags ?? []) {
      const [tag] = await db.insert(s.tags).values({ slug: slugify(name), name }).onConflictDoUpdate({ target: s.tags.slug, set: { name } }).returning();
      await db.insert(s.postTags).values({ postId: post.id, tagId: tag.id }).onConflictDoNothing();
    }
    for (const [i, r] of (fm.references ?? []).entries()) {
      const [ref] = await db.insert(s.references).values({ title: r.title, url: r.url ?? null }).returning();
      await db.insert(s.postReferences).values({ postId: post.id, referenceId: ref.id, sortOrder: i });
    }
    await db.insert(s.seoMetadata).values({ postId: post.id, noindex: Boolean(fm.draft) });
  }
}
for (const p of pending) {
  const rel = p.related.map((c) => byCode.get(c)).filter((id): id is string => Boolean(id) && id !== p.id);
  if (rel.length) await db.insert(s.postRelations).values(rel.map((toPostId) => ({ fromPostId: p.id, toPostId }))).onConflictDoNothing();
}
console.log(`[db] ${pending.length} publicações de exemplo carregadas`);
