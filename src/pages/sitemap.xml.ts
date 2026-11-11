// Sitemap para o Google: página principal e o que do laboratório já está publicado (rascunhos ficam de fora)
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { departments } from '../lab/data';

export const GET: APIRoute = async ({ site }) => {
  const live = (await getCollection('lab')).filter((e) => !e.data.draft);
  const at = (p: string) => new URL(p, site).href;
  const urls: { loc: string; lastmod?: string }[] = [{ loc: at('/') }];
  if (live.length) {
    urls.push({ loc: at('/lab/') });
    for (const d of departments) if (live.some((e) => e.data.department === d.slug)) urls.push({ loc: at(`/lab/${d.slug}/`) });
    for (const e of live) urls.push({ loc: at(`/lab/${e.data.department}/${e.id.split('/').pop()}/`), lastmod: (e.data.updated ?? e.data.date).toISOString().slice(0, 10) });
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
