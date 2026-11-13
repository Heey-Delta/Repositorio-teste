// Busca do Lab: junta três sinais.
// 1) Significado: o vetor da pergunta comparado aos vetores das publicações e volumes (src/lib/embeddings.ts).
// 2) Palavras: título, código, tags, departamento e resumo, sem acento e sem diferença de maiúsculas.
// 3) Sinônimos e siglas comuns (IA = inteligência artificial…), que valem mesmo se o gateway de vetores estiver fora.
// Busca por tag: ?tag=<slug> ou "#tag" na pergunta.
import { eq, inArray } from 'drizzle-orm';
import { db, schema as s } from '../db/client';
import { embed, fold, nearest } from './embeddings';
import { expand } from './search-terms';
export { expand };
import { liveCards, publishedVolumes, type Card } from './lab-feed';

export interface Hit { kind: 'post' | 'volume'; score: number; how: 'texto' | 'tag' | 'significado'; card?: Card; volume?: { title: string; url: string; summary: string; cover: Card['cover']; count: number } }

/** Pontos por palavra: título e código pesam mais que o resumo. */
function textScore(terms: string[], c: { title: string; summary: string; code?: string | null; tags: string[]; extra?: string }) {
  if (!terms.length) return 0;
  const title = fold(c.title), summary = fold(c.summary), tags = c.tags.map(fold), extra = fold(c.extra ?? '');
  let n = 0;
  for (const t of terms) {
    const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    if (c.code && fold(c.code) === t) n += 6;
    if (re.test(title)) n += 3;
    if (tags.some((x) => x === t || re.test(x))) n += 2.5;
    if (re.test(summary)) n += 1;
    if (re.test(extra)) n += 0.5;
  }
  return n;
}

export async function searchLab(q: string, tag?: string | null) {
  const query = q.trim().slice(0, 200);
  const hashTag = /(^|\s)#([\p{L}\d-]+)/u.exec(query)?.[2];
  const tagSlug = (tag || hashTag || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || null;
  const text = query.replace(/(^|\s)#[\p{L}\d-]+/gu, ' ').trim();
  const [cards, vols] = await Promise.all([liveCards(), publishedVolumes()]);

  let pool = cards;
  if (tagSlug) {
    const tagged = await db().select({ postId: s.postTags.postId }).from(s.postTags).innerJoin(s.tags, eq(s.tags.id, s.postTags.tagId)).where(eq(s.tags.slug, tagSlug));
    const ok = new Set(tagged.map((t) => t.postId));
    pool = cards.filter((c) => ok.has(c.id));
    if (!text) return { items: pool.map((card): Hit => ({ kind: 'post', score: 1, how: 'tag', card })), semantic: false, tag: tagSlug };
  }
  if (!text) return { items: [] as Hit[], semantic: false, tag: tagSlug };

  const terms = expand(text);
  const vec = text.length >= 2 ? (await embed([text], 2500))?.[0] ?? null : null;
  const sims = new Map<string, number>();
  if (vec) for (const r of await nearest(db(), vec, 60)) sims.set(`${r.kind}:${r.refId}`, r.sim);
  const best = Math.max(0, ...sims.values());
  // só entra por significado o que está perto do melhor resultado (evita lista cheia de coisas sem relação)
  const near = (sim: number) => sim >= Math.max(0.25, best * 0.75);

  const hits: Hit[] = [];
  for (const card of pool) {
    const kw = textScore(terms, { ...card, extra: card.deptName });
    const sim = sims.get(`post:${card.id}`) ?? 0;
    if (kw <= 0 && !(vec && near(sim))) continue;
    hits.push({ kind: 'post', card, score: sim + Math.min(1, kw / 6) * 0.6, how: kw > 0 ? 'texto' : 'significado' });
  }
  if (!tagSlug) for (const v of vols) {
    const kw = textScore(terms, { title: v.title, summary: v.summary, tags: [], extra: v.posts.map((p) => p.title).join(' ') });
    const sim = sims.get(`volume:${v.id}`) ?? 0;
    if (kw <= 0 && !(vec && near(sim))) continue;
    hits.push({ kind: 'volume', score: sim + Math.min(1, kw / 6) * 0.6 + 0.05, how: kw > 0 ? 'texto' : 'significado', volume: { title: v.title, url: v.url, summary: v.summary, cover: v.cover, count: v.posts.length } });
  }
  hits.sort((a, b) => b.score - a.score);
  return { items: hits.slice(0, 20), semantic: Boolean(vec), tag: tagSlug };
}

/** Tags com publicações no ar (para os atalhos da busca), das mais usadas para as menos. */
export async function popularTags(limit = 24) {
  const cards = await liveCards();
  const ids = cards.map((c) => c.id);
  if (!ids.length) return [];
  const rows = await db().select({ slug: s.tags.slug, name: s.tags.name, postId: s.postTags.postId }).from(s.postTags).innerJoin(s.tags, eq(s.tags.id, s.postTags.tagId)).where(inArray(s.postTags.postId, ids));
  const m = new Map<string, { slug: string; name: string; n: number }>();
  for (const r of rows) { const t = m.get(r.slug) ?? { slug: r.slug, name: r.name, n: 0 }; t.n++; m.set(r.slug, t); }
  return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, limit);
}
