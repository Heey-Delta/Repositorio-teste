// Documentos do editor: listar e criar (novo em branco ou a partir de um JSON do motor)
import type { APIRoute } from 'astro';
import { fail, json, readJson } from '../../../../lib/api';
import { logAction } from '../../../../lib/auth';
import { createEditorDocument, listDocuments } from '../../../../lib/editor-docs';

export const prerender = false;

export const GET: APIRoute = async () => {
  try { return json(await listDocuments()); } catch (err) { return fail(err); }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await readJson(request);
    const d = await createEditorDocument(body ?? {}, locals.admin!.login);
    await logAction(locals.admin!.login, 'editor.create', d.id);
    return json(d, 201);
  } catch (err) { return fail(err); }
};
