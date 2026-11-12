// Retorno do GitHub: confere o `state`, troca o código por um token, lê o id da conta e só abre sessão se for o dono.
// O token do GitHub é usado uma vez e revogado em seguida: o admin não guarda acesso nenhum à sua conta.
import type { APIRoute } from 'astro';
import {
  CALLBACK_URL, STATE_COOKIE, clientIp, createSession, logAction, logAttempt, safeEqual, tooManyAttempts,
} from '../../../lib/auth';

export const prerender = false;

export const GET: APIRoute = async ({ url, request, clientAddress, cookies, redirect }) => {
  const ip = clientIp(request, clientAddress);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = cookies.get(STATE_COOKIE)?.value;
  cookies.delete(STATE_COOKIE, { path: '/' });

  if (await tooManyAttempts(ip)) return redirect('/admin/login?erro=limite');
  if (!code || !state || !expected || !safeEqual(state, expected)) {
    await logAttempt(ip, 'error');
    return redirect('/admin/login?erro=estado');
  }

  const clientId = process.env.GITHUB_CLIENT_ID ?? '', clientSecret = process.env.GITHUB_CLIENT_SECRET ?? '';
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: CALLBACK_URL }),
    });
    const { access_token: token } = await tokenRes.json() as { access_token?: string };
    if (!token) throw new Error('sem token');

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'hallan-admin' },
    });
    const user = await userRes.json() as { id?: number; login?: string };
    await fetch(`https://api.github.com/applications/${clientId}/token`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, Accept: 'application/vnd.github+json', 'User-Agent': 'hallan-admin' },
      body: JSON.stringify({ access_token: token }),
    }).catch(() => {});

    if (!user.id || !user.login || String(user.id) !== process.env.ADMIN_GITHUB_ID) {
      await logAttempt(ip, 'denied');
      return redirect('/admin/login?erro=conta');
    }
    await createSession(cookies, { id: user.id, login: user.login }, request.headers.get('user-agent'));
    await logAttempt(ip, 'ok');
    await logAction(user.login, 'login');
    return redirect('/admin/');
  } catch {
    await logAttempt(ip, 'error');
    return redirect('/admin/login?erro=github');
  }
};
