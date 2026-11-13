// Uma versão de um documento do editor (para comparar ou restaurar)
import type { APIRoute } from 'astro';
import { fail, json } from '../../../../../../lib/api';
import { getEditorVersion } from '../../../../../../lib/editor-docs';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  try { return json(await getEditorVersion(params.id!, params.vid!)); } catch (err) { return fail(err); }
};
