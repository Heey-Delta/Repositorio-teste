// Lab público: lê do banco, na hora do build, só o que está publicado (ou agendado com a data já passada).
// O formato imita o das antigas coleções de conteúdo (entry.id e entry.data), para as páginas mudarem pouco.
import { and, eq, inArray, lte, or } from 'drizzle-orm';
import { Marked } from 'marked';
import GithubSlugger from 'github-slugger';
import { db, schema as s } from '../db/client';

export interface LabEntry {
  id: string;   // <departamento>/<slug>
  postId: string;
  body: string;
  data: {
    title: string; code: string | null; department: string; description: string;
    date: Date; updated?: Date; author: string; areas: string[]; tags: string[];
    level: string; status: 'concept' | 'in-progress' | 'active' | 'completed' | 'archived'; format: string | null;
    related: string[]; references: { title: string; url?: string }[];
    draft: boolean;   // "não mostrar no Google": a página existe, mas fica fora do índice e do sitemap
    readingMinutes: number | null; methodology: string | null; aiAssistance: string | null;
    seo: { metaTitle: string | null; metaDescription: string | null; canonicalUrl: string | null; schemaType: string | null };
    cover: { url: string; alt: string; width: number | null; height: number | null } | null;
  };
}

let cache: Promise<LabEntry[]> | undefined;
// no build, uma consulta serve todas as páginas; em desenvolvimento, cada página lê de novo
export const getLabEntries = () => (import.meta.env.DEV ? load() : (cache ??= load()));

async function load(): Promise<LabEntry[]> {
  if (!process.env.DATABASE_URL) {
    console.warn('[lab] DATABASE_URL ausente: o Lab público sai sem publicações neste build.');
    return [];
  }
  const now = new Date();
  const rows = await db().select({ p: s.posts, dep: s.departments.slug, author: s.authors.name, seo: s.seoMetadata, cover: s.media })
    .from(s.posts)
    .innerJoin(s.departments, eq(s.departments.id, s.posts.departmentId))
    .innerJoin(s.authors, eq(s.authors.id, s.posts.authorId))
    .leftJoin(s.seoMetadata, eq(s.seoMetadata.postId, s.posts.id))
    .leftJoin(s.media, eq(s.media.id, s.posts.coverMediaId))
    .where(or(eq(s.posts.status, 'published'), and(eq(s.posts.status, 'scheduled'), lte(s.posts.scheduledAt, now))));
  if (!rows.length) return [];

  const ids = rows.map((r) => r.p.id);
  const [areaRows, tagRows, refRows, relRows] = await Promise.all([
    db().select({ postId: s.postAreas.postId, name: s.areas.name }).from(s.postAreas).innerJoin(s.areas, eq(s.areas.id, s.postAreas.areaId)).where(inArray(s.postAreas.postId, ids)),
    db().select({ postId: s.postTags.postId, name: s.tags.name }).from(s.postTags).innerJoin(s.tags, eq(s.tags.id, s.postTags.tagId)).where(inArray(s.postTags.postId, ids)),
    db().select({ postId: s.postReferences.postId, title: s.references.title, url: s.references.url, sort: s.postReferences.sortOrder })
      .from(s.postReferences).innerJoin(s.references, eq(s.references.id, s.postReferences.referenceId)).where(inArray(s.postReferences.postId, ids)),
    db().select().from(s.postRelations).where(or(inArray(s.postRelations.fromPostId, ids), inArray(s.postRelations.toPostId, ids))),
  ]);
  const group = <T extends { postId: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) m.set(x.postId, [...(m.get(x.postId) ?? []), x]);
    return m;
  };
  const areasBy = group(areaRows), tagsBy = group(tagRows), refsBy = group(refRows);
  const codeOf = new Map(rows.map((r) => [r.p.id, r.p.code]));
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
        references: (refsBy.get(p.id) ?? []).sort((a, b) => a.sort - b.sort).map((r) => ({ title: r.title, url: r.url ?? undefined })),
        draft: seo?.noindex ?? false, readingMinutes: p.readingMinutes, methodology: p.methodology, aiAssistance: p.aiAssistance,
        seo: { metaTitle: seo?.metaTitle ?? null, metaDescription: seo?.metaDescription ?? null, canonicalUrl: seo?.canonicalUrl ?? null, schemaType: seo?.schemaType ?? null },
        cover: cover ? { url: cover.url, alt: cover.alt ?? '', width: cover.width, height: cover.height } : null,
      },
    } satisfies LabEntry;
  }).sort((a, b) => +b.data.date - +a.data.date);
}

const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = (v: string) => v.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Markdown do corpo em HTML, com âncoras nos títulos (o sumário da publicação usa os de nível 2)
export function renderMarkdown(md: string) {
  const slugger = new GithubSlugger();
  const headings: { depth: number; slug: string; text: string }[] = [];
  const marked = new Marked({
    gfm: true,
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
  const html = marked.parse(md, { async: false }) as string;
  return { html, headings };
}
