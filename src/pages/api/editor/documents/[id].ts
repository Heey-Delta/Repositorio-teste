// Um documento do editor: abrir, gravar (409 se alguém gravou antes) e excluir (vai para a lixeira)
import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, json, readJson } from '../../../../lib/api';
import { logAction } from '../../../../lib/auth';
import { deleteEditorDocument, loadEditorDocument, saveEditorDocument } from '../../../../lib/editor-docs';

export const prerender = false;
const save = z.object({ doc: z.unknown(), baseVersion: z.number().int().min(1), actions: z.array(z.unknown()).max(2000).optional() });

export const GET: APIRoute = async ({ params }) => {
  try { return json(await loadEditorDocument(params.id!)); } catch (err) { return fail(err); }
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  try {
    const r = await saveEditorDocument(params.id!, save.parse(await readJson(request)), locals.admin!.login);
    return r.conflict ? json({ error: 'Outra pessoa gravou antes.', current: r.current }, 409) : json(r);
  } catch (err) { return fail(err); }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  try {
    await deleteEditorDocument(params.id!);
    await logAction(locals.admin!.login, 'editor.delete', params.id);
    return json({ ok: true });
  } catch (err) { return fail(err); }
};
