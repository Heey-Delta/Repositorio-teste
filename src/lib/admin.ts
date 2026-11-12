// Textos e consultas compartilhados pelas telas do admin
import { desc, eq, count } from 'drizzle-orm';
import { db, schema as s } from '../db/client';

export const statusLabel = {
  idea: 'Ideia', draft: 'Rascunho', review: 'Revisão', scheduled: 'Agendado', published: 'Publicado', archived: 'Arquivado',
} as const;
export type EditorialStatus = keyof typeof statusLabel;
export const statusOrder = Object.keys(statusLabel) as EditorialStatus[];

export const fmtDateTime = (d: Date) => d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

export async function countsByStatus() {
  const rows = await db().select({ status: s.posts.status, n: count() }).from(s.posts).groupBy(s.posts.status);
  const map = Object.fromEntries(statusOrder.map((k) => [k, 0])) as Record<EditorialStatus, number>;
  for (const r of rows) map[r.status] = r.n;
  return map;
}

export async function listPosts(opts: { status?: EditorialStatus; limit?: number } = {}) {
  const q = db().select({
    id: s.posts.id, code: s.posts.code, slug: s.posts.slug, title: s.posts.title, status: s.posts.status, stage: s.posts.stage,
    updatedAt: s.posts.updatedAt, department: s.departments.name, departmentSlug: s.departments.slug,
  }).from(s.posts).innerJoin(s.departments, eq(s.posts.departmentId, s.departments.id))
    .where(opts.status ? eq(s.posts.status, opts.status) : undefined)
    .orderBy(desc(s.posts.updatedAt));
  return opts.limit ? q.limit(opts.limit) : q;
}
