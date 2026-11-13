// Dados de uma publicação: cada tabela, planilha, gráfico, diagrama, apresentação e foto do corpo vira um "item"
// com rota própria (/dados/<publicação>/<item>/). A ordem e os nomes saem do texto, na mesma ordem em que aparecem,
// então o post, a página de dados, o sitemap e o llms.txt sempre concordam sobre o endereço de cada item.
import { Marked, type Token, type Tokens } from 'marked';
import { markedBlocks, parseChartData, parseDeck, sheetMatrix, slidesHtml, type Deck } from './rich-blocks.ts';

export type DataKind = 'tabela' | 'planilha' | 'grafico' | 'diagrama' | 'apresentacao' | 'foto';
export const KIND_LABEL: Record<DataKind, string> = { tabela: 'Tabela', planilha: 'Planilha', grafico: 'Gráfico', diagrama: 'Diagrama', apresentacao: 'Apresentação', foto: 'Foto' };
type Scalar = string | number | boolean | null;

export interface DataItem {
  kind: DataKind;
  slug: string;
  /** nome dado pelo autor (ou "Tabela 2", "Foto 1"…) */
  name: string;
  /** id estável do bloco (planilha, gráfico, diagrama, apresentação), quando houver */
  id: string | null;
  /** índice entre os blocos de nível de topo do corpo (para pôr o link logo depois) */
  tokenIndex: number;
  /** linhas da tabela (cabeçalho na primeira), para CSV/JSON e para o Dataset */
  rows: Scalar[][];
  /** Markdown original do bloco (a página de dados desenha igual ao post) */
  markdown: string;
  extra: { src?: string; alt?: string; deck?: Deck; chartType?: string; title?: string; outline?: string };
}

export const slugify = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const lexer = () => new Marked({ gfm: true, extensions: markedBlocks() } as any);
const cellText = (c: Tokens.TableCell) => c.text.replace(/\*\*|__|~~|`/g, '').trim();
const num = (v: string): Scalar => { const t = v.trim(); if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$|^-?\d+\.\d+$/.test(t)) { const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(n) ? n : t; } return t; };

/** Lista os itens de dados do corpo, na ordem do texto, com rotas únicas. */
export function dataItems(body: string): DataItem[] {
  const tokens = lexer().lexer(body ?? '');
  const out: DataItem[] = [];
  const count: Partial<Record<DataKind, number>> = {};
  const used = new Set<string>();
  const add = (kind: DataKind, tokenIndex: number, name: string | undefined, id: string | null, rows: Scalar[][], markdown: string, extra: DataItem['extra'] = {}) => {
    count[kind] = (count[kind] ?? 0) + 1;
    const fallback = `${KIND_LABEL[kind]} ${count[kind]}`;
    const label = (name ?? '').trim() || fallback;
    let slug = slugify(name?.trim() ? name : `${kind}-${count[kind]}`) || `${kind}-${count[kind]}`;
    while (used.has(slug)) slug = `${slug}-${count[kind]}`;
    used.add(slug);
    out.push({ kind, slug, name: label, id, tokenIndex, rows, markdown, extra });
  };
  tokens.forEach((t: Token, i: number) => {
    if (t.type === 'table') {
      const tb = t as Tokens.Table;
      add('tabela', i, undefined, null, [tb.header.map(cellText), ...tb.rows.map((r) => r.map((c) => num(cellText(c))))], t.raw);
    } else if (t.type === 'richBlock') {
      const a = (t as any).attrs as Record<string, string>, b = (t as any).block as string;
      if (b === 'sheet') add('planilha', i, a.name, a.id || null, sheetMatrix(a.cells).rows, t.raw);
      else if (b === 'chart') {
        const { categories, series } = parseChartData(a.data ?? '');
        add('grafico', i, a.name || a.title, a.id || null, [['', ...series.map((s) => s.name)], ...categories.map((c, k) => [c, ...series.map((s) => s.values[k])])], t.raw, { chartType: a.type, title: a.title });
      } else if (b === 'diagram') add('diagrama', i, a.name, a.id || null, (a.outline ?? '').split(/\r?\n/).filter((l) => l.trim()).map((l) => [l.replace(/\s+$/, '')]), t.raw, { outline: a.outline });
      else if (b === 'slides') {
        const deck = parseDeck(a.deck);
        add('apresentacao', i, a.name, a.id || null, deck.slides.map((s, k) => [k + 1, s.items.filter((x) => x.type === 'title').map((x) => x.text).join(' / '), s.items.filter((x) => x.type === 'text').map((x) => x.text).join(' / ')]), t.raw, { deck });
      } else if (b === 'picture' && a.src) add('foto', i, a.alt, null, [], t.raw, { src: a.src, alt: a.alt });
    } else if (t.type === 'paragraph') {
      // foto sozinha no parágrafo: ![descrição](endereço)
      const imgs = ((t as Tokens.Paragraph).tokens ?? []).filter((x) => x.type === 'image') as Tokens.Image[];
      for (const im of imgs) add('foto', i, im.text, null, [], `![${im.text}](${im.href})`, { src: im.href, alt: im.text });
    }
  });
  return out;
}

/** CSV (separador ";" e vírgula decimal, como o Excel em português abre direto). */
export function toCsv(rows: Scalar[][]) {
  const q = (v: Scalar) => { const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return `﻿${rows.map((r) => r.map(q).join(';')).join('\r\n')}\r\n`;
}
/** JSON: lista de registros com as colunas do cabeçalho. */
export function toJsonRecords(rows: Scalar[][]) {
  const [head = [], ...body] = rows;
  const keys = head.map((h, i) => String(h || `coluna_${i + 1}`));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null])));
}
/** Descrição curta (meta description e Dataset). */
export function describe(it: DataItem, postTitle: string) {
  const cols = it.rows[0]?.filter((c) => c !== '' && c !== null).map(String) ?? [];
  if (it.kind === 'foto') return `${it.extra.alt || 'Foto'} — imagem da publicação "${postTitle}".`;
  if (it.kind === 'apresentacao') return `Apresentação com ${it.rows.length} slides da publicação "${postTitle}"${it.rows[0]?.[1] ? `: ${it.rows.map((r) => r[1]).filter(Boolean).slice(0, 4).join(', ')}` : ''}.`;
  if (it.kind === 'diagrama') return `Diagrama com ${it.rows.length} tópicos da publicação "${postTitle}".`;
  const n = Math.max(0, it.rows.length - 1);
  return `${KIND_LABEL[it.kind]} com ${n} ${n === 1 ? 'linha' : 'linhas'}${cols.length ? ` e as colunas ${cols.slice(0, 6).join(', ')}` : ''}, da publicação "${postTitle}".`;
}
export const TABULAR: DataKind[] = ['tabela', 'planilha', 'grafico'];
export { slidesHtml };
