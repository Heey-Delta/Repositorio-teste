// Redirecionamentos 301 do Lab (spec 12): quando uma publicação que já está no ar muda de endereço,
// o endereço antigo continua funcionando e leva para o novo. Sem cadeias (A→B→C vira A→C) e sem ciclos.
import { and, eq } from 'drizzle-orm';
import { db, schema as s } from '../db/client';

export const labPath = (departmentSlug: string, slug: string) => `/lab/${departmentSlug}/${slug}/`;

export async function postPath(departmentId: number, slug: string) {
  const [dep] = await db().select({ slug: s.departments.slug }).from(s.departments).where(eq(s.departments.id, departmentId));
  return dep ? labPath(dep.slug, slug) : null;
}

export async function addRedirect(from: string, to: string) {
  if (from === to) return;
  await db().batch([
    db().delete(s.redirects).where(eq(s.redirects.fromPath, to)),   // o destino voltou a existir: não pode redirecionar
    db().update(s.redirects).set({ toPath: to }).where(eq(s.redirects.toPath, from)),   // quem apontava para o antigo aponta direto para o novo
    db().insert(s.redirects).values({ fromPath: from, toPath: to, code: 301 })
      .onConflictDoUpdate({ target: s.redirects.fromPath, set: { toPath: to, code: 301, active: true } }),
  ]);
}

export async function findRedirect(pathname: string) {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
  const [r] = await db().select().from(s.redirects).where(and(eq(s.redirects.fromPath, path), eq(s.redirects.active, true)));
  return r ?? null;
}
