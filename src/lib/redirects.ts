// Redirecionamentos 301 do Lab (spec 12): quando uma publicação que já está no ar muda de endereço,
// o endereço antigo continua funcionando e leva para o novo. Sem cadeias (A→B→C vira A→C) e sem ciclos.
import { and, desc, eq } from 'drizzle-orm';
import { db, schema as s } from '../db/client';
import { SaveError } from './posts';

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

// ---------- gestão no admin (/admin/seo/redirecionamentos/) ----------

export const listRedirects = () => db().select().from(s.redirects).orderBy(desc(s.redirects.createdAt));

const norm = (p: string) => (p.endsWith('/') ? p : `${p}/`);

// Redirecionamento criado à mão: só endereços do Lab (são os que passam pelo servidor quando não existem)
export async function createRedirect(fromRaw: string, toRaw: string) {
  let from: string;
  try { from = norm(new URL(fromRaw.trim(), 'https://x').pathname); } catch { throw new SaveError('Endereço de origem inválido.', 'from'); }
  if (!from.startsWith('/lab/') || from === '/lab/') throw new SaveError('A origem precisa ser um endereço dentro de /lab/ (ex.: /lab/research/nome-antigo/).', 'from');
  const toTrim = toRaw.trim();
  let to: string;
  if (/^https:\/\/\S+$/.test(toTrim)) to = toTrim;
  else if (toTrim.startsWith('/')) to = norm(toTrim.split(/[?#]/)[0]);
  else throw new SaveError('O destino precisa começar com / (página do site) ou https:// (outro site).', 'to');
  // destino que já redireciona: aponta direto para o final da cadeia
  const [next] = await db().select().from(s.redirects).where(and(eq(s.redirects.fromPath, to), eq(s.redirects.active, true)));
  if (next) to = next.toPath;
  if (to === from) throw new SaveError('Origem e destino são o mesmo endereço (o redirecionamento entraria em ciclo).', 'to');
  const live = await db().select({ slug: s.posts.slug, dep: s.departments.slug }).from(s.posts)
    .innerJoin(s.departments, eq(s.departments.id, s.posts.departmentId)).where(eq(s.posts.status, 'published'));
  if (live.some((p) => labPath(p.dep, p.slug) === from)) throw new SaveError('Esse endereço é de uma publicação no ar: a página continuaria aparecendo no lugar do redirecionamento.', 'from');
  await addRedirect(from, to);
  return { from, to };
}

export async function setRedirectActive(id: number, active: boolean) {
  await db().update(s.redirects).set({ active }).where(eq(s.redirects.id, id));
}

export async function deleteRedirect(id: number) {
  await db().delete(s.redirects).where(eq(s.redirects.id, id));
}
