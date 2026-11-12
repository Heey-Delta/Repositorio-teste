// Feed RSS do Lab: as publicações no ar (menos as marcadas para não aparecer no Google), da mais nova para a mais antiga
import type { APIRoute } from 'astro';
import { getLabEntries } from '../../lib/lab-public';
import { departmentBySlug, LAB_NAME, LAB_DESCRIPTION } from '../../lab/data';

const xml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async ({ site }) => {
  const at = (p: string) => new URL(p, site).href;
  const live = (await getLabEntries()).filter((e) => !e.data.draft).slice(0, 50);
  const items = live.map((e) => {
    const url = at(`/lab/${e.id}/`);
    return [
      '    <item>',
      `      <title>${xml(e.data.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${e.data.date.toUTCString()}</pubDate>`,
      `      <description>${xml(e.data.description)}</description>`,
      `      <category>${xml(departmentBySlug(e.data.department).name)}</category>`,
      ...e.data.areas.map((a) => `      <category>${xml(a)}</category>`),
      `      <dc:creator>${xml(e.data.author)}</dc:creator>`,
      '    </item>',
    ].join('\n');
  });
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xml(LAB_NAME)} · Hallan</title>
    <link>${at('/lab/')}</link>
    <atom:link href="${at('/lab/rss.xml')}" rel="self" type="application/rss+xml" />
    <description>${xml(LAB_DESCRIPTION)}</description>
    <language>pt-BR</language>
${live[0] ? `    <lastBuildDate>${new Date(Math.max(...live.map((e) => +(e.data.updated ?? e.data.date)))).toUTCString()}</lastBuildDate>\n` : ''}${items.join('\n')}
  </channel>
</rss>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
