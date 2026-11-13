// Curtidas do Lab. Visitante anônimo identificado por um cookie aleatório (lab_v); o IP vira um hash com sal só para
// frear abuso (muitas curtidas seguidas do mesmo lugar). GET ?ids=a,b → contagens e quais o visitante curtiu.
// POST { postId } → curte; POST de novo → descurte.
import type { APIRoute, AstroCookies } from 'astro';
import { createHash, randomUUID } from 'node:crypto';
import { and, count, eq, gt, inArray, lte, or } from 'drizzle-orm';
import { db, schema as s } from '../../../db/client';
import { likeCounts } from '../../../lib/lab-feed';

export const prerender = false;
const UUID = /^[0-9a-f-]{36}$/;
function visitor(cookies: AstroCookies, create: boolean) {
  const v = cookies.get('lab_v')?.value;
  if (v && /^[0-9a-f-]{36}$/.test(v)) return v;
  if (!create) return null;
  const id = randomUUID();
  cookies.set('lab_v', id, { path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 400 });
  return id;
}

export const GET: APIRoute = async ({ url, cookies }) => {
  const ids = (url.searchParams.get('ids') ?? '').split(',').filter((x) => UUID.test(x)).slice(0, 100);
  const me = visitor(cookies, false);
  const [counts, mine] = await Promise.all([
    likeCounts(ids),
    me && ids.length ? db().select({ id: s.postLikes.postId }).from(s.postLikes).where(and(eq(s.postLikes.visitor, me), inArray(s.postLikes.postId, ids))) : Promise.resolve([]),
  ]);
  return Response.json({ counts: Object.fromEntries(ids.map((id) => [id, counts.get(id) ?? 0])), liked: mine.map((r) => r.id) });
};

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  let postId = '';
  try { postId = String((await request.json()).postId ?? ''); } catch { /* corpo inválido */ }
  if (!UUID.test(postId)) return Response.json({ error: 'Publicação inválida.' }, { status: 400 });
  const [post] = await db().select({ id: s.posts.id }).from(s.posts).where(and(eq(s.posts.id, postId), or(eq(s.posts.status, 'published'), and(eq(s.posts.status, 'scheduled'), lte(s.posts.scheduledAt, new Date())))));
  if (!post) return Response.json({ error: 'Publicação não encontrada.' }, { status: 404 });
  const me = visitor(cookies, true)!;
  const [had] = await db().select({ id: s.postLikes.postId }).from(s.postLikes).where(and(eq(s.postLikes.postId, postId), eq(s.postLikes.visitor, me)));
  if (had) {
    await db().delete(s.postLikes).where(and(eq(s.postLikes.postId, postId), eq(s.postLikes.visitor, me)));
  } else {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || '';
    const ipHash = createHash('sha256').update(`${process.env.CRON_SECRET ?? 'lab'}:${ip}`).digest('hex').slice(0, 32);
    const [recent] = await db().select({ n: count() }).from(s.postLikes).where(and(eq(s.postLikes.ipHash, ipHash), gt(s.postLikes.createdAt, new Date(Date.now() - 3600_000))));
    if (Number(recent?.n ?? 0) >= 60) return Response.json({ error: 'Muitas curtidas seguidas. Tente mais tarde.' }, { status: 429 });
    await db().insert(s.postLikes).values({ postId, visitor: me, ipHash }).onConflictDoNothing();
  }
  const counts = await likeCounts([postId]);
  return Response.json({ liked: !had, count: counts.get(postId) ?? 0 });
};
