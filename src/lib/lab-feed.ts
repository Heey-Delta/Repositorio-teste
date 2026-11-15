// Dados da página inicial do Lab e das APIs públicas: volumes, curtidas e o "card" de cada publicação.
// Os cards levam só o necessário para a lista (sem o corpo do texto), então servem também para a busca e a lista infinita.
import { and, asc, count, desc, eq, gt, inArray, lte, or } from 'drizzle-orm';
import { db, schema as s } from '../db/client';
import { departmentBySlug } from '../lab/data';

export interface Card {
  id: string; title: string; summary: string; url: string; code: string | null;
  dept: string; deptName: string; date: string; cover: { url: string; alt: string } | null;
  likes: number; tags: string[];
  /** publicação agendada que ainda não está no ar: aparece, mas não abre */
  soon?: string | null;
}
export interface VolumeCard {
  id: string; slug: string; title: string; summary: string; url: string; number: number;
  cover: { url: string; alt: string } | null; posts: Card[]; open: number; updated: string;
  /** soma das curtidas (raios) de todas as publicações do volume */
  likes: number;
  experienceUrl: string; experienceLabel: string; published: string | null;
}

const live = (now = new Date()) => or(eq(s.posts.status, 'published'), and(eq(s.posts.status, 'scheduled'), lte(s.posts.scheduledAt, now)));
const upcoming = (now = new Date()) => and(eq(s.posts.status, 'scheduled'), gt(s.posts.scheduledAt, now));
export const postUrl = (dept: string, slug: string) => `/lab/${dept}/${slug}/`;

const cardFields = {
  id: s.posts.id, title: s.posts.title, summary: s.posts.summary, slug: s.posts.slug, code: s.posts.code, status: s.posts.status,
  publishedAt: s.posts.publishedAt, scheduledAt: s.posts.scheduledAt, createdAt: s.posts.createdAt,
  dept: s.departments.slug, coverUrl: s.media.url, coverAlt: s.media.alt,
};
type Row = { id: string; title: string; summary: string; slug: string; code: string | null; status: string; publishedAt: Date | null; scheduledAt: Date | null; createdAt: Date; dept: string; coverUrl: string | null; coverAlt: string | null };

async function toCards(rows: Row[], now = new Date()): Promise<Card[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [likes, tagRows] = await Promise.all([likeCounts(ids), db().select({ postId: s.postTags.postId, name: s.tags.name }).from(s.postTags).innerJoin(s.tags, eq(s.tags.id, s.postTags.tagId)).where(inArray(s.postTags.postId, ids))]);
  return rows.map((r) => {
    const date = r.publishedAt ?? r.scheduledAt ?? r.createdAt;
    const soon = r.status === 'scheduled' && r.scheduledAt && r.scheduledAt > now ? r.scheduledAt.toISOString() : null;
    return {
      id: r.id, title: r.title, summary: r.summary, url: postUrl(r.dept, r.slug), code: r.code, dept: r.dept, deptName: departmentBySlug(r.dept)?.name ?? r.dept,
      date: date.toISOString(), cover: r.coverUrl ? { url: r.coverUrl, alt: r.coverAlt ?? '' } : null,
      likes: likes.get(r.id) ?? 0, tags: tagRows.filter((t) => t.postId === r.id).map((t) => t.name), soon,
    };
  });
}
const baseQuery = () => db().select(cardFields).from(s.posts)
  .innerJoin(s.departments, eq(s.departments.id, s.posts.departmentId))
  .leftJoin(s.media, eq(s.media.id, s.posts.coverMediaId));

/** Publicações no ar, da mais recente para a mais antiga (com paginação para a lista infinita). */
export async function liveCards(opts: { offset?: number; limit?: number; ids?: string[] } = {}) {
  const now = new Date();
  const where = opts.ids ? and(live(now), inArray(s.posts.id, opts.ids)) : live(now);
  let q = baseQuery().where(where).orderBy(desc(s.posts.publishedAt), desc(s.posts.createdAt)).$dynamic();
  if (opts.limit) q = q.limit(opts.limit).offset(opts.offset ?? 0);
  return toCards(await q as Row[], now);
}
export async function liveCount() {
  const [r] = await db().select({ n: count() }).from(s.posts).where(live());
  return Number(r?.n ?? 0);
}

export async function likeCounts(ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await db().select({ id: s.postLikes.postId, n: count() }).from(s.postLikes).where(inArray(s.postLikes.postId, ids)).groupBy(s.postLikes.postId);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

/** "Top hypados": as mais curtidas (empate: a mais recente primeiro). */
export function topLiked(cards: Card[], n = 12) {
  return [...cards].filter((c) => c.likes > 0).sort((a, b) => b.likes - a.likes || +new Date(b.date) - +new Date(a.date)).slice(0, n);
}

/** Volumes publicados, com as publicações na ordem escolhida (as agendadas aparecem como "em breve"). */
export async function publishedVolumes(slug?: string): Promise<VolumeCard[]> {
  const where = slug ? and(eq(s.volumes.status, 'published'), eq(s.volumes.slug, slug)) : eq(s.volumes.status, 'published');
  const vols = await db().select({ v: s.volumes, coverUrl: s.media.url, coverAlt: s.media.alt }).from(s.volumes)
    .leftJoin(s.media, eq(s.media.id, s.volumes.coverMediaId)).where(where).orderBy(desc(s.volumes.publishedAt), desc(s.volumes.createdAt));   // do mais recente para o mais antigo
  if (!vols.length) return [];
  // numeração estável: pela ordem de publicação do volume (o primeiro publicado é o VOL. 01)
  const numbers = new Map((await db().select({ id: s.volumes.id }).from(s.volumes).where(eq(s.volumes.status, 'published')).orderBy(asc(s.volumes.publishedAt), asc(s.volumes.createdAt))).map((r, i) => [r.id, i + 1]));
  const links = await db().select({ volumeId: s.volumePosts.volumeId, postId: s.volumePosts.postId, sort: s.volumePosts.sortOrder }).from(s.volumePosts)
    .where(inArray(s.volumePosts.volumeId, vols.map((v) => v.v.id))).orderBy(asc(s.volumePosts.sortOrder));
  const now = new Date();
  const postIds = [...new Set(links.map((l) => l.postId))];
  const rows = postIds.length ? await baseQuery().where(and(inArray(s.posts.id, postIds), or(live(now), upcoming(now)))) as Row[] : [];
  const cards = new Map((await toCards(rows, now)).map((c) => [c.id, c]));
  return vols.map(({ v, coverUrl, coverAlt }) => {
    const posts = links.filter((l) => l.volumeId === v.id).map((l) => cards.get(l.postId)).filter((c): c is Card => Boolean(c));
    return {
      id: v.id, slug: v.slug, title: v.title, summary: v.summary, url: `/lab/volumes/${v.slug}/`, number: numbers.get(v.id) ?? 0,
      cover: coverUrl ? { url: coverUrl, alt: coverAlt ?? '' } : null, posts, open: posts.filter((p) => !p.soon).length,
      updated: v.updatedAt.toISOString(), likes: posts.reduce((n, p) => n + p.likes, 0),
      experienceUrl: v.experienceUrl ?? '', experienceLabel: v.experienceLabel ?? '', published: v.publishedAt?.toISOString() ?? null,
    };
  });
}

/** Volumes de que uma publicação faz parte (aparece no fim do artigo). */
export async function volumesOfPost(postId: string) {
  return db().select({ slug: s.volumes.slug, title: s.volumes.title }).from(s.volumePosts)
    .innerJoin(s.volumes, eq(s.volumes.id, s.volumePosts.volumeId))
    .where(and(eq(s.volumePosts.postId, postId), eq(s.volumes.status, 'published'))).orderBy(asc(s.volumes.sortOrder));
}

// ---------- "hoje" e "este mês" no fuso de São Paulo ----------
const TZ = 'America/Sao_Paulo';
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const isToday = (iso: string, now = new Date()) => ymd(new Date(iso)) === ymd(now);
export const isThisMonth = (iso: string, now = new Date()) => ymd(new Date(iso)).slice(0, 7) === ymd(now).slice(0, 7);

/** Semana atual (de segunda a domingo), no fuso de São Paulo. */
export function isThisWeek(iso: string, now = new Date()) {
  const day = new Date(`${ymd(now)}T12:00:00Z`);
  const monday = new Date(day); monday.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const d = ymd(new Date(iso));
  return d >= monday.toISOString().slice(0, 10) && d <= ymd(now);
}

/**
 * Atividade estilo GitHub: uma célula por dia nas últimas `weeks` semanas (colunas de domingo a sábado),
 * com quantas publicações saíram em cada dia (no fuso de São Paulo) e o nível de cor (0 a 4).
 */
export function activity(dates: string[], now = new Date(), weeks = 53) {
  const per = new Map<string, number>();
  for (const iso of dates) { const k = ymd(new Date(iso)); per.set(k, (per.get(k) ?? 0) + 1); }
  const today = new Date(`${ymd(now)}T12:00:00Z`);
  const start = new Date(today); start.setUTCDate(today.getUTCDate() - today.getUTCDay() - (weeks - 1) * 7);   // domingo da primeira coluna
  const level = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n < 5 ? 3 : 4);
  const cols: { date: string; n: number; level: number; future: boolean }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start); day.setUTCDate(start.getUTCDate() + w * 7 + d);
      const k = day.toISOString().slice(0, 10), n = per.get(k) ?? 0;
      col.push({ date: k, n, level: level(n), future: day > today });
    }
    cols.push(col);
  }
  const months = cols.map((c, i) => { const m = c[0].date.slice(5, 7); return i === 0 || cols[i - 1][0].date.slice(5, 7) !== m ? Number(m) : 0; });
  const active = [...per.keys()].filter((k) => k >= cols[0][0].date).length;
  return { cols, months, active };
}
