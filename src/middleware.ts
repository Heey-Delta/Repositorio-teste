// Protege /admin e /api: sem a sessão do dono, páginas mandam para o login e a API responde 401.
// Páginas estáticas (site e Lab) passam direto: o middleware só roda nas rotas renderizadas no servidor.
import { defineMiddleware } from 'astro:middleware';
import { readSession } from './lib/auth';

const OPEN = new Set(['/admin/login', '/api/auth/github', '/api/auth/callback', '/api/auth/logout']);
const CSP = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com", "img-src 'self' data: https:", "connect-src 'self'",
  "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self' https://github.com",
].join('; ');

export const onRequest = defineMiddleware(async (ctx, next) => {
  if (ctx.isPrerendered) return next();
  const path = ctx.url.pathname.replace(/\/+$/, '') || '/';
  const isAdmin = path === '/admin' || path.startsWith('/admin/');
  const isApi = path.startsWith('/api/');
  if (!isAdmin && !isApi) return next();

  const session = await readSession(ctx.cookies);
  if (session) ctx.locals.admin = session;
  if (!session && !OPEN.has(path)) {
    if (isApi) return Response.json({ error: 'não autorizado' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    return ctx.redirect('/admin/login');
  }

  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-store');
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  out.headers.set('X-Frame-Options', 'DENY');
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'same-origin');
  if (isAdmin) out.headers.set('Content-Security-Policy', CSP);
  return out;
});
