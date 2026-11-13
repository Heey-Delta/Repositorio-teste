// Blocos ricos das publicações. No Markdown, cada um ocupa uma linha própria:
//   :::shape {kind="STAR" text="Novo" fill="#FBBF00" width="200" height="200" align="center"} :::
//   :::chart {type="COLUMN" title="Vendas" data="Mês;Vendas&#10;Jan;120" colors="#FBBF00,#F2F2EE" width="640"} :::
//   :::diagram {type="ORGCHART" outline="Diretoria&#10;  Vendas"} :::
//   :::math {tex="E = mc^2"} :::
//   :::picture {src="https://…" alt="Descrição" width="320" align="right"} :::   (imagem redimensionada)
//   :::circle {text="112%" color="#FBBF00" size="180"} :::                     (formato antigo; continua valendo)
// Todos aceitam width (px) e align (left, center, right). O editor (Tiptap) e o site (marked) usam estas funções:
// o que se vê no editor é o que vai ao ar. Gráficos e diagramas vêm do motor (SVG); equações em MathML (KaTeX).
import katex from 'katex';
import { chartSvg, diagramSvg, type SvgTheme } from '../editor-core/io/svg.ts';
import { layoutDiagram } from '../editor-core/ops/diagram.ts';
import type { ChartData } from '../editor-core/charts/chart.ts';
import { circleHtml, circleInk, parseCircleAttrs } from './circle-block.ts';
import { SHAPES, shapeKind, shapeSvg } from '../editor-core/io/shapes.ts';

/** Mesmas cores e fonte do site (shared.css): fundo do texto, tinta, cinza, linhas e o amarelo de destaque. */
export const SITE_THEME: SvgTheme = {
  bg: 'none', ink: '#F2F2EE', muted: '#A6A6A0', grid: '#2B2B2B', axis: '#5C5C58', font: 'Arial, Helvetica, sans-serif',
  nodeFill: '#000000', nodeStroke: '#FBBF00', link: '#A6A6A0', sliceStroke: '#000000',
  palette: ['#FBBF00', '#F2F2EE', '#A6A6A0', '#8A6A00', '#5C5C58', '#FFE08A'],
};

export const BLOCK_NAMES = ['shape', 'chart', 'diagram', 'math', 'picture', 'slides', 'circle'] as const;
export type BlockName = (typeof BLOCK_NAMES)[number];
const NAMES = BLOCK_NAMES.join('|');
export const BLOCK_RE = new RegExp(`^ {0,3}:::(${NAMES})(?:\\s+\\{([^}]*)\\})?\\s*:::(?:\\n|$)`);

// ---------------------------------------------------------------- atributos (sem "{", "}" nem quebra de linha crus)
const enc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace(/\r?\n/g, '&#10;');
const dec = (v: string) => v.replace(/&#10;/g, '\n').replace(/&#123;/g, '{').replace(/&#125;/g, '}').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
export function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = dec(m[2]);
  return out;
}
export const serializeAttrs = (a: Record<string, unknown>) => Object.entries(a).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}="${enc(String(v))}"`).join(' ');
export const blockMarkdown = (name: BlockName, a: Record<string, unknown>) => `:::${name} {${serializeAttrs(a)}} :::`;

const esc = (v: string) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const color = (v: unknown, fallback: string) => (/^#[0-9a-f]{3,8}$/i.test(String(v ?? '')) ? String(v) : fallback);
const px = (v: unknown, min: number, max: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : null; };

/** Largura e alinhamento comuns a todos os blocos. */
export const ALIGNS: [string, string][] = [['center', 'Centro'], ['left', 'Esquerda'], ['right', 'Direita']];
function box(a: Record<string, unknown>, fallbackWidth?: number) {
  const w = px(a.width, 40, 1200) ?? fallbackWidth ?? null;
  const al = a.align === 'left' ? 'margin-right:auto;margin-left:0' : a.align === 'right' ? 'margin-left:auto;margin-right:0' : 'margin-inline:auto';
  return `${w ? `max-width:${w}px;` : ''}${al}`;
}

// ---------------------------------------------------------------- formas
/** Mesma biblioteca de formas do motor (Documentos e Apresentações): o desenho é idêntico nos três lugares. */
export const SHAPE_KINDS: [string, string][] = Object.entries(SHAPES).map(([k, v]) => [k, v.label]);
export interface ShapeAttrs { kind: string; text: string; fill: string; stroke: string; textColor: string; width: string; height: string; align: string }
export const SHAPE_DEFAULT: ShapeAttrs = { kind: 'RECTANGLE', text: '', fill: '#FBBF00', stroke: '', textColor: '', width: '240', height: '140', align: 'center' };

export function shapeHtml(a: Partial<ShapeAttrs>) {
  const kind = shapeKind(a.kind);
  const spec = SHAPES[kind];
  let w = px(a.width, 20, 1200) ?? 240, h = px(a.height, 4, 1200) ?? (spec.square ? w : 140);
  if (kind === 'SQUARE' || kind === 'CIRCLE') h = w;
  if (spec.open) h = Math.min(h, 40);
  const fill = color(a.fill, '#FBBF00');
  const stroke = a.stroke ? color(a.stroke, '') : '';
  const svg = `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true" overflow="visible">${shapeSvg({ shapeType: kind }, w, h, { fill, stroke: stroke || undefined, strokeWidth: spec.open ? 4 : 3 })}</svg>`;
  const ink = color(a.textColor, circleInk(fill));
  const label = esc(a.text || spec.label);
  return `<div class="lab-shape" role="img" aria-label="${label}" style="${box(a, w)};aspect-ratio:${w}/${h};--fs:${Math.round(Math.min(w, h) / 5)}px;color:${ink}">${svg}${a.text && !spec.open ? `<span>${esc(a.text)}</span>` : ''}</div>`;
}

// ---------------------------------------------------------------- gráfico
export const CHART_KINDS: [string, string][] = [['COLUMN', 'Colunas'], ['BAR', 'Barras'], ['LINE', 'Linhas'], ['AREA', 'Área'], ['PIE', 'Pizza'], ['DOUGHNUT', 'Rosca']];
export interface ChartAttrs { type: string; title: string; data: string; colors: string; width: string; align: string }
export const CHART_DEFAULT: ChartAttrs = { type: 'COLUMN', title: 'Vendas por mês', data: 'Mês;Vendas;Custos\nJan;120;80\nFev;180;95\nMar;150;90', colors: '', width: '', align: 'center' };

/** "Mês;Vendas\nJan;120" → categorias e séries (primeira linha = nomes; primeira coluna = categorias). */
export function parseChartData(text: string) {
  const rows = text.split(/\r?\n|\|/).map((l) => l.split(/;|\t/).map((c) => c.trim())).filter((r) => r.some(Boolean));
  const [head = [], ...body] = rows;
  const num = (v: string) => { const t = v.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); const n = Number(t); return t !== '' && Number.isFinite(n) ? n : null; };
  const categories = body.map((r) => r[0] ?? '');
  const series = head.slice(1).map((name, i) => ({ name: name || `Série ${i + 1}`, values: body.map((r) => num(r[i + 1] ?? '')) }));
  return { categories, series };
}
export function chartHtml(a: Partial<ChartAttrs>) {
  const type = CHART_KINDS.some(([k]) => k === a.type) ? a.type! : 'COLUMN';
  const { categories, series } = parseChartData(a.data ?? '');
  if (!series.length || !categories.length) return `<figure class="lab-chart lab-chart-empty" style="${box(a)}"><p>Gráfico sem dados.</p></figure>`;
  const own = String(a.colors ?? '').split(',').map((c) => c.trim()).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
  const theme = own.length ? { ...SITE_THEME, palette: [...own, ...SITE_THEME.palette] } : SITE_THEME;
  const d: ChartData = { chartType: type as ChartData['chartType'], categories, series: series.map((s, i) => ({ id: `s${i}`, name: s.name, values: s.values, visible: true, axis: 'PRIMARY' })), warnings: [] };
  const svg = chartSvg(d, a.title ?? '', 640, 360, theme).replace('<svg ', `<svg role="img" aria-label="${esc(a.title || 'Gráfico')}" `);
  return `<figure class="lab-chart" style="${box(a)}">${svg}</figure>`;
}

// ---------------------------------------------------------------- diagrama
export const DIAGRAM_KINDS: [string, string][] = [['ORGCHART', 'Organograma'], ['FLOWCHART', 'Fluxograma'], ['MINDMAP', 'Mapa mental'], ['PROCESS', 'Processo (em linha)'], ['CYCLE', 'Ciclo']];
export interface DiagramAttrs { type: string; outline: string; width: string; align: string }
export const DIAGRAM_DEFAULT: DiagramAttrs = { type: 'ORGCHART', outline: 'Diretoria\n  Vendas\n    Loja A\n    Loja B\n  Tecnologia\n  Financeiro', width: '', align: 'center' };

/** Tópicos com recuo (2 espaços, tab ou "-" por nível) → itens com hierarquia. */
function outlineItems(text: string) {
  const items: { id: string; label: string; parentId: string | null }[] = [];
  const stack: { level: number; id: string }[] = [];
  text.split(/\r?\n|\|/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const lead = raw.match(/^[\s-]*/)![0];
    const level = (lead.match(/-/g)?.length ?? 0) + Math.floor(lead.replace(/-/g, '').replace(/\t/g, '  ').length / 2);
    while (stack.length && stack.at(-1)!.level >= level) stack.pop();
    const id = `d${i}`;
    items.push({ id, label: raw.trim().replace(/^[-*•]\s*/, '').slice(0, 60), parentId: stack.at(-1)?.id ?? null });
    stack.push({ level, id });
  });
  return items.slice(0, 60);
}
export function diagramHtml(a: Partial<DiagramAttrs>) {
  const type = DIAGRAM_KINDS.some(([k]) => k === a.type) ? a.type! : 'ORGCHART';
  const items = outlineItems(a.outline ?? '');
  if (!items.length) return `<figure class="lab-diagram lab-chart-empty" style="${box(a)}"><p>Diagrama sem tópicos.</p></figure>`;
  const d = layoutDiagram({ diagramType: type, items, connections: [] });
  const svg = diagramSvg(d, SITE_THEME).replace('<svg ', `<svg role="img" aria-label="${esc(items.map((x) => x.label).join(', '))}" `);
  return `<figure class="lab-diagram" style="${box(a)}">${svg}</figure>`;
}

// ---------------------------------------------------------------- equação
export interface MathAttrs { tex: string; width: string; align: string }
export function mathHtml(a: Partial<MathAttrs>) {
  // MathML: o navegador desenha sozinho, sem CSS nem fontes extras
  const html = katex.renderToString(a.tex ?? '', { displayMode: true, throwOnError: false, output: 'mathml' });
  const al = a.align === 'left' ? 'left' : a.align === 'right' ? 'right' : 'center';
  return `<div class="lab-math" style="text-align:${al}">${html}</div>`;
}

// ---------------------------------------------------------------- imagem com tamanho e alinhamento
export interface PictureAttrs { src: string; alt: string; width: string; align: string }
export function pictureHtml(a: Partial<PictureAttrs>) {
  const src = String(a.src ?? '');
  if (!/^(https?:|\/|data:image\/)/.test(src)) return '';
  return `<figure class="lab-figure" style="${box(a)}"><img src="${esc(src)}" alt="${esc(a.alt ?? '')}" loading="lazy" decoding="async"></figure>`;
}

// ---------------------------------------------------------------- apresentação (slides passáveis dentro do trabalho)
// Cada slide é um quadro 16:9 com itens posicionados em % (título em Anton, texto em Arial, imagem e forma).
// O tamanho da letra é em % da largura do slide (cqw): o slide inteiro escala junto, do celular à tela grande.
export interface SlideItem { id: string; type: 'title' | 'text' | 'image' | 'shape'; x: number; y: number; w: number; h: number; text?: string; src?: string; alt?: string; kind?: string; fill?: string; color?: string; size?: number; align?: 'left' | 'center' | 'right'; bold?: boolean }
export interface Slide { id: string; bg?: string; items: SlideItem[] }
export interface Deck { ratio?: '16:9' | '4:3'; slides: Slide[] }
let seq = 0;
export const newId = (p = 'i') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
export const slideTemplate = (kind: 'cover' | 'content' | 'image' | 'blank' = 'content'): Slide => {
  const T = (text: string, y: number, h: number, size: number, align: SlideItem['align'] = 'left'): SlideItem => ({ id: newId(), type: 'title', x: 6, y, w: 88, h, text, size, color: '#F2F2EE', align });
  const X = (text: string, x: number, y: number, w: number, h: number, size = 2.4, align: SlideItem['align'] = 'left'): SlideItem => ({ id: newId(), type: 'text', x, y, w, h, text, size, color: '#A6A6A0', align });
  if (kind === 'cover') return { id: newId('s'), bg: '#000000', items: [{ id: newId(), type: 'shape', kind: 'RECTANGLE', x: 6, y: 30, w: 6, h: 1.2, fill: '#FBBF00' }, T('Título da apresentação', 34, 22, 7.5), X('Subtítulo ou autor', 6, 62, 88, 10, 2.6)] };
  if (kind === 'image') return { id: newId('s'), bg: '#000000', items: [T('Título', 8, 14, 4.6), { id: newId(), type: 'image', x: 6, y: 26, w: 52, h: 64, src: '', alt: '' }, X('- Ponto principal\n- Outro ponto', 62, 28, 32, 60)] };
  if (kind === 'blank') return { id: newId('s'), bg: '#000000', items: [] };
  return { id: newId('s'), bg: '#000000', items: [T('Título do slide', 8, 14, 4.6), X('- Primeiro ponto\n- Segundo ponto\n- Terceiro ponto', 6, 28, 88, 62, 2.6)] };
};
export const DECK_DEFAULT = (): Deck => ({ ratio: '16:9', slides: [slideTemplate('cover'), slideTemplate('content')] });
export function parseDeck(v: unknown): Deck {
  try { const d = typeof v === 'string' ? JSON.parse(v) : v; if (d && Array.isArray((d as Deck).slides)) return d as Deck; } catch { /* vazio */ }
  return { ratio: '16:9', slides: [] };
}
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
const textHtml = (t: string) => {
  const lines = esc(t).split('\n');
  const bullets = lines.filter((l) => /^\s*[-•]\s+/.test(l));
  if (bullets.length && bullets.length === lines.filter((l) => l.trim()).length) return `<ul>${lines.filter((l) => l.trim()).map((l) => `<li>${l.replace(/^\s*[-•]\s+/, '')}</li>`).join('')}</ul>`;
  return lines.map((l) => (/^\s*[-•]\s+/.test(l) ? `• ${l.replace(/^\s*[-•]\s+/, '')}` : l)).join('<br>');
};
/** Um item do slide em HTML (posição e tamanho em %). */
export function slideItemHtml(it: SlideItem) {
  const pos = `left:${num(it.x, 0)}%;top:${num(it.y, 0)}%;width:${num(it.w, 20)}%;height:${num(it.h, 10)}%`;
  const font = `font-size:${num(it.size, it.type === 'title' ? 4.6 : 2.4)}cqw;color:${color(it.color, it.type === 'title' ? '#F2F2EE' : '#A6A6A0')};text-align:${it.align ?? 'left'}${it.bold ? ';font-weight:700' : ''}`;
  if (it.type === 'title') return `<h3 class="lab-si lab-si-title" data-item="${esc(it.id)}" style="${pos};${font}">${esc(it.text ?? '')}</h3>`;
  if (it.type === 'text') return `<div class="lab-si lab-si-text" data-item="${esc(it.id)}" style="${pos};${font}">${textHtml(it.text ?? '')}</div>`;
  if (it.type === 'image') return it.src && /^(https?:|\/|data:image\/)/.test(it.src) ? `<img class="lab-si lab-si-img" data-item="${esc(it.id)}" style="${pos}" src="${esc(it.src)}" alt="${esc(it.alt ?? '')}" loading="lazy" decoding="async">` : `<div class="lab-si lab-si-img lab-si-empty" data-item="${esc(it.id)}" style="${pos}">Imagem</div>`;
  const kind = shapeKind(it.kind);
  return `<div class="lab-si lab-si-shape" data-item="${esc(it.id)}" style="${pos}" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${shapeSvg({ shapeType: kind }, 100, 100, { fill: color(it.fill, '#FBBF00') })}</svg>${it.text ? `<span style="${font}">${esc(it.text)}</span>` : ''}</div>`;
}
export function slideHtml(sl: Slide, i: number, total: number, ratio = '16:9') {
  return `<div class="lab-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} de ${total}" style="background:${color(sl.bg, '#000000')};aspect-ratio:${ratio.replace(':', '/')}">${(sl.items ?? []).map(slideItemHtml).join('')}</div>`;
}
export interface SlidesAttrs { deck: string; width: string; align: string }
export function slidesHtml(a: Partial<SlidesAttrs>) {
  const d = parseDeck(a.deck);
  const n = d.slides.length;
  if (!n) return `<section class="lab-deck lab-chart-empty" style="${box(a)}"><p>Apresentação sem slides.</p></section>`;
  return `<section class="lab-deck" data-deck aria-roledescription="apresentação" aria-label="Apresentação com ${n} slides" style="${box(a)}">`
    + `<div class="lab-deck-track" tabindex="0">${d.slides.map((sl, i) => slideHtml(sl, i, n, d.ratio)).join('')}</div>`
    + (n > 1 ? `<div class="lab-deck-nav"><button type="button" data-deck-prev aria-label="Slide anterior">Anterior</button><span data-deck-count aria-live="polite">1 / ${n}</span><button type="button" data-deck-next aria-label="Próximo slide">Próximo</button></div>` : '')
    + `</section>`;
}
/** Liga os botões e o contador de uma apresentação já na página (site e editor). */
export function wireDeck(root: ParentNode) {
  for (const deck of root.querySelectorAll<HTMLElement>('[data-deck]')) {
    if (deck.dataset.wired) continue;
    deck.dataset.wired = '1';
    const track = deck.querySelector<HTMLElement>('.lab-deck-track')!, count = deck.querySelector<HTMLElement>('[data-deck-count]');
    const total = track.children.length;
    const at = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    const go = (i: number) => track.scrollTo({ left: Math.max(0, Math.min(total - 1, i)) * track.clientWidth, behavior: 'smooth' });
    deck.querySelector('[data-deck-prev]')?.addEventListener('click', () => go(at() - 1));
    deck.querySelector('[data-deck-next]')?.addEventListener('click', () => go(at() + 1));
    track.addEventListener('scroll', () => { if (count) count.textContent = `${at() + 1} / ${total}`; }, { passive: true });
    track.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowRight') { ev.preventDefault(); go(at() + 1); } if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(at() - 1); } });
  }
}

/** Qualquer bloco → HTML (usado pelo site e pela pré-visualização do editor). */
export function blockHtml(name: BlockName, attrs: Record<string, string>) {
  if (name === 'circle') return circleHtml(parseCircleAttrs(Object.entries(attrs).map(([k, v]) => `${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join(' ')));
  if (name === 'shape') return shapeHtml(attrs);
  if (name === 'chart') return chartHtml(attrs);
  if (name === 'diagram') return diagramHtml(attrs);
  if (name === 'picture') return pictureHtml(attrs);
  if (name === 'slides') return slidesHtml(attrs);
  return mathHtml(attrs);
}

/** Extensão do marked: o site entende todos os blocos. */
export const markedBlocks = () => [{
  name: 'richBlock', level: 'block' as const,
  start(src: string) { const i = src.search(new RegExp(`^ {0,3}:::(${NAMES})`, 'm')); return i < 0 ? undefined : i; },
  tokenizer(src: string) { const m = BLOCK_RE.exec(src); return m ? { type: 'richBlock', raw: m[0], block: m[1] as BlockName, attrs: parseAttrs(m[2] ?? '') } : undefined; },
  renderer(t: any) { return `${blockHtml(t.block, t.attrs)}\n`; },
}, {
  // ":::align {value="center"}" … ":::" — parágrafos alinhados (centro, direita ou justificado)
  name: 'alignBlock', level: 'block' as const,
  start(src: string) { const i = src.search(/^:::align\b/m); return i < 0 ? undefined : i; },
  tokenizer(this: any, src: string) {
    const m = /^:::align(?:\s+\{([^}]*)\})?[ \t]*\n([\s\S]*?)\n:::[ \t]*(?:\n|$)/.exec(src);
    if (!m) return undefined;
    const value = ['center', 'right', 'justify', 'left'].includes(parseAttrs(m[1] ?? '').value) ? parseAttrs(m[1] ?? '').value : 'center';
    return { type: 'alignBlock', raw: m[0], value, tokens: this.lexer.blockTokens(m[2], []) };
  },
  renderer(this: any, t: any) { return `<div class="lab-align" style="text-align:${t.value}">${this.parser.parse(t.tokens)}</div>\n`; },
}];
