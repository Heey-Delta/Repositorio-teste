// Admin: salva as configurações da página inicial (stacks, cursos e volumes em destaque) e gera o site de novo.
import type { APIRoute } from 'astro';
import { saveHomeSettings } from '../../lib/home-settings';
import { fail, json, readJson } from '../../lib/api';

export const prerender = false;
export const PUT: APIRoute = async ({ request, locals }) => {
  try { return json(await saveHomeSettings(await readJson(request), locals.admin!.login)); } catch (err) { return fail(err); }
};
