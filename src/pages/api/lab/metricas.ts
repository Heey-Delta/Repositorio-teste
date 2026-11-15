// Números ao vivo da seção /Metrics da página inicial (que é estática): registros, raios e dias com registro.
import type { APIRoute } from 'astro';
import { labMetrics } from '../../../lib/metrics';

export const prerender = false;
export const GET: APIRoute = async () => {
  const m = await labMetrics();
  return Response.json({ posts: m.posts, likes: m.likes, active: m.active }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=600' } });
};
