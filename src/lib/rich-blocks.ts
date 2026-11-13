// Blocos ricos das publicações (gráfico, diagrama, equação e círculo). No Markdown, cada um ocupa uma linha:
//   :::chart {type="COLUMN" title="Vendas" data="Mês;Vendas|Jan;120|Fev;180"} :::
//   :::diagram {type="ORGCHART" outline="Diretoria|-Vendas|-TI"} :::
//   :::math {tex="E = mc^2"} :::
//   :::circle {text="112%" color="#FBBF00" size="180"} :::
// O editor (Tiptap) e o site (marked) usam estas funções: o que se vê no editor é o que vai ao ar.
// Os desenhos vêm do motor do editor (src/editor-core): gráficos e diagramas em SVG, equações em MathML (KaTeX).
import katex from 'katex';
import { chartSvg, diagramSvg, type SvgTheme } from '../editor-core/io/svg.ts';

/** Mesmas cores e fonte do site (shared.css): fundo do texto, tinta, cinza, linhas e o amarelo de destaque. */
export const SITE_THEME: SvgTheme = {
  bg: 'none', ink: '#F2F2EE', muted: '#A6A6A0', grid: '#2B2B2B', axis: '#5C5C58', font: 'Arial, Helvetica, sans-serif',
  nodeFill: '#000000', nodeStroke: '#FBBF00', link: '#A6A6A0', sliceStroke: '#000000',
  palette: ['#FBBF00', '#F2F2EE', '#A6A6A0', '#8A6A00', '#5C5C58', '#FFE08A'],
};
import { layoutDiagram } from '../editor-core/ops/diagram.ts';
import type { ChartData } from '../editor-core/charts/chart.ts';
import { circleHtml, parseCircleAttrs } from './circle-block.ts';

export const BLOCK_NAMES = ['circle', 'chart', 'diagram', 'math'] as const;
export type BlockName = (typeof BLOCK_NAMES)[number];
export const BLOCK_RE = /^ {0,3}:::(circle|chart|diagram|math)(?:\s+\{([^}]*)\})?\s*:::(?:\n|$)/;

// ---------------------------------------------------------------- atributos (sem "{", "}" nem quebra de linha crus)
const enc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace(/\r?\n/g, '&#10;');
const dec = (v: string) => v.replace(/&#10;/g, '\n').replace(/&#123;/g, '{').replace(/&#125;/g, '}').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
export function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = dec(m[2]);
  return out;
}
export const serializeAttrs = (a: Record<string, unknown>) => Object.entries(a).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}="${enc(String(v))}"`).join(' ');
export const blockMarkdown = (name: BlockName, a: Record<string, unknown>) => `:::${name} {${serializeAttrs(a)}} :::`;

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- gráfico
export const CHART_KINDS: [string, string][] = [['COLUMN', 'Colunas'], ['BAR', 'Barras'], ['LINE', 'Linhas'], ['AREA', 'Área'], ['PIE', 'Pizza'], ['DOUGHNUT', 'Rosca']];
export interface ChartAttrs { type: string; title: string; data: string }
export const CHART_DEFAULT: ChartAttrs = { type: 'COLUMN', title: 'Vendas por mês', data: 'Mês;Vendas;Custos\nJan;120;80\nFev;180;95\nMar;150;90' };

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
  if (!series.length || !categories.length) return `<figure class="lab-chart lab-chart-empty"><p>Gráfico sem dados.</p></figure>`;
  const d: ChartData = { chartType: type as ChartData['chartType'], categories, series: series.map((s, i) => ({ id: `s${i}`, name: s.name, values: s.values, visible: true, axis: 'PRIMARY' })), warnings: [] };
  const svg = chartSvg(d, a.title ?? '', 640, 360, SITE_THEME).replace('<svg ', `<svg role="img" aria-label="${esc(a.title || 'Gráfico')}" `);
  return `<figure class="lab-chart">${svg}</figure>`;
}

// ---------------------------------------------------------------- diagrama
export const DIAGRAM_KINDS: [string, string][] = [['ORGCHART', 'Organograma'], ['FLOWCHART', 'Fluxograma'], ['MINDMAP', 'Mapa mental'], ['PROCESS', 'Processo (em linha)'], ['CYCLE', 'Ciclo']];
export interface DiagramAttrs { type: string; outline: string }
export const DIAGRAM_DEFAULT: DiagramAttrs = { type: 'ORGCHART', outline: 'Diretoria\n  Vendas\n    Loja A\n    Loja B\n  Tecnologia\n  Financeiro' };

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
  if (!items.length) return `<figure class="lab-diagram lab-chart-empty"><p>Diagrama sem tópicos.</p></figure>`;
  const d = layoutDiagram({ diagramType: type, items, connections: [] });
  const svg = diagramSvg(d, SITE_THEME).replace('<svg ', `<svg role="img" aria-label="${esc(items.map((x) => x.label).join(', '))}" `);
  return `<figure class="lab-diagram">${svg}</figure>`;
}

// ---------------------------------------------------------------- equação
export interface MathAttrs { tex: string }
export function mathHtml(a: Partial<MathAttrs>) {
  // MathML: o navegador desenha sozinho, sem CSS nem fontes extras
  const html = katex.renderToString(a.tex ?? '', { displayMode: true, throwOnError: false, output: 'mathml' });
  return `<div class="lab-math">${html}</div>`;
}

/** Qualquer bloco → HTML (usado pelo site e pela pré-visualização do editor). */
export function blockHtml(name: BlockName, attrs: Record<string, string>) {
  if (name === 'circle') return circleHtml(parseCircleAttrs(Object.entries(attrs).map(([k, v]) => `${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join(' ')));
  if (name === 'chart') return chartHtml(attrs);
  if (name === 'diagram') return diagramHtml(attrs);
  return mathHtml(attrs);
}

/** Extensão do marked: o site entende os quatro blocos. */
export const markedBlocks = () => [{
  name: 'richBlock', level: 'block' as const,
  start(src: string) { const i = src.search(/^ {0,3}:::(circle|chart|diagram|math)/m); return i < 0 ? undefined : i; },
  tokenizer(src: string) { const m = BLOCK_RE.exec(src); return m ? { type: 'richBlock', raw: m[0], block: m[1] as BlockName, attrs: parseAttrs(m[2] ?? '') } : undefined; },
  renderer(t: any) { return `${blockHtml(t.block, t.attrs)}\n`; },
}];
