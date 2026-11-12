// Início do login: gera o `state` (contra CSRF no retorno), guarda num cookie de 10 min e manda para o GitHub.
import type { APIRoute } from 'astro';
import { CALLBACK_URL, SITE, STATE_COOKIE, clientIp, cookieOptions, logAttempt, randomToken, tooManyAttempts } from '../../../lib/auth';

export const prerender = false;

export const GET: APIRoute = async ({ url, request, clientAddress, cookies, redirect }) => {
  // o app do GitHub só aceita o retorno no domínio principal: outros endereços do projeto são levados para lá
  if (url.origin !== SITE.origin) return redirect(new URL('/admin/login', SITE).href);
  const ip = clientIp(request, clientAddress);
  if (await tooManyAttempts(ip)) return redirect('/admin/login?erro=limite');
  await logAttempt(ip, 'start');

  const state = randomToken();
  cookies.set(STATE_COOKIE, state, cookieOptions(600));
  const auth = new URL('https://github.com/login/oauth/authorize');
  auth.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID ?? '');
  auth.searchParams.set('redirect_uri', CALLBACK_URL);
  auth.searchParams.set('state', state);
  auth.searchParams.set('allow_signup', 'false');
  return redirect(auth.href);
};
