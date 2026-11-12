// Encerra as outras sessões do admin (fica só a deste navegador)
import type { APIRoute } from 'astro';
import { ne } from 'drizzle-orm';
import { db, schema as s } from '../../db/client';
import { SESSION_COOKIE, logAction, sha256 } from '../../lib/auth';
import { json } from '../../lib/api';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, locals }) => {
  const current = sha256(cookies.get(SESSION_COOKIE)?.value ?? '');
  const gone = await db().delete(s.sessions).where(ne(s.sessions.tokenHash, current)).returning({ h: s.sessions.tokenHash });
  await logAction(locals.admin!.login, 'session.revoke-others', String(gone.length));
  return json({ revoked: gone.length });
};
