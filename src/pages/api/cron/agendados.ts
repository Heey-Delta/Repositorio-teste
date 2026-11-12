// Tarefa diária do Vercel (vercel.json): publica o que estava agendado para até agora, atualiza o site e avisa
// os buscadores (IndexNow) do que mudou
import type { APIRoute } from 'astro';
import { and, eq, lte } from 'drizzle-orm';
import { db, schema as s } from '../../../db/client';
import { safeEqual } from '../../../lib/auth';
import { triggerRebuild } from '../../../lib/rebuild';
import { json } from '../../../lib/api';
import { publicUrls, pingIndexNow } from '../../../lib/indexnow';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) return json({ error: 'não autorizado' }, 401);
  const now = new Date();
  const due = await db().update(s.posts)
    .set({ status: 'published', updatedAt: now })
    .where(and(eq(s.posts.status, 'scheduled'), lte(s.posts.scheduledAt, now)))
    .returning({ id: s.posts.id, scheduledAt: s.posts.scheduledAt });
  for (const p of due) await db().update(s.posts).set({ publishedAt: p.scheduledAt }).where(eq(s.posts.id, p.id));
  const site = due.length ? await triggerRebuild('cron', `${due.length} agendada(s)`) : null;
  // todo dia: avisa os buscadores (IndexNow) do que entrou ou mudou nos últimos 2 dias
  const indexnow = await pingIndexNow(new URL(import.meta.env.SITE), await publicUrls(new URL(import.meta.env.SITE), 2));
  return json({ published: due.length, site, indexnow });
};
