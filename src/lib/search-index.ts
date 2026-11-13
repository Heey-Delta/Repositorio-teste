// Mantém os vetores da busca em dia: publicações no ar e volumes publicados. Roda ao salvar (publicação ou volume)
// e no build de produção (scripts/db-migrate.ts), que recalcula só o que mudou (hash do texto).
import { and, asc, eq, inArray, lte, or } from 'drizzle-orm';
import * as s from '../db/schema.ts';
import { postText, removeVectors, upsertVectors, volumeText } from './embeddings.ts';

type AnyDb = any;
const liveFilter = (now = new Date()) => or(eq(s.posts.status, 'published'), and(eq(s.posts.status, 'scheduled'), lte(s.posts.scheduledAt, now)));

/** Textos de busca das publicações no ar (todas ou só as indicadas). */
async function postItems(db: AnyDb, ids?: string[]) {
  const where = ids ? and(liveFilter(), inArray(s.posts.id, ids)) : liveFilter();
  const rows = await db.select({ id: s.posts.id, title: s.posts.title, summary: s.posts.summary, body: s.posts.body, dep: s.departments.name })
    .from(s.posts).innerJoin(s.departments, eq(s.departments.id, s.posts.departmentId)).where(where);
  if (!rows.length) return [];
  const pid = rows.map((r: { id: string }) => r.id);
  const [tagRows, areaRows] = await Promise.all([
    db.select({ postId: s.postTags.postId, name: s.tags.name }).from(s.postTags).innerJoin(s.tags, eq(s.tags.id, s.postTags.tagId)).where(inArray(s.postTags.postId, pid)),
    db.select({ postId: s.postAreas.postId, name: s.areas.name }).from(s.postAreas).innerJoin(s.areas, eq(s.areas.id, s.postAreas.areaId)).where(inArray(s.postAreas.postId, pid)),
  ]);
  const by = (list: { postId: string; name: string }[], id: string) => list.filter((x) => x.postId === id).map((x) => x.name);
  return rows.map((r: { id: string; title: string; summary: string; body: string; dep: string }) => ({
    kind: 'post' as const, refId: r.id,
    text: postText({ title: r.title, summary: r.summary, body: r.body, department: r.dep, tags: by(tagRows, r.id), areas: by(areaRows, r.id) }),
  }));
}
async function volumeItems(db: AnyDb, ids?: string[]) {
  const where = ids ? and(eq(s.volumes.status, 'published'), inArray(s.volumes.id, ids)) : eq(s.volumes.status, 'published');
  const vols = await db.select({ id: s.volumes.id, title: s.volumes.title, summary: s.volumes.summary }).from(s.volumes).where(where);
  if (!vols.length) return [];
  const links = await db.select({ volumeId: s.volumePosts.volumeId, title: s.posts.title }).from(s.volumePosts)
    .innerJoin(s.posts, eq(s.posts.id, s.volumePosts.postId)).where(inArray(s.volumePosts.volumeId, vols.map((v: { id: string }) => v.id))).orderBy(asc(s.volumePosts.sortOrder));
  return vols.map((v: { id: string; title: string; summary: string }) => ({
    kind: 'volume' as const, refId: v.id,
    text: volumeText({ title: v.title, summary: v.summary, posts: links.filter((l: { volumeId: string }) => l.volumeId === v.id).map((l: { title: string }) => l.title) }),
  }));
}

/** Atualiza (ou tira da busca) uma publicação depois de salvar. Nunca derruba o salvamento. */
export async function refreshPostVector(db: AnyDb, postId: string) {
  try {
    const items = await postItems(db, [postId]);
    if (items.length) await upsertVectors(db, items); else await removeVectors(db, 'post', [postId]);
  } catch (err) { console.warn('[busca] vetor da publicação não atualizado:', (err as Error).message); }
}
export async function refreshVolumeVector(db: AnyDb, volumeId: string) {
  try {
    const items = await volumeItems(db, [volumeId]);
    if (items.length) await upsertVectors(db, items); else await removeVectors(db, 'volume', [volumeId]);
  } catch (err) { console.warn('[busca] vetor do volume não atualizado:', (err as Error).message); }
}
/** Tudo de uma vez (build): grava o que mudou e apaga vetores de quem saiu do ar. */
export async function refreshAllVectors(db: AnyDb) {
  const items = [...await postItems(db), ...await volumeItems(db)];
  const n = await upsertVectors(db, items);
  const keep = new Set(items.map((i) => `${i.kind}:${i.refId}`));
  const all = await db.select({ kind: s.searchVectors.kind, refId: s.searchVectors.refId }).from(s.searchVectors);
  const gone = all.filter((v: { kind: string; refId: string }) => !keep.has(`${v.kind}:${v.refId}`));
  for (const kind of ['post', 'volume'] as const) await removeVectors(db, kind, gone.filter((g: { kind: string }) => g.kind === kind).map((g: { refId: string }) => g.refId));
  return { total: items.length, updated: n, removed: gone.length };
}
