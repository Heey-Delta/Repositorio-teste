// Admin: salva (PUT) ou exclui (DELETE) um volume
import type { APIRoute } from 'astro';
import { deleteVolume, saveVolume } from '../../../lib/volumes';
import { fail, json, readJson } from '../../../lib/api';

export const prerender = false;
export const PUT: APIRoute = async ({ params, request, locals }) => {
  try { return json(await saveVolume(params.id!, await readJson(request), locals.admin!.login)); } catch (err) { return fail(err); }
};
export const DELETE: APIRoute = async ({ params, locals }) => {
  try { return json(await deleteVolume(params.id!, locals.admin!.login)); } catch (err) { return fail(err); }
};
