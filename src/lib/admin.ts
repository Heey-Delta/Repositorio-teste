// Textos e consultas compartilhados pelas telas do admin
import { and, desc, eq, count, ilike, or } from 'drizzle-orm';
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

export async function listPosts(opts: { status?: EditorialStatus; q?: string; limit?: number } = {}) {
  // busca por trecho do título, do código, do endereço ou do resumo (sem diferenciar maiúsculas)
  const term = opts.q?.trim() ? `%${opts.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const search = term ? or(ilike(s.posts.title, term), ilike(s.posts.code, term), ilike(s.posts.slug, term), ilike(s.posts.summary, term)) : undefined;
  const q = db().select({
    id: s.posts.id, code: s.posts.code, slug: s.posts.slug, title: s.posts.title, status: s.posts.status, stage: s.posts.stage,
    updatedAt: s.posts.updatedAt, department: s.departments.name, departmentSlug: s.departments.slug,
    responsible: s.posts.responsible, scheduledAt: s.posts.scheduledAt,
  }).from(s.posts).innerJoin(s.departments, eq(s.posts.departmentId, s.departments.id))
    .where(and(opts.status ? eq(s.posts.status, opts.status) : undefined, search))
    .orderBy(desc(s.posts.updatedAt));
  return opts.limit ? q.limit(opts.limit) : q;
}
