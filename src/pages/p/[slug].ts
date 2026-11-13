// Documento do editor publicado no site. O HTML já vem pronto do banco (gerado ao publicar).
import type { APIRoute } from 'astro';
import { publicationBySlug } from '../../lib/editor-docs';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const r = await publicationBySlug(params.slug ?? '');
  if (!r) return new Response('Página não encontrada.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(r.html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // a CDN guarda por 1 minuto: republicar aparece logo
      'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
      'Last-Modified': r.updatedAt.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
