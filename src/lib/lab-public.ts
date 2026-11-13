// Lab público: lê do banco, na hora do build, só o que está publicado (ou agendado com a data já passada).
// O formato imita o das antigas coleções de conteúdo (entry.id e entry.data), para as páginas mudarem pouco.
import { and, eq, inArray, lte, or, type SQL } from 'drizzle-orm';
import { Marked } from 'marked';
import { markedBlocks } from './rich-blocks';
import { dataItems, KIND_LABEL } from './data-items';
import GithubSlugger from 'github-slugger';
import { departments as staticDepartments, areas as staticAreas } from '../lab/data';
import { db, schema as s } from '../db/client';

export interface LabEntry {
  id: string;   // <departamento>/<slug>
  postId: string;
  body: string;
  data: {
    title: string; code: string | null; department: string; description: string;
    date: Date; updated?: Date; author: string; areas: string[]; tags: string[];
    level: string; status: 'concept' | 'in-progress' | 'active' | 'completed' | 'archived'; format: string | null;
    related: string[]; references: { title: string; url?: string; author?: string; publisher?: string; publishedOn?: string; accessedOn?: string }[];
    draft: boolean;   // "não mostrar no Google": a página existe, mas fica fora do índice e do sitemap
    readingMinutes: number | null; methodology: string | null; aiAssistance: string | null;
    seo: { metaTitle: string | null; metaDescription: string | null; canonicalUrl: string | null; schemaType: string | null };
    cover: { url: string; alt: string; width: number | null; height: number | null } | null;
    attachments: { url: string; title: string; caption: string | null; size: number; mime: string }[];
  };
}

let cache: Promise<LabEntry[]> | undefined;
// no build, uma consulta serve todas as páginas; em desenvolvimento, cada página lê de novo
const live = () => or(eq(s.posts.status, 'published'), and(eq(s.posts.status, 'scheduled'), lte(s.posts.scheduledAt, new Date())));
export const getLabEntries = () => (import.meta.env.DEV ? load(live()) : (cache ??= load(live())));
// no servidor (pré-visualização), sempre do banco: o cache acima é para o build

export const getLabEntriesFresh = () => load(live());

// Pré-visualização no admin: monta uma publicação em qualquer status, do jeito que ela vai aparecer no site
export async function getPreviewEntry(id: string) {
  const [entry] = await load(eq(s.posts.id, id));
  return entry ?? null;
}

async function load(filter: SQL | undefined): Promise<LabEntry[]> {
  if (!process.env.DATABASE_URL) {
    console.warn('[lab] DATABASE_URL ausente: o Lab público sai sem publicações neste build.');
    return [];
  }
  const rows = await db().select({ p: s.posts, dep: s.departments.slug, author: s.authors.name, seo: s.seoMetadata, cover: s.media })
    .from(s.posts)
    .innerJoin(s.departments, eq(s.departments.id, s.posts.departmentId))
    .innerJoin(s.authors, eq(s.authors.id, s.posts.authorId))
    .leftJoin(s.seoMetadata, eq(s.seoMetadata.postId, s.posts.id))
    .leftJoin(s.media, eq(s.media.id, s.posts.coverMediaId))
    .where(filter);
  if (!rows.length) return [];

  const ids = rows.map((r) => r.p.id);
  const [areaRows, tagRows, refRows, relRows, attRows] = await Promise.all([
    db().select({ postId: s.postAreas.postId, name: s.areas.name }).from(s.postAreas).innerJoin(s.areas, eq(s.areas.id, s.postAreas.areaId)).where(inArray(s.postAreas.postId, ids)),
    db().select({ postId: s.postTags.postId, name: s.tags.name }).from(s.postTags).innerJoin(s.tags, eq(s.tags.id, s.postTags.tagId)).where(inArray(s.postTags.postId, ids)),
    db().select({ postId: s.postReferences.postId, title: s.references.title, url: s.references.url, author: s.references.author, publisher: s.references.publisher, publishedOn: s.references.publishedOn, accessedOn: s.references.accessedOn, sort: s.postReferences.sortOrder })
      .from(s.postReferences).innerJoin(s.references, eq(s.references.id, s.postReferences.referenceId)).where(inArray(s.postReferences.postId, ids)),
    db().select().from(s.postRelations).where(or(inArray(s.postRelations.fromPostId, ids), inArray(s.postRelations.toPostId, ids))),
    db().select({ postId: s.postMedia.postId, sort: s.postMedia.sortOrder, url: s.media.url, alt: s.media.alt, caption: s.media.caption, size: s.media.size, mime: s.media.mime })
      .from(s.postMedia).innerJoin(s.media, eq(s.media.id, s.postMedia.mediaId)).where(and(inArray(s.postMedia.postId, ids), eq(s.postMedia.role, 'attachment'))),
  ]);
  const group = <T extends { postId: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) m.set(x.postId, [...(m.get(x.postId) ?? []), x]);
    return m;
  };
  const areasBy = group(areaRows), tagsBy = group(tagRows), refsBy = group(refRows), attBy = group(attRows);
  const targets = [...new Set(relRows.flatMap((r) => [r.fromPostId, r.toPostId]))];
  const codeRows = targets.length ? await db().select({ id: s.posts.id, code: s.posts.code }).from(s.posts).where(inArray(s.posts.id, targets)) : [];
  const codeOf = new Map([...codeRows.map((r) => [r.id, r.code] as const), ...rows.map((r) => [r.p.id, r.p.code] as const)]);
  const day = (d: Date) => d.toISOString().slice(0, 10);

  return rows.map(({ p, dep, author, seo, cover }) => {
    const date = p.publishedAt ?? p.scheduledAt ?? p.createdAt;
    const related = relRows.filter((r) => r.fromPostId === p.id).map((r) => codeOf.get(r.toPostId)).filter((c): c is string => Boolean(c));
    return {
      id: `${dep}/${p.slug}`,
      postId: p.id,
      body: p.body,
      data: {
        title: p.title, code: p.code, department: dep, description: p.summary, date,
        updated: day(p.updatedAt) > day(date) ? p.updatedAt : undefined,
        author, areas: (areasBy.get(p.id) ?? []).map((a) => a.name), tags: (tagsBy.get(p.id) ?? []).map((t) => t.name),
        level: p.level, status: p.stage, format: p.format, related,
        references: (refsBy.get(p.id) ?? []).sort((a, b) => a.sort - b.sort).map((r) => ({ title: r.title, url: r.url ?? undefined, author: r.author ?? undefined, publisher: r.publisher ?? undefined, publishedOn: r.publishedOn ?? undefined, accessedOn: r.accessedOn ?? undefined })),
        draft: seo?.noindex ?? false, readingMinutes: p.readingMinutes, methodology: p.methodology, aiAssistance: p.aiAssistance,
        seo: { metaTitle: seo?.metaTitle ?? null, metaDescription: seo?.metaDescription ?? null, canonicalUrl: seo?.canonicalUrl ?? null, schemaType: seo?.schemaType ?? null },
        cover: cover ? { url: cover.url, alt: cover.alt ?? '', width: cover.width, height: cover.height } : null,
        attachments: (attBy.get(p.id) ?? []).sort((a, b) => a.sort - b.sort).map((a) => ({ url: a.url, title: a.alt || 'Arquivo', caption: a.caption, size: a.size, mime: a.mime })),
      },
    } satisfies LabEntry;
  }).sort((a, b) => +b.data.date - +a.data.date);
}

const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = (v: string) => v.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Markdown do corpo em HTML, com âncoras nos títulos (o sumário da publicação usa os de nível 2).
// Com dataBase (ex.: "/dados/minha-publicacao/"), cada tabela, planilha, gráfico, diagrama e apresentação ganha,
// logo abaixo, o link para a página própria dos dados.
export function renderMarkdown(md: string, ctx: { dataBase?: string } = {}) {
  const slugger = new GithubSlugger();
  const headings: { depth: number; slug: string; text: string }[] = [];
  const marked = new Marked({
    gfm: true,
    // blocos ricos: gráfico, diagrama, equação e círculo (":::nome {atributos} :::" numa linha própria)
    extensions: markedBlocks(),
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const text = decode(html);
        const slug = slugger.slug(text);
        headings.push({ depth, slug, text });
        return `<h${depth} id="${slug}">${html}</h${depth}>\n`;
      },
      // imagens do corpo: carregam só perto da tela, sem travar o resto da página
      image({ href, title, text }) {
        return `<img src="${attr(href)}" alt="${attr(text)}"${title ? ` title="${attr(title)}"` : ''} loading="lazy" decoding="async">`;
      },
    },
  });
  const tokens = marked.lexer(md);
  if (ctx.dataBase) {
    const items = dataItems(md).filter((it) => it.kind !== 'foto');
    for (const it of [...items].reverse()) {
      const link = `<p class="lab-data-link"><a href="${attr(ctx.dataBase + it.slug)}/">${KIND_LABEL[it.kind]}: ${attr(it.name)} — ver os dados</a></p>\n`;
      tokens.splice(it.tokenIndex + 1, 0, { type: 'html', block: true, raw: link, text: link, pre: false } as any);
    }
  }
  const html = marked.parser(tokens) as string;
  return { html, headings };
}

// Perfil do autor (editável em /admin/perfil/): alimenta os dados estruturados de autoria do Lab
export interface AuthorProfile { name: string; jobTitle: string | null; bio: string | null; specialties: string[]; sameAs: string[] }
const fallbackAuthor: AuthorProfile = { name: 'Hallan', jobTitle: 'Designer e desenvolvedor de sites', bio: null, specialties: [], sameAs: [] };
let authorCache: Promise<AuthorProfile> | undefined;
export const getAuthor = () => (import.meta.env.DEV ? loadAuthor() : (authorCache ??= loadAuthor()));
async function loadAuthor(): Promise<AuthorProfile> {
  if (!process.env.DATABASE_URL) return fallbackAuthor;
  const [a] = await db().select().from(s.authors).where(eq(s.authors.slug, 'hallan'));
  return a ? { name: a.name, jobTitle: a.jobTitle, bio: a.bio, specialties: a.specialties, sameAs: a.sameAs } : fallbackAuthor;
}

// Person do schema.org; o @id liga autor, editor e site numa só identidade para o Google
export function authorLd(site: URL | undefined, a: AuthorProfile) {
  return {
    '@type': 'Person',
    '@id': new URL('/#hallan', site).href,
    name: a.name,
    url: new URL('/', site).href,
    ...(a.jobTitle ? { jobTitle: a.jobTitle } : {}),
    ...(a.bio ? { description: a.bio.split(/\n\s*\n/)[0].slice(0, 300) } : {}),
    ...(a.specialties.length ? { knowsAbout: a.specialties } : {}),
    ...(a.sameAs.length ? { sameAs: a.sameAs } : {}),
  };
}

// Catálogo editável no admin (/admin/catalogo/): frases e descrições dos departamentos e a lista de assuntos.
// Nome, código, ícone e endereço dos departamentos continuam fixos em lab/data.ts.
type PublicDepartment = Omit<(typeof staticDepartments)[number], 'short' | 'about'> & { short: string; about: string };
type PublicCatalog = { departments: PublicDepartment[]; areas: { name: string; about: string }[] };
let catalogCache: Promise<PublicCatalog> | undefined;
export const getCatalogPublic = () => (import.meta.env.DEV ? loadCatalog() : (catalogCache ??= loadCatalog()));
async function loadCatalog(): Promise<PublicCatalog> {
  if (!process.env.DATABASE_URL) return { departments: [...staticDepartments], areas: staticAreas.map((a) => ({ name: a.name, about: a.about })) };
  const [deps, areas] = await Promise.all([
    db().select({ slug: s.departments.slug, short: s.departments.short, about: s.departments.about }).from(s.departments),
    db().select({ name: s.areas.name, about: s.areas.about }).from(s.areas).orderBy(s.areas.id),
  ]);
  const bySlug = new Map(deps.map((d) => [d.slug, d]));
  return {
    departments: staticDepartments.map((d) => ({ ...d, short: bySlug.get(d.slug)?.short ?? d.short, about: bySlug.get(d.slug)?.about ?? d.about })),
    areas,
  };
}

// Rota das páginas de dados de uma publicação: /dados/<slug>/ (com o departamento na frente se dois tiverem o mesmo slug)
export function dataSlugOf(entry: LabEntry, all: LabEntry[]) {
  const slug = entry.id.split('/').pop()!;
  return all.some((e) => e.id !== entry.id && e.id.split('/').pop() === slug) ? `${entry.data.department}-${slug}` : slug;
}
