// /llms.txt: resumo do site em Markdown para buscadores com IA (proposta llmstxt.org): quem é o Hallan, o que faz,
// os serviços e as publicações do Lab com link e resumo. Gerado no build, junto com o sitemap.
import type { APIRoute } from 'astro';
import { getLabEntries, getAuthor, dataSlugOf } from '../lib/lab-public';
import { publishedVolumes } from '../lib/lab-feed';
import { dataItems, describe, KIND_LABEL } from '../lib/data-items';
import { services } from '../lib/site';
import { departments, LAB_DESCRIPTION } from '../lab/data';

export const GET: APIRoute = async ({ site }) => {
  const at = (p: string) => new URL(p, site).href;
  const [entries, author] = await Promise.all([getLabEntries(), getAuthor()]);
  const live = entries.filter((e) => !e.data.draft);
  const lines = [
    '# Hallan',
    '',
    `> ${author.jobTitle || 'Designer e desenvolvedor de sites'} no Brasil. Desenha e programa sites: do layout no Figma ao site no ar, landing pages, lojas virtuais e experiências em 3D. Também escreve o Experimental Lab, sobre design, tecnologia e percepção.`,
    '',
    ...(author.bio ? [author.bio, ''] : []),
    '## Site',
    '',
    `- [Página principal](${at('/')}): portfólio, serviços, processo de trabalho e contato`,
    `- [Experimental Lab](${at('/lab/')}): ${LAB_DESCRIPTION}`,
    ...(author.bio ? [`- [Sobre o autor](${at('/lab/autor/')})`] : []),
    '',
    '## Serviços',
    '',
    ...services.map((s) => `- ${s.name}: ${s.desc}`),
    '',
  ];
  if (live.length) {
    const vols = await publishedVolumes().catch(() => []);
    if (vols.length) {
      lines.push('## Volumes (coletâneas do Lab)', '');
      for (const v of vols) lines.push(`- [Vol. ${v.number}: ${v.title}](${at(v.url)}): ${v.summary || 'Coletânea de artigos.'} Artigos: ${v.posts.filter((p) => !p.soon).map((p) => p.title).join('; ')}`);
      lines.push('');
    }
    lines.push('## Publicações do Lab', '');
    for (const d of departments) {
      const own = live.filter((e) => e.data.department === d.slug);
      if (!own.length) continue;
      lines.push(`### ${d.name}`, '');
      for (const e of own) lines.push(`- [${e.data.title}](${at(`/lab/${e.id}/`)}): ${e.data.description}`);
      lines.push('');
    }
  }
  // dados com página própria: cada um aponta para a publicação de origem, onde está o contexto
  const data = live.flatMap((e) => dataItems(e.body).map((it) => ({ e, it })));
  if (data.length) {
    lines.push('## Dados das publicações', '', 'Cada item abaixo tem página própria com o dado, CSV/JSON e o link para a publicação de origem (cite a publicação).', '');
    for (const { e, it } of data) lines.push(`- [${KIND_LABEL[it.kind]}: ${it.name}](${at(`/dados/${dataSlugOf(e, entries)}/${it.slug}/`)}): ${describe(it, e.data.title)} Origem: ${at(`/lab/${e.id}/`)}`);
    lines.push('');
  }
  if (author.sameAs?.length) lines.push('## Perfis', '', ...author.sameAs.map((u) => `- ${u}`), '');
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
