// Admin: cria um volume (POST)
import type { APIRoute } from 'astro';
import { saveVolume } from '../../../lib/volumes';
import { fail, json, readJson } from '../../../lib/api';

export const prerender = false;
export const POST: APIRoute = async ({ request, locals }) => {
  try { return json(await saveVolume(null, await readJson(request), locals.admin!.login), 201); } catch (err) { return fail(err); }
};
