// Quadro da fila de produção: muda o status (arrastar entre colunas), a data de agendamento e o responsável.
// Usa o mesmo salvamento do editor, então versões, redirecionamentos e a atualização do site continuam valendo.
import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { loadPost, postInput, savePost, SaveError } from '../../../../lib/posts';
import { statusLabel } from '../../../../lib/admin';
import { fail, json, readJson } from '../../../../lib/api';

export const prerender = false;
const body = z.object({
  status: z.enum(['idea', 'draft', 'review', 'scheduled', 'published', 'archived']).optional(),
  scheduledAt: z.string().nullable().optional(),
  responsible: z.string().trim().max(80).nullable().optional(),
});

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  try {
    const p = body.parse(await readJson(request));
    const post = await loadPost(params.id!);
    if (!post) throw new SaveError('Publicação não encontrada.', undefined, 404);
    const d = post.draft;
    const status = p.status ?? d.status;
    const scheduledAt = p.scheduledAt !== undefined ? p.scheduledAt : d.scheduledAt;
    if (status === 'scheduled' && !scheduledAt) throw new SaveError('Para agendar, informe a data e a hora.', 'scheduledAt');
    const input = postInput.parse({ ...d, status, scheduledAt: status === 'scheduled' ? scheduledAt : null, responsible: p.responsible !== undefined ? p.responsible : d.responsible });
    const notes = [p.status && p.status !== d.status ? `Status: ${statusLabel[p.status]}` : '', p.responsible !== undefined && p.responsible !== d.responsible ? `Responsável: ${p.responsible || '—'}` : ''].filter(Boolean).join(' · ');
    const out = await savePost({ id: post.id, input, login: locals.admin!.login, baseUpdatedAt: null, note: `${notes || 'Quadro'} (pelo quadro)` });
    return json({ ...out, status: input.status, scheduledAt: input.scheduledAt?.toISOString() ?? null, responsible: input.responsible });
  } catch (err) { return fail(err); }
};
