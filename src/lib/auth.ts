// Login do admin: um único dono (a conta do GitHub em ADMIN_GITHUB_ID).
// O cookie guarda um token aleatório; o banco guarda só o hash dele, então um vazamento do banco não abre sessões.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { and, count, eq, gt } from 'drizzle-orm';
import { db, schema as s } from '../db/client';

// Prefixo __Host-: o navegador só aceita o cookie com Secure, Path=/ e sem Domain (não vaza para subdomínios)
export const SESSION_COOKIE = '__Host-hallan_admin';
export const STATE_COOKIE = '__Host-hallan_oauth';
const SESSION_DAYS = 30;
const ATTEMPT_WINDOW_MIN = 15;
const ATTEMPT_LIMIT = 20;

export const SITE = new URL(import.meta.env.SITE);
export const CALLBACK_URL = new URL('/api/auth/callback', SITE).href;

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export function safeEqual(a: string, b: string) {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}
export const cookieOptions = (maxAge: number) => ({ httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge });

export function clientIp(request: Request, fallback: string) {
  return request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? fallback;
}

export async function createSession(cookies: AstroCookies, user: { id: number; login: string }, userAgent: string | null) {
  const token = randomToken();
  await db().insert(s.sessions).values({
    tokenHash: sha256(token), githubId: user.id, login: user.login, userAgent,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5),
  });
  cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_DAYS * 86400));
}

export async function readSession(cookies: AstroCookies) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db().select().from(s.sessions)
    .where(and(eq(s.sessions.tokenHash, sha256(token)), gt(s.sessions.expiresAt, new Date())));
  // a conta autorizada pode mudar na variável de ambiente: sessões de outra conta deixam de valer na hora
  if (!row || String(row.githubId) !== process.env.ADMIN_GITHUB_ID) return null;
  return { login: row.login, githubId: row.githubId };
}

export async function destroySession(cookies: AstroCookies) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) await db().delete(s.sessions).where(eq(s.sessions.tokenHash, sha256(token)));
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

export async function tooManyAttempts(ip: string) {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MIN * 60e3);
  const [{ n }] = await db().select({ n: count() }).from(s.authAttempts)
    .where(and(eq(s.authAttempts.ip, ip), gt(s.authAttempts.createdAt, since)));
  return n >= ATTEMPT_LIMIT;
}

export async function logAttempt(ip: string, outcome: 'start' | 'ok' | 'denied' | 'error') {
  await db().insert(s.authAttempts).values({ ip, outcome });
}

export async function logAction(login: string, action: string, target?: string) {
  await db().insert(s.adminLog).values({ login, action, target });
}
