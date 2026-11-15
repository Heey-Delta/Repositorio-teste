// Volumes no admin: criar, editar, ordenar artigos, publicar e excluir.
// Publicar (ou tirar do ar) atualiza o vetor da busca e gera o site de novo (sitemap e llms.txt listam os volumes).
import { z } from 'astro/zod';
import { and, asc, desc, eq, ne, inArray } from 'drizzle-orm';
import { db, schema as s } from '../db/client';
import { SaveError, slugify } from './posts';
import { triggerRebuild } from './rebuild';
import { refreshVolumeVector } from './search-index';

export const volumeInput = z.object({
  title: z.string().trim().min(1, 'Dê um título ao volume.').max(140),
  slug: z.string().trim().max(100).transform((v) => slugify(v)),
  summary: z.string().trim().max(400).default(''),
  coverMediaId: z.uuid().nullable().default(null),
  status: z.enum(['draft', 'published']),
  sortOrder: z.number().int().min(0).max(999).default(0),
  postIds: z.array(z.uuid()).max(100).default([]),
  experienceUrl: z.string().trim().max(500).default('').refine((v) => !v || /^(https?:\/\/|\/)/.test(v), 'O link da experiência precisa começar com https:// ou /.'),
  experienceLabel: z.string().trim().max(60).default(''),
});
export type VolumeInput = z.infer<typeof volumeInput>;

export async function listVolumesAdmin() {
  const vols = await db().select({ v: s.volumes, coverUrl: s.media.url }).from(s.volumes).leftJoin(s.media, eq(s.media.id, s.volumes.coverMediaId)).orderBy(asc(s.volumes.sortOrder), desc(s.volumes.updatedAt));
  const links = vols.length ? await db().select({ volumeId: s.volumePosts.volumeId }).from(s.volumePosts).where(inArray(s.volumePosts.volumeId, vols.map((x) => x.v.id))) : [];
  return vols.map(({ v, coverUrl }) => ({ ...v, coverUrl, count: links.filter((l) => l.volumeId === v.id).length }));
}

export async function loadVolume(id: string) {
  const [v] = await db().select().from(s.volumes).where(eq(s.volumes.id, id));
  if (!v) return null;
  const posts = await db().select({ postId: s.volumePosts.postId }).from(s.volumePosts).where(eq(s.volumePosts.volumeId, id)).orderBy(asc(s.volumePosts.sortOrder));
  return { ...v, postIds: posts.map((p) => p.postId) };
}

export async function saveVolume(id: string | null, raw: unknown, login: string) {
  const input = volumeInput.parse(raw);
  const slug = input.slug || slugify(input.title);
  if (!slug) throw new SaveError('O endereço precisa ter letras ou números.', 'slug');
  const [taken] = await db().select({ id: s.volumes.id }).from(s.volumes).where(id ? and(eq(s.volumes.slug, slug), ne(s.volumes.id, id)) : eq(s.volumes.slug, slug));
  if (taken) throw new SaveError('Já existe um volume com esse endereço.', 'slug');
  const postIds = [...new Set(input.postIds)];
  if (postIds.length) {
    const found = await db().select({ id: s.posts.id }).from(s.posts).where(inArray(s.posts.id, postIds));
    if (found.length !== postIds.length) throw new SaveError('Um dos artigos não existe mais. Tire da lista e salve de novo.', 'postIds');
  }
  if (input.coverMediaId) {
    const [m] = await db().select({ kind: s.media.kind }).from(s.media).where(eq(s.media.id, input.coverMediaId));
    if (m?.kind !== 'image') throw new SaveError('A capa precisa ser uma imagem da biblioteca.', 'coverMediaId');
  }
  const now = new Date();
  let wasPublished = false;
  let publishedAt: Date | null = null;
  if (id) {
    const [cur] = await db().select({ status: s.volumes.status, publishedAt: s.volumes.publishedAt }).from(s.volumes).where(eq(s.volumes.id, id));
    if (!cur) throw new SaveError('Volume não encontrado.', undefined, 404);
    wasPublished = cur.status === 'published';
    publishedAt = cur.publishedAt;
  }
  if (input.status === 'published' && !publishedAt) publishedAt = now;
  const values = { title: input.title, slug, summary: input.summary, coverMediaId: input.coverMediaId, status: input.status, sortOrder: input.sortOrder, experienceUrl: input.experienceUrl, experienceLabel: input.experienceLabel, publishedAt, updatedAt: now };
  const isNew = !id;
  if (!id) id = crypto.randomUUID();
  await db().batch([
    isNew ? db().insert(s.volumes).values({ ...values, id, createdAt: now }) : db().update(s.volumes).set(values).where(eq(s.volumes.id, id)),
    db().delete(s.volumePosts).where(eq(s.volumePosts.volumeId, id)),
    postIds.length ? db().insert(s.volumePosts).values(postIds.map((postId, sortOrder) => ({ volumeId: id!, postId, sortOrder }))) : db().select({ x: s.volumes.id }).from(s.volumes).limit(0),
    db().insert(s.adminLog).values({ login, action: isNew ? 'volume.create' : 'volume.save', target: id }),
  ]);
  await refreshVolumeVector(db(), id);
  const site = wasPublished || input.status === 'published' ? await triggerRebuild(login, `volume ${slug}`) : null;
  return { id, slug, updatedAt: now.toISOString(), site };
}

export async function deleteVolume(id: string, login: string) {
  const [cur] = await db().select({ status: s.volumes.status, slug: s.volumes.slug }).from(s.volumes).where(eq(s.volumes.id, id));
  if (!cur) throw new SaveError('Volume não encontrado.', undefined, 404);
  await db().delete(s.volumes).where(eq(s.volumes.id, id));
  await db().delete(s.searchVectors).where(and(eq(s.searchVectors.kind, 'volume'), eq(s.searchVectors.refId, id)));
  await db().insert(s.adminLog).values({ login, action: 'volume.delete', target: cur.slug });
  return { site: cur.status === 'published' ? await triggerRebuild(login, `volume ${cur.slug} excluído`) : null };
}
