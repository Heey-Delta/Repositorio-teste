// Duplica uma publicação (a cópia nasce como rascunho)
import type { APIRoute } from 'astro';
import { duplicatePost } from '../../../../lib/posts';
import { fail, json } from '../../../../lib/api';

export const prerender = false;

export const POST: APIRoute = async ({ params, locals }) => {
  try { return json(await duplicatePost(params.id!, locals.admin!.login), 201); } catch (err) { return fail(err); }
};
