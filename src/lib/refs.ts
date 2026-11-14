// Converte a seção "## Referências" escrita como lista numerada (formato antigo) em marcadores de referência
// (:::ref {name url} :::), que o site junta no fim do texto, numerados e com link. Usada pelo build para
// atualizar publicações antigas; não mexe em texto que já usa :::ref.
import { blockMarkdown } from './rich-blocks.ts';

const HEAD = /^##\s+Refer[êe]ncias\s*$/im;

export function refsFromList(body: string): string | null {
  if (/^:::ref\b/m.test(body)) return null;
  const m = HEAD.exec(body);
  if (!m) return null;
  const start = m.index, after = start + m[0].length;
  const next = body.slice(after).search(/^#{1,2}\s/m);
  const end = next < 0 ? body.length : after + next;
  const items = body.slice(after, end).split('\n').map((l) => /^\s*\d+[.)]\s+(.*)$/.exec(l)?.[1]).filter((x): x is string => !!x);
  if (!items.length) return null;
  const refs = items.map((t) => {
    // o link é o último [texto](url) ou endereço solto da linha
    const md = [...t.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)].at(-1);
    const bare = !md ? [...t.matchAll(/https?:\/\/\S+/g)].at(-1) : undefined;
    const hit = md ?? bare;
    const url = md ? md[2] : bare ? bare[0].replace(/[.,;]+$/, '') : '';
    const name = (hit ? t.slice(0, hit.index) + t.slice(hit.index! + hit[0].length) : t).replace(/\s+/g, ' ').replace(/[\s.,;:–-]+$/, '').trim();
    return blockMarkdown('ref', { name: name ? `${name}.` : url, url });
  });
  return `${body.slice(0, start).replace(/\s+$/, '')}\n\n${refs.join('\n\n')}\n${end < body.length ? `\n${body.slice(end)}` : ''}`;
}

// ---------------------------------------------------------------- site: lista do fim e chamadas [n]
const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export interface Ref { name: string; url: string }

/** Tira os blocos :::ref dos tokens do marked (no lugar fica um html vazio, para não mudar as posições). */
export function pullRefs(list: any[], out: Ref[] = []): Ref[] {
  list.forEach((t, k) => {
    if (t.type === 'richBlock' && t.block === 'ref') { out.push({ name: t.attrs.name ?? '', url: t.attrs.url ?? '' }); list[k] = { type: 'html', block: true, raw: '', text: '', pre: false }; }
    else if (t.type === 'alignBlock' && Array.isArray(t.tokens)) pullRefs(t.tokens, out);
  });
  return out;
}

/** Lista numerada do fim: cada item tem id="ref-n" e o nome é o link da fonte. */
export const refsListHtml = (refs: Ref[], slug = 'referencias') =>
  `<h2 id="${slug}">Referências</h2>\n<ol class="lab-refs">${refs.map((r, k) => `<li id="ref-${k + 1}">${r.url ? `<a href="${attr(r.url)}" target="_blank" rel="noopener">${attr(r.name || r.url)}</a>` : attr(r.name)}</li>`).join('')}</ol>\n`;

/** No texto, "[12]" vira link para a referência 12 (fora de links, código, gráficos e equações). */
export function linkCitations(html: string, n: number) {
  let skip = 0;
  return html.split(/(<[^>]+>)/).map((part) => {
    if (part.startsWith('<')) {
      const m = /^<(\/?)(a|code|pre|svg|math|script|style)\b/i.exec(part);
      if (m && !part.endsWith('/>')) skip = Math.max(0, skip + (m[1] ? -1 : 1));
      return part;
    }
    if (skip) return part;
    return part.replace(/\[(\d{1,3})\]/g, (all, d) => { const k = Number(d); return k >= 1 && k <= n ? `<a href="#ref-${k}" class="lab-cite">${all}</a>` : all; });
  }).join('');
}
