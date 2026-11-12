// Banco do Experimental Lab (Postgres na Neon). Entidades da especificação funcional, seção 4.
// Mudou algo aqui? Rode `npm run db:generate` para criar a migração em drizzle/; o build do Vercel aplica.
import {
  pgTable, pgEnum, text, integer, bigint, boolean, timestamp, jsonb, uuid, serial, primaryKey, uniqueIndex, index,
} from 'drizzle-orm/pg-core';

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// Ciclo editorial (spec 6.2): só `published` aparece no site público e entra no Google
export const editorialStatus = pgEnum('editorial_status', ['idea', 'draft', 'review', 'scheduled', 'published', 'archived']);
// Estágio da pesquisa ou do experimento, mostrado na ficha da publicação
export const researchStage = pgEnum('research_stage', ['concept', 'in-progress', 'active', 'completed', 'archived']);
export const level = pgEnum('level', ['Introdutório', 'Intermediário', 'Aprofundado']);

// ---------- Acesso ao admin ----------
// Só a conta do GitHub em ADMIN_GITHUB_ID entra; o token da sessão fica guardado apenas como hash SHA-256
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  githubId: bigint('github_id', { mode: 'number' }).notNull(),
  login: text('login').notNull(),
  userAgent: text('user_agent'),
  createdAt: created(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const authAttempts = pgTable('auth_attempts', {
  id: serial('id').primaryKey(),
  ip: text('ip').notNull(),
  outcome: text('outcome').notNull(),   // start | ok | denied | error
  createdAt: created(),
}, (t) => [index('auth_attempts_ip_time').on(t.ip, t.createdAt)]);

export const adminLog = pgTable('admin_log', {
  id: serial('id').primaryKey(),
  login: text('login').notNull(),
  action: text('action').notNull(),
  target: text('target'),
  createdAt: created(),
});

// ---------- Identidade ----------
export const authors = pgTable('authors', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  bio: text('bio'),
  specialties: jsonb('specialties').$type<string[]>().notNull().default([]),
  sameAs: jsonb('same_as').$type<string[]>().notNull().default([]),   // portfólio e perfis (dados estruturados Person)
  githubId: bigint('github_id', { mode: 'number' }),
});

// ---------- Catálogos ----------
export const departments = pgTable('departments', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  code: text('code').notNull().unique(),   // prefixo editorial: EXP, FN, RES...
  name: text('name').notNull(),
  short: text('short').notNull(),
  about: text('about').notNull(),
  icon: text('icon').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

// Tipo de conteúdo é independente do departamento (spec 3.2)
export const contentTypes = pgTable('content_types', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
});

export const areas = pgTable('areas', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull().unique(),
  about: text('about').notNull(),
});

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
});

// ---------- Mídia ----------
export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  pathname: text('pathname').notNull(),
  kind: text('kind').notNull(),   // image | video | pdf | document | other
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  alt: text('alt'),
  caption: text('caption'),
  createdAt: created(),
});

// ---------- Publicações ----------
export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').unique(),   // EXP-001... identificador editorial legível, não substitui o id
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  departmentId: integer('department_id').notNull().references(() => departments.id),
  contentTypeId: integer('content_type_id').references(() => contentTypes.id),
  authorId: integer('author_id').notNull().references(() => authors.id),
  summary: text('summary').notNull().default(''),   // resumo curto; vira a meta description se o SEO não tiver outra
  body: text('body').notNull().default(''),   // Markdown
  coverMediaId: uuid('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
  status: editorialStatus('status').notNull().default('idea'),
  stage: researchStage('stage').notNull().default('concept'),
  level: level('level').notNull().default('Introdutório'),
  format: text('format'),   // Field Notes: Essay, Observation, Idea, Tutorial, Opinion
  relatedProject: text('related_project'),   // slug de um trabalho do portfólio
  methodology: text('methodology'),   // transparência editorial (spec 9.4)
  aiAssistance: text('ai_assistance'),
  readingMinutes: integer('reading_minutes'),
  createdAt: created(),
  updatedAt: updated(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('posts_department_slug').on(t.departmentId, t.slug),
  index('posts_status').on(t.status),
]);

export const postAreas = pgTable('post_areas', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  areaId: integer('area_id').notNull().references(() => areas.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.postId, t.areaId] })]);

export const postTags = pgTable('post_tags', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.postId, t.tagId] })]);

export const postMedia = pgTable('post_media', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('gallery'),   // gallery | attachment
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.postId, t.mediaId] })]);

// Metadados de SEO separados do conteúdo editorial (spec 4.3). Vazio = o sistema usa título e resumo.
export const seoMetadata = pgTable('seo_metadata', {
  postId: uuid('post_id').primaryKey().references(() => posts.id, { onDelete: 'cascade' }),
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  canonicalUrl: text('canonical_url'),
  ogMediaId: uuid('og_media_id').references(() => media.id, { onDelete: 'set null' }),
  noindex: boolean('noindex').notNull().default(false),
  schemaType: text('schema_type'),   // Article, TechArticle, BlogPosting, CreativeWork...
});

export const references = pgTable('references', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  author: text('author'),
  url: text('url'),
  sourceType: text('source_type'),   // livro, artigo, site, vídeo...
  publisher: text('publisher'),
  publishedOn: text('published_on'),
  accessedOn: text('accessed_on'),
  createdAt: created(),
});

export const postReferences = pgTable('post_references', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  referenceId: integer('reference_id').notNull().references(() => references.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.postId, t.referenceId] })]);

// Rede de conhecimento: uma pesquisa que originou um experimento, uma apresentação que o documenta...
export const postRelations = pgTable('post_relations', {
  fromPostId: uuid('from_post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  toPostId: uuid('to_post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('related'),   // related | origin | documents | continues
}, (t) => [primaryKey({ columns: [t.fromPostId, t.toPostId] })]);

// Cada salvamento guarda uma cópia completa: dá para comparar e restaurar (spec 6.3)
export const revisions = pgTable('revisions', {
  id: serial('id').primaryKey(),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  snapshot: jsonb('snapshot').notNull(),
  login: text('login').notNull(),
  note: text('note'),
  createdAt: created(),
}, (t) => [index('revisions_post').on(t.postId, t.createdAt)]);

export const redirects = pgTable('redirects', {
  id: serial('id').primaryKey(),
  fromPath: text('from_path').notNull().unique(),
  toPath: text('to_path').notNull(),
  code: integer('code').notNull().default(301),
  active: boolean('active').notNull().default(true),
  createdAt: created(),
});
