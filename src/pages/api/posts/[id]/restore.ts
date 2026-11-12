// Restaura uma versão: grava a cópia antiga como versão nova (o histórico nunca perde nada)
import type { APIRoute } from 'astro';
import { postInput, revisionSnapshot, savePost, SaveError } from '../../../../lib/posts';
import { fail, json, readJson } from '../../../../lib/api';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const { revisionId } = await readJson(request);
    const rev = await revisionSnapshot(params.id!, Number(revisionId));
    if (!rev) throw new SaveError('Versão não encontrada.', undefined, 404);
    const input = postInput.parse(rev.snapshot);
    return json(await savePost({ id: params.id!, input, login: locals.admin!.login, note: `Restaurada da versão ${rev.id}` }));
  } catch (err) { return fail(err); }
};
