// Salva o perfil do autor
import type { APIRoute } from 'astro';
import { authorInput, saveAuthorProfile } from '../../lib/author';
import { fail, json, readJson } from '../../lib/api';

export const prerender = false;

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const input = authorInput.parse(await readJson(request));
    return json(await saveAuthorProfile(input, locals.admin!.login));
  } catch (err) { return fail(err); }
};
