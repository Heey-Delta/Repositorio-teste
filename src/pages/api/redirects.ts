// Redirecionamentos: criar, ativar/desativar e excluir
import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { createRedirect, deleteRedirect, setRedirectActive } from '../../lib/redirects';
import { fail, json, readJson } from '../../lib/api';
import { logAction } from '../../lib/auth';

export const prerender = false;

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), from: z.string().max(300), to: z.string().max(500) }),
  z.object({ action: z.literal('toggle'), id: z.number().int(), active: z.boolean() }),
  z.object({ action: z.literal('delete'), id: z.number().int() }),
]);

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const a = body.parse(await readJson(request));
    const login = locals.admin!.login;
    if (a.action === 'create') { const r = await createRedirect(a.from, a.to); await logAction(login, 'redirect.create', `${r.from} → ${r.to}`); return json(r, 201); }
    if (a.action === 'toggle') { await setRedirectActive(a.id, a.active); await logAction(login, a.active ? 'redirect.on' : 'redirect.off', String(a.id)); }
    if (a.action === 'delete') { await deleteRedirect(a.id); await logAction(login, 'redirect.delete', String(a.id)); }
    return json({ ok: true });
  } catch (err) { return fail(err); }
};
