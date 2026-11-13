// Busca pública do Lab: GET ?q=texto&tag=slug. Sem q, devolve só as tags mais usadas (atalhos do painel).
import type { APIRoute } from 'astro';
import { popularTags, searchLab } from '../../../lib/lab-search';

export const prerender = false;
export const GET: APIRoute = async ({ url }) => {
  try {
    const q = url.searchParams.get('q') ?? '', tag = url.searchParams.get('tag');
    const [res, tags] = await Promise.all([q || tag ? searchLab(q, tag) : Promise.resolve({ items: [], semantic: false, tag: null }), url.searchParams.has('tags') ? popularTags() : Promise.resolve(undefined)]);
    return Response.json({ ...res, tags }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'A busca falhou. Tente de novo.' }, { status: 500 });
  }
};
