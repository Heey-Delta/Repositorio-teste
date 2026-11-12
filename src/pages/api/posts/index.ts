// Cria uma publicação
import type { APIRoute } from 'astro';
import { postInput, savePost } from '../../../lib/posts';
import { fail, json, readJson } from '../../../lib/api';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await readJson(request);
    const input = postInput.parse(body.post);
    return json(await savePost({ id: null, input, login: locals.admin!.login, note: 'Criada' }), 201);
  } catch (err) { return fail(err); }
};
