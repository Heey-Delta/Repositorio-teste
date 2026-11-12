// Alterações no catálogo (departamentos, assuntos e tags)
import type { APIRoute } from 'astro';
import { applyCatalog, catalogAction } from '../../lib/catalog';
import { fail, json, readJson } from '../../lib/api';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try { return json(await applyCatalog(catalogAction.parse(await readJson(request)), locals.admin!.login)); } catch (err) { return fail(err); }
};
