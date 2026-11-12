// Diagnóstico de SEO e GEO das publicações e do perfil do autor (módulo SEO & GEO do admin).
// SEO: o Google entender e mostrar bem a página. GEO: buscadores com IA entenderem, confiarem e citarem o conteúdo.
import { count, eq, inArray, ne } from 'drizzle-orm';
import { db, schema as s } from '../db/client';

export type Check = { id: string; group: 'SEO' | 'GEO'; ok: boolean; level: 'erro' | 'aviso'; label: string; fix: string };

const words = (md: string) => md.replace(/[#>*_`[\]()!-]/g, ' ').split(/\s+/).filter(Boolean).length;

export async function auditPosts() {
  const rows = await db().select({ p: s.posts, dep: s.departments.slug, seo: s.seoMetadata, coverAlt: s.media.alt })
    .from(s.posts)
    .innerJoin(s.departments, eq(s.departments.id, s.posts.departmentId))
    .leftJoin(s.seoMetadata, eq(s.seoMetadata.postId, s.posts.id))
    .leftJoin(s.media, eq(s.media.id, s.posts.coverMediaId))
    .where(ne(s.posts.status, 'archived'));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.p.id);
  const tally = async (table: typeof s.postAreas | typeof s.postTags | typeof s.postReferences) => {
    const r = await db().select({ id: table.postId, n: count() }).from(table).where(inArray(table.postId, ids)).groupBy(table.postId);
    return new Map(r.map((x) => [x.id, x.n]));
  };
  const [areas, tags, refs, relFrom, relTo] = await Promise.all([
    tally(s.postAreas), tally(s.postTags), tally(s.postReferences),
    db().select({ id: s.postRelations.fromPostId }).from(s.postRelations).where(inArray(s.postRelations.fromPostId, ids)),
    db().select({ id: s.postRelations.toPostId }).from(s.postRelations).where(inArray(s.postRelations.toPostId, ids)),
  ]);
  const linked = new Set([...relFrom, ...relTo].map((r) => r.id));

  return rows.map(({ p, dep, seo, coverAlt }) => {
    const title = seo?.metaTitle || p.title;
    const desc = seo?.metaDescription || p.summary;
    const h2 = (p.body.match(/^## /gm) ?? []).length;
    const w = words(p.body);
    const deep = dep === 'research' || dep === 'experiments';
    const checks: Check[] = [
      { id: 'title', group: 'SEO', level: 'erro', ok: title.length >= 15 && title.length <= 60, label: `Título no Google com ${title.length} caracteres`, fix: 'Entre 15 e 60 caracteres, para não ser cortado no resultado. Use "Título no Google" em Detalhes se o título da página for longo.' },
      { id: 'desc', group: 'SEO', level: 'erro', ok: desc.length >= 70 && desc.length <= 160, label: `Descrição com ${desc.length} caracteres`, fix: 'Entre 70 e 160 caracteres: o resumo (ou a "Descrição no Google") é o texto que aparece embaixo do título no Google.' },
      { id: 'slug', group: 'SEO', level: 'aviso', ok: p.slug.split('-').length <= 7, label: 'Endereço curto', fix: 'Até 7 palavras no endereço, só as que dizem do que se trata.' },
      { id: 'cover', group: 'SEO', level: 'aviso', ok: Boolean(p.coverMediaId && coverAlt), label: 'Imagem de capa com texto alternativo', fix: 'A capa vira a imagem dos compartilhamentos e aparece na busca de imagens.' },
      { id: 'sections', group: 'SEO', level: 'aviso', ok: h2 >= 2, label: `${h2} ${h2 === 1 ? 'seção' : 'seções'} (título H2) no texto`, fix: 'Divida o texto em pelo menos 2 seções com "Título de seção" (H2): ajuda a leitura, o sumário e o Google.' },
      { id: 'length', group: 'SEO', level: 'aviso', ok: w >= 300, label: `${w} palavras`, fix: 'Textos com menos de 300 palavras raramente aparecem bem na busca. Se for uma nota curta de propósito, tudo bem.' },
      { id: 'areas', group: 'SEO', level: 'erro', ok: (areas.get(p.id) ?? 0) > 0, label: 'Ao menos um assunto', fix: 'Marque os assuntos em Detalhes: eles ligam a publicação ao resto do Lab.' },
      { id: 'index', group: 'SEO', level: 'aviso', ok: !seo?.noindex, label: 'Liberada para o Google', fix: '"Não mostrar no Google" está marcado em Detalhes.' },
      { id: 'refs', group: 'GEO', level: deep ? 'erro' : 'aviso', ok: (refs.get(p.id) ?? 0) > 0, label: 'Fontes citadas', fix: 'Referências mostram de onde vem o conhecimento; IAs e o Google confiam mais em conteúdo com fontes.' },
      { id: 'method', group: 'GEO', level: deep ? 'erro' : 'aviso', ok: Boolean(p.methodology), label: 'Como foi feito (metodologia)', fix: 'Explique em poucas linhas como o experimento ou a pesquisa foi feita: é o que diferencia conteúdo original.' },
      { id: 'links', group: 'GEO', level: 'aviso', ok: linked.has(p.id), label: 'Ligada a outras publicações', fix: 'Relacione com publicações próximas (Detalhes → Publicações relacionadas): forma a rede de assuntos do Lab.' },
      { id: 'tags', group: 'GEO', level: 'aviso', ok: (tags.get(p.id) ?? 0) > 0, label: 'Tags', fix: 'Tags com os termos específicos ajudam a busca do Lab e o entendimento do tema.' },
      { id: 'summary', group: 'GEO', level: 'aviso', ok: /[.!?]$/.test(p.summary.trim()) && p.summary.trim().split(/\s+/).length >= 8, label: 'Resumo responde em frase completa', fix: 'Uma ou duas frases completas que respondem "do que se trata". É o trecho que buscadores com IA mais aproveitam.' },
    ];
    const passed = checks.filter((c) => c.ok).length;
    return { id: p.id, title: p.title || 'Sem título', code: p.code, status: p.status, score: Math.round((passed / checks.length) * 100), checks };
  }).sort((a, b) => a.score - b.score);
}

export async function auditAuthor() {
  const [a] = await db().select().from(s.authors).where(eq(s.authors.slug, 'hallan'));
  if (!a) return [];
  return [
    { id: 'bio', group: 'GEO', level: 'erro', ok: Boolean(a.bio && a.bio.length >= 80), label: 'Bio com pelo menos 80 caracteres', fix: 'Diga quem você é, o que faz e para quem. Vira a descrição do autor para buscadores e IAs.' },
    { id: 'job', group: 'GEO', level: 'aviso', ok: Boolean(a.jobTitle), label: 'Título profissional', fix: 'Ex.: "Designer e desenvolvedor de sites".' },
    { id: 'same', group: 'GEO', level: 'erro', ok: a.sameAs.filter((u) => !u.includes('vercel.app')).length >= 1, label: 'Perfis em outros sites (LinkedIn, GitHub, Behance…)', fix: 'Ligam a sua identidade entre sites: é como o Google e as IAs confirmam que o autor é você.' },
    { id: 'skills', group: 'GEO', level: 'aviso', ok: a.specialties.length >= 3, label: 'Ao menos 3 especialidades', fix: 'Os temas em que você é referência.' },
  ] satisfies Check[];
}
