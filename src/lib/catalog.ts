// Catálogo do Lab (spec 5.3): descrições dos departamentos, assuntos e tags.
// O endereço e o código de cada departamento ficam fixos (mudariam as URLs); o resto é editável e vai para o site.
import { z } from 'astro/zod';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import { db, schema as s } from '../db/client';
import { SaveError, slugify } from './posts';
import { triggerRebuild } from './rebuild';

export async function getCatalog() {
  const [deps, areas, tags, areaUse, tagUse] = await Promise.all([
    db().select().from(s.departments).orderBy(asc(s.departments.sortOrder)),
    db().select().from(s.areas).orderBy(asc(s.areas.id)),
    db().select().from(s.tags).orderBy(asc(s.tags.name)),
    db().select({ id: s.postAreas.areaId, n: count() }).from(s.postAreas).groupBy(s.postAreas.areaId),
    db().select({ id: s.postTags.tagId, n: count() }).from(s.postTags).groupBy(s.postTags.tagId),
  ]);
  const a = new Map(areaUse.map((r) => [r.id, r.n])), t = new Map(tagUse.map((r) => [r.id, r.n]));
  return {
    departments: deps,
    areas: areas.map((x) => ({ ...x, uses: a.get(x.id) ?? 0 })),
    tags: tags.map((x) => ({ ...x, uses: t.get(x.id) ?? 0 })),
  };
}

const text = (max: number) => z.string().trim().max(max);
export const catalogAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('department.update'), id: z.number().int(), short: text(140).min(3, 'Escreva a frase curta.'), about: text(500).min(10, 'Escreva a descrição.') }),
  z.object({ action: z.literal('area.create'), name: text(60).min(2, 'Dê um nome ao assunto.'), about: text(200) }),
  z.object({ action: z.literal('area.update'), id: z.number().int(), name: text(60).min(2, 'Dê um nome ao assunto.'), about: text(200) }),
  z.object({ action: z.literal('area.delete'), id: z.number().int() }),
  z.object({ action: z.literal('tag.update'), id: z.number().int(), name: text(40).min(1, 'Dê um nome à tag.') }),
  z.object({ action: z.literal('tag.merge'), ids: z.array(z.number().int()).min(2, 'Marque ao menos duas tags.').max(50), into: z.number().int() }),
  z.object({ action: z.literal('tag.delete'), id: z.number().int() }),
]);
export type CatalogAction = z.infer<typeof catalogAction>;

export async function applyCatalog(a: CatalogAction, login: string) {
  switch (a.action) {
    case 'department.update':
      await db().update(s.departments).set({ short: a.short, about: a.about }).where(eq(s.departments.id, a.id));
      break;
    case 'area.create':
    case 'area.update': {
      const slug = slugify(a.name);
      const id = a.action === 'area.update' ? a.id : -1;
      const [clash] = await db().select({ id: s.areas.id }).from(s.areas).where(and(eq(s.areas.slug, slug), ne(s.areas.id, id)));
      if (clash) throw new SaveError('Já existe um assunto com esse nome.', 'name', 409);
      if (a.action === 'area.create') await db().insert(s.areas).values({ slug, name: a.name, about: a.about });
      else await db().update(s.areas).set({ slug, name: a.name, about: a.about }).where(eq(s.areas.id, a.id));
      break;
    }
    case 'area.delete': {
      const [{ n }] = await db().select({ n: count() }).from(s.postAreas).where(eq(s.postAreas.areaId, a.id));
      if (n > 0) throw new SaveError(`Esse assunto está em ${n} ${n === 1 ? 'publicação' : 'publicações'}. Tire de lá antes de excluir.`, undefined, 409);
      await db().delete(s.areas).where(eq(s.areas.id, a.id));
      break;
    }
    case 'tag.update': {
      const slug = slugify(a.name);
      if (!slug) throw new SaveError('Use letras ou números no nome da tag.', 'name');
      const [clash] = await db().select({ id: s.tags.id, name: s.tags.name }).from(s.tags).where(and(eq(s.tags.slug, slug), ne(s.tags.id, a.id)));
      if (clash) throw new SaveError(`Já existe a tag "${clash.name}". Para unir as duas, use "Juntar".`, 'name', 409);
      await db().update(s.tags).set({ slug, name: a.name }).where(eq(s.tags.id, a.id));
      break;
    }
    case 'tag.merge': {
      if (!a.ids.includes(a.into)) throw new SaveError('Escolha, entre as marcadas, a tag que vai ficar.');
      const others = a.ids.filter((id) => id !== a.into);
      // publicações que tinham qualquer uma das tags passam a ter só a que fica
      const posts = await db().select({ postId: s.postTags.postId }).from(s.postTags).where(inArray(s.postTags.tagId, others));
      await db().batch([
        db().delete(s.postTags).where(inArray(s.postTags.tagId, others)),
        posts.length ? db().insert(s.postTags).values([...new Set(posts.map((p) => p.postId))].map((postId) => ({ postId, tagId: a.into }))).onConflictDoNothing()
          : db().select({ x: s.tags.id }).from(s.tags).limit(0),
        db().delete(s.tags).where(inArray(s.tags.id, others)),
      ]);
      break;
    }
    case 'tag.delete': {
      const [{ n }] = await db().select({ n: count() }).from(s.postTags).where(eq(s.postTags.tagId, a.id));
      if (n > 0) throw new SaveError(`Essa tag está em ${n} ${n === 1 ? 'publicação' : 'publicações'}. Use "Juntar" ou tire das publicações antes.`, undefined, 409);
      await db().delete(s.tags).where(eq(s.tags.id, a.id));
      break;
    }
  }
  await db().insert(s.adminLog).values({ login, action: `catalog.${a.action}`, target: 'id' in a ? String(a.id) : a.action === 'tag.merge' ? a.ids.join(',') : a.name });
  return { site: await triggerRebuild(login, `catálogo: ${a.action}`) };
}
