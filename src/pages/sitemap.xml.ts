// Sitemap para o Google: página principal e o que do laboratório já está no ar (fora do Google não entra),
// com data da última mudança e a imagem de capa de cada publicação
import type { APIRoute } from 'astro';
import { getLabEntries, getAuthor } from '../lib/lab-public';
import { departments } from '../lab/data';

const xml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = (d: Date) => d.toISOString().slice(0, 10);

export const GET: APIRoute = async ({ site }) => {
  const live = (await getLabEntries()).filter((e) => !e.data.draft);
  const at = (p: string) => new URL(p, site).href;
  const changed = (list: typeof live) => new Date(Math.max(...list.map((e) => +(e.data.updated ?? e.data.date))));
  const urls: { loc: string; lastmod?: string; image?: { url: string; alt: string } }[] = [{ loc: at('/') }];
  if (live.length) {
    urls.push({ loc: at('/lab/'), lastmod: day(changed(live)) });
    for (const d of departments) {
      const own = live.filter((e) => e.data.department === d.slug);
      if (own.length) urls.push({ loc: at(`/lab/${d.slug}/`), lastmod: day(changed(own)) });
    }
    if ((await getAuthor()).bio) urls.push({ loc: at('/lab/autor/') });   // a página do autor só entra quando tiver bio
    for (const e of live) urls.push({ loc: at(`/lab/${e.id}/`), lastmod: day(e.data.updated ?? e.data.date), image: e.data.cover ?? undefined });
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${u.image ? `<image:image><image:loc>${xml(u.image.url)}</image:loc></image:image>` : ''}</url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
