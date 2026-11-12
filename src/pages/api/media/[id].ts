// Atualiza o texto alternativo e a legenda de um arquivo
import type { APIRoute } from 'astro';
import { deleteMedia, updateMedia } from '../../../lib/media';
import { fail, json, readJson } from '../../../lib/api';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  try {
    const body = await readJson(request);
    return json({ media: await updateMedia(params.id!, { alt: String(body.alt ?? ''), caption: String(body.caption ?? '') }, locals.admin!.login) });
  } catch (err) { return fail(err); }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  try { return json(await deleteMedia(params.id!, locals.admin!.login)); } catch (err) { return fail(err); }
};
