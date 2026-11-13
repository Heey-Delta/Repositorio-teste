// Lista infinita do Lab: GET ?offset=N&limit=12 → próximas publicações (da mais recente para a mais antiga).
import type { APIRoute } from 'astro';
import { liveCards, liveCount } from '../../../lib/lab-feed';

export const prerender = false;
export const GET: APIRoute = async ({ url }) => {
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit')) || 12));
  const [items, total] = await Promise.all([liveCards({ offset, limit }), liveCount()]);
  return Response.json({ items, total, next: offset + items.length < total ? offset + items.length : null });
};
