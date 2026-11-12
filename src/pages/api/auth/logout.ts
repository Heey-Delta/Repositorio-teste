// Saída: apaga a sessão do banco e o cookie. Só POST (o Astro confere a origem de formulários enviados).
import type { APIRoute } from 'astro';
import { destroySession, logAction } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, locals, redirect }) => {
  if (locals.admin) await logAction(locals.admin.login, 'logout');
  await destroySession(cookies);
  return redirect('/admin/login');
};
