// Botão "Avisar buscadores" do SEO & GEO: manda todos os endereços públicos para o IndexNow
import type { APIRoute } from 'astro';
import { db, schema as s } from '../../../db/client';
import { publicUrls, pingIndexNow } from '../../../lib/indexnow';
import { json } from '../../../lib/api';

export const prerender = false;

export const POST: APIRoute = async ({ locals, site }) => {
  const r = await pingIndexNow(site!, await publicUrls(site!));
  await db().insert(s.adminLog).values({ login: locals.admin!.login, action: 'seo.indexnow', target: `${r.sent} endereços (${r.status ?? 'sem resposta'})` });
  return json(r, r.status && r.status < 300 ? 200 : 502);
};
