// Versões de um documento do editor: listar e criar (fotografia completa)
import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, json, readJson } from '../../../../../../lib/api';
import { createEditorVersion, listEditorVersions } from '../../../../../../lib/editor-docs';

export const prerender = false;
const body = z.object({ label: z.string().max(120).optional(), doc: z.unknown() });

export const GET: APIRoute = async ({ params }) => {
  try { return json(await listEditorVersions(params.id!)); } catch (err) { return fail(err); }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  try { return json(await createEditorVersion(params.id!, body.parse(await readJson(request)), locals.admin!.login), 201); } catch (err) { return fail(err); }
};
