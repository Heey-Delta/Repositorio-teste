// Publicar um documento do editor no site: ver o estado, publicar/atualizar e despublicar
import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, json, readJson } from '../../../../../lib/api';
import { logAction } from '../../../../../lib/auth';
import { getPublication, publishEditorDocument, unpublishEditorDocument } from '../../../../../lib/editor-docs';

export const prerender = false;
const body = z.object({ indexable: z.boolean().optional(), slug: z.string().max(120).optional() });

export const GET: APIRoute = async ({ params }) => {
  try { return json(await getPublication(params.id!)); } catch (err) { return fail(err); }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const p = await publishEditorDocument(params.id!, body.parse(await readJson(request)));
    await logAction(locals.admin!.login, 'editor.publish', p.url);
    return json(p);
  } catch (err) { return fail(err); }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  try {
    await unpublishEditorDocument(params.id!);
    await logAction(locals.admin!.login, 'editor.unpublish', params.id);
    return json({ ok: true });
  } catch (err) { return fail(err); }
};
