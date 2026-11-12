// Salva uma publicação existente. `baseUpdatedAt` evita sobrescrever uma edição feita em outra aba.
import type { APIRoute } from 'astro';
import { deletePost, postInput, savePost } from '../../../lib/posts';
import { fail, json, readJson } from '../../../lib/api';

export const prerender = false;

export const PUT: APIRoute = async ({ params, request, locals }) => {
  try {
    const body = await readJson(request);
    const input = postInput.parse(body.post);
    return json(await savePost({ id: params.id!, input, login: locals.admin!.login, baseUpdatedAt: body.baseUpdatedAt ?? null }));
  } catch (err) { return fail(err); }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  try { return json(await deletePost(params.id!, locals.admin!.login)); } catch (err) { return fail(err); }
};
