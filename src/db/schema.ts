// Banco do Experimental Lab (Postgres na Neon). Entidades da especificação funcional, seção 4.
// Mudou algo aqui? Rode `npm run db:generate` para criar a migração em drizzle/; o build do Vercel aplica.
import {
  pgTable, pgEnum, text, integer, bigint, boolean, timestamp, jsonb, uuid, serial, primaryKey, uniqueIndex, index, vector,
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
  jobTitle: text('job_title'),
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
  responsible: text('responsible'),   // quem cuida da publicação na fila de produção (login ou nome)
  layout: jsonb('layout').$type<Record<string, unknown>>(),   // layout da página e regras de formatação (src/lib/page-layout.ts)
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

// ---------------------------------------------------------------- editor unificado (documentos, apresentações, planilhas)
// O documento inteiro fica em JSON (o motor é a fonte da verdade); `version` sobe a cada gravação e serve para a
// concorrência otimista (grava só se ninguém salvou antes). As ações guardam o que mudou em cada gravação
// (recuperação e auditoria) e servem de relé para a colaboração (ordem = seq).
export const editorDocuments = pgTable('editor_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  application: text('application').notNull(),
  doc: jsonb('doc').notNull(),
  version: integer('version').notNull().default(1),
  owner: text('owner').notNull(),
  createdAt: created(),
  updatedAt: updated(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('editor_documents_owner').on(t.owner, t.updatedAt)]);

export const editorVersions = pgTable('editor_versions', {
  id: serial('id').primaryKey(),
  documentId: uuid('document_id').notNull().references(() => editorDocuments.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  doc: jsonb('doc').notNull(),
  createdBy: text('created_by'),
  createdAt: created(),
}, (t) => [index('editor_versions_doc').on(t.documentId, t.createdAt)]);

export const editorActions = pgTable('editor_actions', {
  seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  documentId: uuid('document_id').notNull().references(() => editorDocuments.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),            // 'save' (gravação) | 'sync' (transação de colaborador)
  clientId: text('client_id'),
  version: integer('version'),
  entries: jsonb('entries').notNull(),
  login: text('login'),
  createdAt: created(),
}, (t) => [index('editor_actions_doc').on(t.documentId, t.seq)]);

// Documentos do editor publicados no site (/p/<slug>): o HTML é gerado na hora de publicar a partir da versão
// gravada; republicar atualiza. `indexable` decide se o Google pode indexar (padrão: não).
export const editorPublications = pgTable('editor_publications', {
  slug: text('slug').primaryKey(),
  documentId: uuid('document_id').notNull().unique().references(() => editorDocuments.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  html: text('html').notNull(),
  indexable: boolean('indexable').notNull().default(false),
  publishedAt: created(),
  updatedAt: updated(),
});

// ---------- Volumes do Lab ----------
// Coletânea de publicações escolhidas pelo autor, com capa (opcional) e página própria indexável (/lab/volumes/<slug>/).
export const volumes = pgTable('volumes', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  coverMediaId: uuid('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),   // draft | published (só publicado aparece no site)
  sortOrder: integer('sort_order').notNull().default(0),
  // experiência do volume (jogo, protótipo, página interativa): o botão aparece na página do volume quando há link
  experienceUrl: text('experience_url').notNull().default(''),
  experienceLabel: text('experience_label').notNull().default(''),
  createdAt: created(),
  updatedAt: updated(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});
export const volumePosts = pgTable('volume_posts', {
  volumeId: uuid('volume_id').notNull().references(() => volumes.id, { onDelete: 'cascade' }),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.volumeId, t.postId] })]);

// ---------- Curtidas ----------
// Uma por visitante (cookie anônimo) e publicação; ip_hash (sha-256 com sal) só limita abuso, não identifica ninguém.
export const postLikes = pgTable('post_likes', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  visitor: text('visitor').notNull(),
  ipHash: text('ip_hash'),
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.postId, t.visitor] }), index('post_likes_ip').on(t.ipHash, t.createdAt)]);

// ---------- Busca por significado ----------
// Vetor (embedding) do texto de cada publicação e volume: a busca compara o sentido, não só as letras
// ("inteligência artificial" encontra "IA"; "cérebro" encontra "neurônios artificiais"). `hash` evita recalcular.
export const searchVectors = pgTable('search_vectors', {
  kind: text('kind').notNull(),        // post | volume
  refId: text('ref_id').notNull(),
  hash: text('hash').notNull(),
  model: text('model').notNull(),
  embedding: vector('embedding', { dimensions: 512 }).notNull(),
  updatedAt: updated(),
}, (t) => [primaryKey({ columns: [t.kind, t.refId] })]);

// ---------- Página inicial ----------
// Configurações editáveis no admin (/admin/inicio/): stacks, cursos e volumes em destaque. Uma linha por chave.
export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updated(),
});
