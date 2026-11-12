// Publicações no admin: validação do que o editor envia, leitura completa, gravação atômica e versões.
// Cada gravação vira uma linha em `revisions` com a cópia inteira, para comparar e restaurar depois (spec 6.3).
import { z } from 'astro/zod';
import { and, asc, desc, eq, like, ne, inArray } from 'drizzle-orm';
import { db, schema as s } from '../db/client';
import { isLive, triggerRebuild } from './rebuild';
import { addRedirect, postPath } from './redirects';

const CODE = /^(EXP|FN|RES|VA|LAB|OBS)-\d{3}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const optText = (max: number) => z.string().trim().max(max).nullable().transform((v) => v || null);

export const postInput = z.object({
  title: z.string().trim().min(1, 'Dê um título.').max(200),
  summary: z.string().trim().max(300),
  body: z.string().max(200_000),
  departmentId: z.number().int(),
  contentTypeId: z.number().int().nullable(),
  status: z.enum(['idea', 'draft', 'review', 'scheduled', 'published', 'archived']),
  stage: z.enum(['concept', 'in-progress', 'active', 'completed', 'archived']),
  level: z.enum(['Introdutório', 'Intermediário', 'Aprofundado']),
  format: z.enum(['Essay', 'Observation', 'Idea', 'Tutorial', 'Opinion']).nullable(),
  code: z.string().trim().nullable().transform((v) => v || null).refine((v) => v === null || CODE.test(v), 'Código no formato EXP-001.'),
  slug: z.string().trim().max(100).regex(SLUG, 'Use letras minúsculas, números e hífens.'),
  areaIds: z.array(z.number().int()).max(8),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  relatedProject: optText(120),
  methodology: optText(2000),
  aiAssistance: optText(2000),
  coverMediaId: z.uuid().nullable().default(null),
  // spec 7.3: fontes citadas, na ordem em que aparecem no fim da publicação
  references: z.array(z.object({
    id: z.number().int().nullable().default(null),
    title: z.string().trim().min(1, 'Toda referência precisa de título.').max(300),
    author: optText(200), url: z.string().trim().nullable().transform((v) => v || null).refine((v) => v === null || /^https?:\/\/\S+$/.test(v), 'O link da referência precisa começar com https://'),
    sourceType: optText(40), publisher: optText(200), publishedOn: optText(40), accessedOn: optText(40),
  })).max(50).default([]),
  // spec 7.1: ligações com outras publicações do Lab
  relations: z.array(z.object({ postId: z.uuid(), kind: z.enum(['related', 'origin', 'documents', 'continues']) })).max(12).default([]),
  scheduledAt: z.string().nullable().transform((v) => (v ? new Date(v) : null)).refine((d) => d === null || !isNaN(+d), 'Data inválida.'),
  seo: z.object({
    metaTitle: optText(70),
    metaDescription: optText(200),
    canonicalUrl: z.string().trim().nullable().transform((v) => v || null).refine((v) => v === null || /^https:\/\/\S+$/.test(v), 'URL canônica precisa começar com https://'),
    noindex: z.boolean(),
    schemaType: z.enum(['Article', 'TechArticle', 'BlogPosting', 'CreativeWork', 'Report']).nullable(),
  }),
});
export type PostInput = z.infer<typeof postInput>;
export type PostDraft = z.input<typeof postInput>;

export class SaveError extends Error {
  constructor(message: string, public field?: string, public status = 400) { super(message); }
}

export const slugify = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);

const words = (md: string) => md.replace(/[#>*_`[\]()!-]/g, ' ').split(/\s+/).filter(Boolean).length;

// Opções dos selects do editor
export async function editorOptions() {
  const [deps, types, areas, posts] = await Promise.all([
    db().select().from(s.departments).orderBy(asc(s.departments.sortOrder)),
    db().select().from(s.contentTypes).orderBy(asc(s.contentTypes.id)),
    db().select().from(s.areas).orderBy(asc(s.areas.id)),
    db().select({ id: s.posts.id, code: s.posts.code, title: s.posts.title, status: s.posts.status }).from(s.posts).orderBy(desc(s.posts.updatedAt)),
  ]);
  return { departments: deps, contentTypes: types, areas, posts };
}

export async function loadPost(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db().select().from(s.posts).leftJoin(s.seoMetadata, eq(s.seoMetadata.postId, s.posts.id)).where(eq(s.posts.id, id));
  if (!row) return null;
  const [areaRows, tagRows, revs, refRows, relRows] = await Promise.all([
    db().select({ id: s.postAreas.areaId }).from(s.postAreas).where(eq(s.postAreas.postId, id)),
    db().select({ name: s.tags.name }).from(s.postTags).innerJoin(s.tags, eq(s.tags.id, s.postTags.tagId)).where(eq(s.postTags.postId, id)),
    listRevisions(id),
    db().select({ r: s.references, sort: s.postReferences.sortOrder }).from(s.postReferences)
      .innerJoin(s.references, eq(s.references.id, s.postReferences.referenceId)).where(eq(s.postReferences.postId, id)).orderBy(asc(s.postReferences.sortOrder)),
    db().select({ postId: s.postRelations.toPostId, kind: s.postRelations.kind }).from(s.postRelations).where(eq(s.postRelations.fromPostId, id)),
  ]);
  const p = row.posts, seo = row.seo_metadata;
  const draft: PostDraft = {
    title: p.title, summary: p.summary, body: p.body, departmentId: p.departmentId, contentTypeId: p.contentTypeId,
    status: p.status, stage: p.stage, level: p.level, format: p.format as PostDraft['format'], code: p.code, slug: p.slug,
    areaIds: areaRows.map((a) => a.id), tags: tagRows.map((t) => t.name), relatedProject: p.relatedProject,
    methodology: p.methodology, aiAssistance: p.aiAssistance, scheduledAt: p.scheduledAt?.toISOString() ?? null, coverMediaId: p.coverMediaId,
    references: refRows.map(({ r }) => ({ id: r.id, title: r.title, author: r.author, url: r.url, sourceType: r.sourceType, publisher: r.publisher, publishedOn: r.publishedOn, accessedOn: r.accessedOn })),
    relations: relRows.map((r) => ({ postId: r.postId, kind: r.kind as 'related' })),
    seo: {
      metaTitle: seo?.metaTitle ?? null, metaDescription: seo?.metaDescription ?? null, canonicalUrl: seo?.canonicalUrl ?? null,
      noindex: seo?.noindex ?? false, schemaType: (seo?.schemaType ?? null) as PostDraft['seo']['schemaType'],
    },
  };
  const [cover] = p.coverMediaId ? await db().select().from(s.media).where(eq(s.media.id, p.coverMediaId)) : [];
  return { id: p.id, draft, cover: cover ?? null, createdAt: p.createdAt, updatedAt: p.updatedAt, publishedAt: p.publishedAt, revisions: revs };
}

export function listRevisions(postId: string) {
  return db().select({ id: s.revisions.id, login: s.revisions.login, note: s.revisions.note, createdAt: s.revisions.createdAt })
    .from(s.revisions).where(eq(s.revisions.postId, postId)).orderBy(desc(s.revisions.id)).limit(50);
}

// Próximo código livre do departamento (EXP-003 se já existem EXP-001 e EXP-002)
export async function nextCode(departmentId: number) {
  const [dep] = await db().select().from(s.departments).where(eq(s.departments.id, departmentId));
  if (!dep) return null;
  const rows = await db().select({ code: s.posts.code }).from(s.posts).where(like(s.posts.code, `${dep.code}-%`));
  const max = rows.reduce((m, r) => Math.max(m, Number(r.code?.split('-')[1]) || 0), 0);
  return `${dep.code}-${String(max + 1).padStart(3, '0')}`;
}

async function checkUnique(input: PostInput, id: string | null) {
  const [dep] = await db().select().from(s.departments).where(eq(s.departments.id, input.departmentId));
  if (!dep) throw new SaveError('Departamento inválido.', 'departmentId');
  if (input.code && !input.code.startsWith(`${dep.code}-`)) throw new SaveError(`Em ${dep.name} o código começa com ${dep.code}-.`, 'code');
  if (input.format && dep.slug !== 'field-notes') input.format = null;
  const notSelf = id ? ne(s.posts.id, id) : undefined;
  const [sameSlug] = await db().select({ id: s.posts.id }).from(s.posts).where(and(eq(s.posts.departmentId, input.departmentId), eq(s.posts.slug, input.slug), notSelf));
  if (sameSlug) throw new SaveError('Já existe uma publicação com esse endereço neste departamento.', 'slug', 409);
  if (input.code) {
    const [sameCode] = await db().select({ id: s.posts.id }).from(s.posts).where(and(eq(s.posts.code, input.code), notSelf));
    if (sameCode) throw new SaveError(`O código ${input.code} já está em uso.`, 'code', 409);
  }
  if (input.status === 'scheduled' && !input.scheduledAt) throw new SaveError('Escolha a data do agendamento.', 'scheduledAt');
  if (input.coverMediaId) {
    const [m] = await db().select({ kind: s.media.kind }).from(s.media).where(eq(s.media.id, input.coverMediaId));
    if (!m || m.kind !== 'image') throw new SaveError('A imagem de capa não foi encontrada. Escolha outra.', 'cover');
  }
}

async function tagIds(names: string[]) {
  const unique = [...new Map(names.map((n) => [slugify(n), n])).entries()].filter(([slug]) => slug);
  if (!unique.length) return [];
  await db().insert(s.tags).values(unique.map(([slug, name]) => ({ slug, name }))).onConflictDoNothing();
  const rows = await db().select({ id: s.tags.id }).from(s.tags).where(inArray(s.tags.slug, unique.map(([slug]) => slug)));
  return rows.map((r) => r.id);
}

// Grava tudo de uma vez (transação do Neon): publicação, assuntos, tags, SEO e a versão
export async function savePost(opts: { id: string | null; input: PostInput; login: string; baseUpdatedAt?: string | null; note?: string }) {
  const { input, login } = opts;
  let id = opts.id;
  let publishedAt: Date | null = null;
  let wasLive = false;
  let oldPath: string | null = null;
  if (id) {
    const [cur] = await db().select({ updatedAt: s.posts.updatedAt, publishedAt: s.posts.publishedAt, status: s.posts.status, scheduledAt: s.posts.scheduledAt, slug: s.posts.slug, departmentId: s.posts.departmentId }).from(s.posts).where(eq(s.posts.id, id));
    if (!cur) throw new SaveError('Publicação não encontrada.', undefined, 404);
    if (opts.baseUpdatedAt && +new Date(opts.baseUpdatedAt) !== +cur.updatedAt) {
      throw new SaveError('Esta publicação foi alterada em outra aba. Recarregue a página antes de salvar.', undefined, 409);
    }
    publishedAt = cur.publishedAt;
    wasLive = isLive(cur.status, cur.scheduledAt);
    if (wasLive) oldPath = await postPath(cur.departmentId, cur.slug);
  }
  await checkUnique(input, id);
  const tags = await tagIds(input.tags);
  const now = new Date();
  if (input.status === 'published' && !publishedAt) publishedAt = now;
  const [author] = await db().select({ id: s.authors.id }).from(s.authors).where(eq(s.authors.slug, 'hallan'));

  const values = {
    title: input.title, summary: input.summary, body: input.body, departmentId: input.departmentId, contentTypeId: input.contentTypeId,
    status: input.status, stage: input.stage, level: input.level, format: input.format, code: input.code, slug: input.slug,
    relatedProject: input.relatedProject, methodology: input.methodology, aiAssistance: input.aiAssistance, coverMediaId: input.coverMediaId,
    scheduledAt: input.status === 'scheduled' ? input.scheduledAt : null, publishedAt,
    readingMinutes: Math.max(1, Math.ceil(words(input.body) / 200)), updatedAt: now,
  };
  const isNew = !id;
  if (!id) id = crypto.randomUUID();
  // referências: as que já existem são atualizadas (valem para todas as publicações que as citam); as novas são criadas
  const refIds: number[] = [];
  for (const r of input.references) {
    const data = { title: r.title, author: r.author, url: r.url, sourceType: r.sourceType, publisher: r.publisher, publishedOn: r.publishedOn, accessedOn: r.accessedOn };
    const [row] = r.id
      ? await db().update(s.references).set(data).where(eq(s.references.id, r.id)).returning({ id: s.references.id })
      : [];
    refIds.push(row?.id ?? (await db().insert(s.references).values(data).returning({ id: s.references.id }))[0].id);
  }
  input.references = input.references.map((r, i) => ({ ...r, id: refIds[i] }));
  const relations = [...new Map(input.relations.filter((r) => r.postId !== id).map((r) => [r.postId, r])).values()];
  if (relations.length) {
    const found = await db().select({ id: s.posts.id }).from(s.posts).where(inArray(s.posts.id, relations.map((r) => r.postId)));
    if (found.length !== relations.length) throw new SaveError('Uma das publicações relacionadas não existe mais. Remova e escolha de novo.', 'relations');
  }
  const snapshot = { ...input, relations, scheduledAt: input.scheduledAt?.toISOString() ?? null };
  const none = () => db().select({ x: s.posts.id }).from(s.posts).limit(0);
  const [, , , , , , revision] = await db().batch([
    isNew ? db().insert(s.posts).values({ ...values, id, authorId: author.id, createdAt: now }) : db().update(s.posts).set(values).where(eq(s.posts.id, id)),
    db().delete(s.postAreas).where(eq(s.postAreas.postId, id)),
    db().delete(s.postTags).where(eq(s.postTags.postId, id)),
    input.areaIds.length ? db().insert(s.postAreas).values(input.areaIds.map((areaId) => ({ postId: id!, areaId }))).onConflictDoNothing() : db().select({ x: s.posts.id }).from(s.posts).limit(0),
    tags.length ? db().insert(s.postTags).values(tags.map((tagId) => ({ postId: id!, tagId }))).onConflictDoNothing() : db().select({ x: s.posts.id }).from(s.posts).limit(0),
    db().insert(s.seoMetadata).values({ postId: id, ...input.seo }).onConflictDoUpdate({ target: s.seoMetadata.postId, set: input.seo }),
    db().insert(s.revisions).values({ postId: id, snapshot, login, note: opts.note ?? null }).returning({ id: s.revisions.id }),
    db().insert(s.adminLog).values({ login, action: isNew ? 'post.create' : 'post.save', target: id }),
    db().delete(s.postReferences).where(eq(s.postReferences.postId, id)),
    refIds.length ? db().insert(s.postReferences).values(refIds.map((referenceId, sortOrder) => ({ postId: id!, referenceId, sortOrder }))).onConflictDoNothing() : none(),
    db().delete(s.postRelations).where(eq(s.postRelations.fromPostId, id)),
    relations.length ? db().insert(s.postRelations).values(relations.map((r) => ({ fromPostId: id!, toPostId: r.postId, kind: r.kind }))) : none(),
  ]);
  // estava no ar e mudou de endereço: o antigo passa a redirecionar (301) para o novo
  const newPath = await postPath(values.departmentId, values.slug);
  const redirected = oldPath && newPath && oldPath !== newPath ? oldPath : null;
  if (redirected) await addRedirect(redirected, newPath!);
  // só gera o site de novo se a publicação estava ou passou a estar no ar
  const site = wasLive || isLive(values.status, values.scheduledAt, now) ? await triggerRebuild(login, id) : null;
  return { id, updatedAt: now.toISOString(), revisionId: (revision as { id: number }[])[0]?.id, site, redirected, refIds };
}

// Exclusão definitiva: some do banco com versões, ligações e SEO (as imagens continuam na biblioteca de mídia)
export async function deletePost(id: string, login: string) {
  const [cur] = await db().select({ status: s.posts.status, scheduledAt: s.posts.scheduledAt, title: s.posts.title, slug: s.posts.slug, departmentId: s.posts.departmentId }).from(s.posts).where(eq(s.posts.id, id));
  if (!cur) throw new SaveError('Publicação não encontrada.', undefined, 404);
  const path = await postPath(cur.departmentId, cur.slug);
  await db().batch([
    db().delete(s.redirects).where(eq(s.redirects.toPath, path ?? '')),   // nada redireciona para uma página que deixou de existir
    db().delete(s.posts).where(eq(s.posts.id, id)),
    db().insert(s.adminLog).values({ login, action: 'post.delete', target: `${id} ${cur.title}`.slice(0, 300) }),
  ]);
  const site = isLive(cur.status, cur.scheduledAt) ? await triggerRebuild(login, `exclusão ${id}`) : null;
  return { site };
}

export async function revisionSnapshot(postId: string, revisionId: number) {
  const [rev] = await db().select().from(s.revisions).where(and(eq(s.revisions.postId, postId), eq(s.revisions.id, revisionId)));
  return rev ?? null;
}
