// Pseudocódigo das páginas: texto com marcações que descreve uma publicação inteira e serve de meio-termo
// para as conversões (pseudocódigo ↔ publicação ↔ PDF). Padrão:
//
//   <doc: Teste 1 (
//     <h1.anton: Resultados do trimestre>
//     <txt: Parágrafo com *negrito*, _itálico_ e ~riscado~.>
//     <tbl: {hash}( Produto, Preço | Notebook | 500 | Mouse | 50 )>
//     <pln: {hash.Planilha 1}( <A.1: Produto> <B.1: Preço> <A.2: Pc> <B.2: 67> <B.3: =SOMA(B2:B2)> )>
//     <sld: {hash.Introdução}( <h1: Contexto> <h4: - Ponto um, - Ponto dois> )>
//   )>
//
// Regras:
//   <marca: conteúdo>                 bloco simples (o ">" fecha)
//   <marca: cabeçalho ( … )>          bloco com conteúdo entre parênteses (o ">" depois do ")" é opcional)
//   marca.modificador                 ex.: h1.anton, grf.pizza, frm.estrela, lst.num, ali.centro, img.direita
//   marca@x,y,w,h                     posição e tamanho em % (itens de slide) · img@320 = largura em px
//   marca#RRGGBB                      cor (forma, texto do slide, fundo do slide)
//   {hash} / {hash.nome}              o sistema cria o id; {abc123.nome} mantém o id que já existe
//   \<  \>  \(  \)  \|  \,  \\        para usar esses caracteres como texto
// Texto: *negrito*, _itálico_, ~riscado~, `código`, [link](https://…). Linhas que começam com "- " viram tópicos.
import { Marked, type Token, type Tokens } from 'marked';
import { BLOCK_RE, blockMarkdown, markedBlocks, parseAttrs, parseCells, parseDeck, sheetMatrix, newId, type Deck, type Slide, type SlideItem } from './rich-blocks.ts';
import type { BlockM, ImportModel, RunM, SlideItemM, SlideM } from '../editor-core/io/model.ts';

export interface PNode {
  tag: string;
  mods: string[];
  pos?: number[];
  color?: string;
  /** id e nome de {hash.nome} */
  id?: string;
  name?: string;
  /** texto do bloco simples, ou o cabeçalho (sem o {…}) de um bloco com parênteses */
  text: string;
  /** conteúdo entre parênteses: outros blocos (doc, pln, sld, apr, ali) … */
  children?: PNode[];
  /** … ou texto cru (tbl, grf, dgm) */
  raw?: string;
}

export class PseudoError extends Error {
  at: number;
  constructor(msg: string, at: number, src: string) {
    super(`${msg} (linha ${src.slice(0, at).split('\n').length})`);
    this.at = at;
  }
}

const CONTAINERS = new Set(['doc', 'pln', 'sld', 'apr', 'ali']);
const RAW = new Set(['tbl', 'grf', 'dgm']);
const CELL = /^[A-Z]{1,3}\.\d+$/;   // célula: letra(s) maiúscula(s), ponto, número (A.1); "h1" continua sendo título
const genId = () => newId('').slice(-6);

// ---------------------------------------------------------------- leitura
export function parsePseudo(src: string): PNode[] {
  let i = 0;
  const err = (m: string): never => { throw new PseudoError(m, i, src); };
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const unesc = (s: string) => s.replace(/\\([\\<>()|,{}])/g, '$1');

  function readTagSpec() {
    const start = i;
    while (i < src.length && !/[:>(\s]/.test(src[i])) i++;
    return src.slice(start, i);
  }
  function spec(raw: string): Pick<PNode, 'tag' | 'mods' | 'pos' | 'color'> {
    if (CELL.test(raw)) return { tag: raw.toUpperCase().replace('.', ''), mods: ['cell'] };
    const m = /^([a-z][a-z0-9]*)/i.exec(raw) ?? err(`Marcação inválida: <${raw}`);
    const out: Pick<PNode, 'tag' | 'mods' | 'pos' | 'color'> = { tag: m![1].toLowerCase(), mods: [] };
    for (const seg of raw.slice(m![1].length).match(/[.@#][^.@#]+/g) ?? []) {
      if (seg[0] === '.') out.mods.push(seg.slice(1).toLowerCase());
      else if (seg[0] === '@') out.pos = seg.slice(1).split(',').map(Number).filter((n) => Number.isFinite(n));
      else out.color = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(seg) ? seg : err(`Cor inválida: ${seg}`);
    }
    return out;
  }
  /** lê até o caractere (sem escape) — devolve o texto cru */
  function until(stop: (ch: string) => boolean) {
    const start = i;
    while (i < src.length && !stop(src[i])) { if (src[i] === '\\') i++; i++; }
    return src.slice(start, i);
  }
  function idName(header: string, node: PNode) {
    const m = /\{([^}]*)\}/.exec(header);
    if (!m) return header.trim();
    const [first, ...rest] = m[1].split('.');
    node.id = !first.trim() || first.trim().toLowerCase() === 'hash' ? genId() : first.trim();
    const name = rest.join('.').trim();
    if (name) node.name = name;
    return (header.slice(0, m.index) + header.slice(m.index + m[0].length)).trim();
  }
  function element(): PNode {
    i++; // <
    const sp = spec(readTagSpec());
    const node: PNode = { ...sp, text: '' };
    ws();
    if (src[i] === '>') { i++; return node; }            // <hr>
    if (src[i] === ':') i++;
    if (CONTAINERS.has(node.tag) || RAW.has(node.tag)) {
      const header = until((ch) => ch === '(' || ch === '>');
      node.text = unesc(idName(header, node));
      if (src[i] === '(') {
        i++;
        if (CONTAINERS.has(node.tag)) node.children = seq(true);
        else {
          let depth = 0; const start = i;
          while (i < src.length) {
            if (src[i] === '\\') { i += 2; continue; }
            if (src[i] === '(') depth++;
            else if (src[i] === ')') { if (depth === 0) break; depth--; }
            i++;
          }
          node.raw = src.slice(start, i);
        }
        if (src[i] !== ')') err(`Faltou fechar o parêntese de <${node.tag}`);
        i++;
        ws();
        if (src[i] === '>') i++;
      } else if (src[i] === '>') i++;
      else err(`Faltou fechar <${node.tag}`);
      return node;
    }
    // bloco simples: texto até o ">" (com escape)
    const body = until((ch) => ch === '>');
    if (src[i] !== '>') err(`Faltou fechar <${node.tag}`);
    i++;
    node.text = unesc(body).trim();
    return node;
  }
  function seq(inParen: boolean): PNode[] {
    const out: PNode[] = [];
    for (;;) {
      ws();
      if (i >= src.length) { if (inParen) err('Faltou fechar um parêntese'); return out; }
      if (inParen && src[i] === ')') return out;
      if (src[i] === '<') { out.push(element()); continue; }
      // texto solto fora de marcação vira parágrafo
      const t = until((ch) => ch === '<' || (inParen && ch === ')')).trim();
      if (t) out.push({ tag: 'txt', mods: [], text: unesc(t) });
    }
  }
  return seq(false);
}

// ---------------------------------------------------------------- pseudocódigo → publicação (Markdown)
const CHART_PT: Record<string, string> = { colunas: 'COLUMN', barras: 'BAR', linhas: 'LINE', area: 'AREA', pizza: 'PIE', rosca: 'DOUGHNUT' };
const DIAGRAM_PT: Record<string, string> = { organograma: 'ORGCHART', fluxograma: 'FLOWCHART', mapa: 'MINDMAP', processo: 'PROCESS', ciclo: 'CYCLE' };
const SHAPE_PT: Record<string, string> = {
  retangulo: 'RECTANGLE', quadrado: 'SQUARE', arredondado: 'ROUNDED_RECTANGLE', circulo: 'CIRCLE', elipse: 'ELLIPSE', triangulo: 'TRIANGLE', retangulo_triangulo: 'RIGHT_TRIANGLE',
  losango: 'DIAMOND', paralelogramo: 'PARALLELOGRAM', trapezio: 'TRAPEZOID', pentagono: 'PENTAGON', hexagono: 'HEXAGON', octogono: 'OCTAGON', estrela: 'STAR', estrela6: 'STAR6',
  seta: 'ARROW', seta_esquerda: 'ARROW_LEFT', seta_cima: 'ARROW_UP', seta_baixo: 'ARROW_DOWN', seta_dupla: 'DOUBLE_ARROW', divisa: 'CHEVRON', balao: 'CALLOUT', nuvem: 'CLOUD',
  coracao: 'HEART', cruz: 'CROSS', raio: 'LIGHTNING', lua: 'MOON', documento: 'DOCUMENT', cilindro: 'CYLINDER', linha: 'LINE',
};
const ALIGN_PT: Record<string, string> = { centro: 'center', direita: 'right', justificado: 'justify', esquerda: 'left' };
const rev = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const CHART_EN = rev(CHART_PT), DIAGRAM_EN = rev(DIAGRAM_PT), SHAPE_EN = rev(SHAPE_PT), ALIGN_EN = rev(ALIGN_PT);

/** *negrito* _itálico_ ~riscado~ → Markdown */
export const inlineToMd = (t: string) => t
  .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?![*\w])/g, '$1**$2**')
  .replace(/(^|[^\w])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1*$2*')
  .replace(/(^|[^~])~(?!\s)([^~\n]+?)~(?!~)/g, '$1~~$2~~');
/** Markdown → *negrito* _itálico_ ~riscado~ */
export const inlineFromMd = (t: string) => t
  .replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g, (_, a, b) => `\u0001${a ?? b}\u0001`)
  .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?![*\w])/g, '$1_$2_')
  .replace(/~~([^~\n]+?)~~/g, '~$1~')
  .replace(/\u0001/g, '*');
/** "- um, - dois" ou linhas com "- " → itens */
export const bulletItems = (t: string) => (/^\s*-\s+/.test(t) ? t.split(/(?:^|\n|,)\s*-\s+/).map((x) => x.trim()).filter(Boolean) : null);

const splitEsc = (s: string, sep: string) => {
  const out: string[] = []; let cur = '';
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && k + 1 < s.length) { cur += s[k + 1]; k++; continue; }
    if (s[k] === sep) { out.push(cur); cur = ''; continue; }
    cur += s[k];
  }
  out.push(cur);
  return out.map((x) => x.trim());
};
/** "Produto, Preço | Notebook | 500 | Mouse | 50" → linhas (cabeçalho separado por vírgula, células por "|") */
export function tableRows(raw: string): string[][] {
  const text = raw.replace(/\s*\n\s*/g, ' ').trim();
  if (!text) return [];
  const firstBar = (() => { for (let k = 0; k < text.length; k++) { if (text[k] === '\\') { k++; continue; } if (text[k] === '|') return k; } return -1; })();
  const headPart = firstBar < 0 ? text : text.slice(0, firstBar);
  const head = splitEsc(headPart, ',');
  if (firstBar < 0) return [head];
  const cells = splitEsc(text.slice(firstBar + 1), '|');
  const n = Math.max(1, head.length);
  const rows: string[][] = [head];
  for (let k = 0; k < cells.length; k += n) rows.push(Array.from({ length: n }, (_, j) => cells[k + j] ?? ''));
  return rows;
}
const mdCell = (v: string) => v.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const mdTable = (rows: string[][]) => {
  const n = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: n }, (_, k) => mdCell(inlineToMd(r[k] ?? ''))).join(' | ')} |`;
  return [line(rows[0]), `| ${Array.from({ length: n }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
};

/** Itens de um slide a partir dos blocos dentro de <sld>. Sem @posição, empilha de cima para baixo. */
function slideFrom(n: PNode): Slide {
  const items: SlideItem[] = [];
  let y = 8;
  const place = (c: PNode, dflt: [number, number, number, number]) => {
    const [x, yy, w, h] = c.pos?.length === 4 ? c.pos : dflt;
    if (!c.pos) y = yy + h + 3;
    return { x, y: yy, w, h };
  };
  const kids = n.children ?? [];
  if (n.text && !kids.some((c) => c.tag === 'h1')) kids.unshift({ tag: 'h1', mods: [], text: n.text });
  for (const c of kids) {
    const font = c.mods.includes('anton') ? 'title' : c.mods.includes('arial') ? 'text' : null;
    if (/^h[1-4]$/.test(c.tag) || c.tag === 'txt' || c.tag === 'lst') {
      const lvl = c.tag === 'txt' || c.tag === 'lst' ? 4 : Number(c.tag[1]);
      const size = [4.6, 3.4, 2.8, 2.4][lvl - 1];
      const items0 = bulletItems(c.text);
      const text = items0 ? items0.map((x) => `- ${x}`).join('\n') : c.text;
      const lines = Math.max(1, text.split('\n').length);
      const type: SlideItem['type'] = font ?? (lvl <= 2 ? 'title' : 'text');
      items.push({ id: genId(), type, text, size, color: c.color ?? (type === 'title' ? '#F2F2EE' : '#A6A6A0'), bold: lvl === 3 || undefined, align: (c.mods.find((m) => ALIGN_PT[m]) ? ALIGN_PT[c.mods.find((m) => ALIGN_PT[m])!] : 'left') as SlideItem['align'], ...place(c, [6, y, 88, Math.min(70, Math.round(size * 2.2 * lines + 4))]) });
    } else if (c.tag === 'img') {
      const [src, alt = ''] = splitEsc(c.text, '|');
      items.push({ id: genId(), type: 'image', src, alt, ...place(c, [6, y, 52, Math.max(20, 92 - y)]) });
    } else if (c.tag === 'frm') {
      const kind = SHAPE_PT[c.mods[0] ?? ''] ?? (c.mods[0] ?? 'RECTANGLE').toUpperCase();
      items.push({ id: genId(), type: 'shape', kind, fill: c.color ?? '#FBBF00', text: c.text || undefined, size: 2.8, color: '#000000', ...place(c, [40, y, 20, 30]) });
    } else if (['grf', 'dgm', 'pln', 'eq', 'tbl'].includes(c.tag)) {
      // dados dentro do slide: gráfico, diagrama, planilha/tabela e equação (mesmos atributos do bloco no texto)
      const data = slideData(c);
      if (data) items.push({ id: genId(), type: 'block', ...data, size: 1.6, ...place(c, [8, y, 84, Math.max(30, 92 - y)]) });
    }
  }
  return { id: genId(), bg: n.color ?? '#000000', items };
}

function slideData(c: PNode): Pick<SlideItem, 'block' | 'attrs'> | null {
  if (c.tag === 'tbl') {
    const rows = tableRows(c.raw ?? '');
    const cells: Record<string, string> = {};
    rows.forEach((r, i) => r.forEach((v, j) => { if (v !== '') cells[`${colLetters(j + 1)}${i + 1}`] = v; }));
    return { block: 'sheet', attrs: { name: c.name ?? '', cells: JSON.stringify(cells), header: 'true' } };
  }
  const md: string[] = [];
  blockToMd({ ...c, pos: undefined }, md);
  const m = BLOCK_RE.exec(md[0] ?? '');
  if (!m) return null;
  return { block: m[1] as SlideItem['block'], attrs: parseAttrs(m[2] ?? '') };
}
/** Texto curto de um gráfico, diagrama, planilha ou equação de slide (no PDF entra como texto). */
function blockSummary(it: SlideItem) {
  const a = it.attrs ?? {};
  if (it.block === 'chart') return `Gráfico${a.title ? `: ${a.title}` : ''}\n${(a.data ?? '').split(/\r?\n/).filter(Boolean).map((l) => l.split(';').join('  ')).join('\n')}`;
  if (it.block === 'diagram') return `Diagrama\n${(a.outline ?? '').split(/\r?\n/).filter((l) => l.trim()).map((l) => `• ${l.trim()}`).join('\n')}`;
  if (it.block === 'sheet') return sheetMatrix(a.cells).rows.map((r) => r.map((v) => (v ?? '')).join('  ')).join('\n');
  if (it.block === 'math') return a.tex ?? '';
  return '';
}
const colLetters = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

function blockToMd(n: PNode, out: string[]) {
  switch (n.tag) {
    case 'h1': out.push(`## ${inlineToMd(n.text)}`); return;
    case 'h2': out.push(`### ${inlineToMd(n.text)}`); return;
    case 'h3': case 'h4': out.push(`#### ${inlineToMd(n.text)}`); return;
    case 'txt': {
      const items = bulletItems(n.text);
      out.push(items ? items.map((x) => `- ${inlineToMd(x)}`).join('\n') : n.text.split(/\n{2,}/).map(inlineToMd).join('\n\n'));
      return;
    }
    case 'lst': {
      const items = bulletItems(n.text) ?? n.text.split('\n').map((x) => x.trim()).filter(Boolean);
      out.push(items.map((x, k) => `${n.mods.includes('num') ? `${k + 1}.` : '-'} ${inlineToMd(x)}`).join('\n'));
      return;
    }
    case 'cit': out.push(n.text.split('\n').map((l) => `> ${inlineToMd(l)}`).join('\n')); return;
    case 'cod': out.push(`\`\`\`${n.mods[0] ?? ''}\n${n.text}\n\`\`\``); return;
    case 'hr': out.push('---'); return;
    case 'eq': out.push(blockMarkdown('math', { tex: n.text })); return;
    case 'img': {
      const [src, alt = ''] = splitEsc(n.text, '|');
      const align = n.mods.map((m) => ALIGN_PT[m]).find(Boolean);
      if (align || n.pos?.length) out.push(blockMarkdown('picture', { src, alt, width: n.pos?.[0] ?? '', align: align ?? 'center' }));
      else out.push(`![${alt}](${src})`);
      return;
    }
    case 'frm': {
      const kind = SHAPE_PT[n.mods[0] ?? ''] ?? (n.mods[0] ?? 'RECTANGLE').toUpperCase();
      out.push(blockMarkdown('shape', { kind, text: n.text, fill: n.color ?? '#FBBF00', width: n.pos?.[0] ?? '', height: n.pos?.[1] ?? '', align: n.mods.map((m) => ALIGN_PT[m]).find(Boolean) ?? 'center' }));
      return;
    }
    case 'tbl': { const rows = tableRows(n.raw ?? ''); if (rows.length) out.push(mdTable(rows)); return; }
    case 'grf': {
      const rows = tableRows(n.raw ?? '');
      out.push(blockMarkdown('chart', { id: n.id, name: n.name, type: CHART_PT[n.mods[0] ?? ''] ?? (n.mods[0] ?? 'COLUMN').toUpperCase(), title: n.text || n.name || '', data: rows.map((r) => r.join(';')).join('\n') }));
      return;
    }
    case 'dgm': {
      const lines = (n.raw ?? '').split(/\n|\s\/\s/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
      const outline = lines.map((l) => { const m = /^\s*(-*)\s*(.*)$/.exec(l)!; return `${'  '.repeat(m[1].length)}${m[2]}`; }).join('\n');
      out.push(blockMarkdown('diagram', { id: n.id, name: n.name, type: DIAGRAM_PT[n.mods[0] ?? ''] ?? (n.mods[0] ?? 'ORGCHART').toUpperCase(), outline }));
      return;
    }
    case 'pln': {
      const cells: Record<string, string> = {};
      for (const c of n.children ?? []) if (c.mods.includes('cell')) cells[c.tag] = c.text;
      out.push(blockMarkdown('sheet', { id: n.id, name: n.name ?? n.text, cells: JSON.stringify(cells), header: n.mods.includes('semcabecalho') ? 'false' : 'true', align: 'center' }));
      return;
    }
    case 'apr': {
      const deck: Deck = { ratio: n.mods.includes('4x3') ? '4:3' : '16:9', slides: (n.children ?? []).filter((c) => c.tag === 'sld').map(slideFrom) };
      out.push(blockMarkdown('slides', { id: n.id, name: n.name ?? n.text, deck: JSON.stringify(deck), align: 'center' }));
      return;
    }
    case 'ali': {
      const inner: string[] = [];
      for (const c of groupSlides(n.children ?? [])) blockToMd(c, inner);
      out.push(`:::align {value="${ALIGN_PT[n.mods[0] ?? 'centro'] ?? 'center'}"}\n\n${inner.join('\n\n')}\n\n:::`);
      return;
    }
    case 'doc': for (const c of groupSlides(n.children ?? [])) blockToMd(c, out); return;
    default: if (n.text) out.push(inlineToMd(n.text));
  }
}
/** <sld> seguidos viram uma apresentação só (o id e o nome vêm do primeiro). */
function groupSlides(list: PNode[]): PNode[] {
  const out: PNode[] = [];
  for (const n of list) {
    const prev = out.at(-1);
    if (n.tag === 'sld' && prev?.tag === 'apr' && prev.mods.includes('auto')) prev.children!.push(n);
    else if (n.tag === 'sld') out.push({ tag: 'apr', mods: ['auto'], id: n.id, name: n.name, text: '', children: [n] });
    else out.push(n);
  }
  return out;
}

/** Pseudocódigo → título e corpo (Markdown) da publicação. */
export function pseudoToPost(src: string): { title: string; body: string } {
  const nodes = parsePseudo(src);
  const doc = nodes.find((n) => n.tag === 'doc');
  const out: string[] = [];
  for (const n of groupSlides(doc ? doc.children ?? [] : nodes)) blockToMd(n, out);
  return { title: doc?.text ?? '', body: out.join('\n\n').trim() + '\n' };
}

// ---------------------------------------------------------------- publicação (Markdown) → pseudocódigo
const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/</g, '\\<').replace(/>/g, '\\>');
const escRaw = (t: string) => esc(t).replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const escCell = (t: string, sep: string) => escRaw(t).replace(/\|/g, '\\|').replace(sep === ',' ? /,/g : /$^/g, '\\,');
const idHead = (id: string | undefined, name: string | undefined) => `{${id || 'hash'}${name ? `.${name.replace(/[{}]/g, '')}` : ''}}`;
const plain = (t: Tokens.TableCell) => inlineFromMd(t.text);

function slideToPseudo(s: Slide, pad: string) {
  const lines = s.items.map((it) => {
    const pos = `@${[it.x, it.y, it.w, it.h].map((v) => Math.round(v)).join(',')}`;
    const col = it.type === 'shape' ? (it.fill ? it.fill : '') : it.color ?? '';
    const c = col ? col : '';
    if (it.type === 'image') return `${pad}  <img${pos}: ${escRaw(it.src ?? '')} | ${escRaw(it.alt ?? '')}>`;
    if (it.type === 'block') {
      // o mesmo pseudocódigo do bloco no texto, com a posição no slide logo depois da marca
      const lines = it.block ? tokenToPseudo({ type: 'richBlock', raw: '', block: it.block, attrs: it.attrs ?? {} } as any, `${pad}  `) : [];
      if (!lines.length) return '';
      lines[0] = lines[0].replace(/^(\s*<[^:\s]+?)(:)/, `$1${pos}$2`);
      return lines.join('\n');
    }
    if (it.type === 'shape') return `${pad}  <frm.${SHAPE_EN[it.kind ?? 'RECTANGLE'] ?? (it.kind ?? 'retangulo').toLowerCase()}${c}${pos}: ${esc(it.text ?? '')}>`;
    const size = it.size ?? 2.4;
    const h = size >= 4 ? 'h1' : size >= 3 ? 'h2' : it.bold ? 'h3' : 'h4';
    const font = it.type === 'title' ? '.anton' : '.arial';
    const text = (it.text ?? '').split('\n').map((l) => l.replace(/^\s*-\s+/, '- ')).join(it.text?.trim().startsWith('-') ? ', ' : '\n');
    return `${pad}  <${h}${font}${c}${pos}: ${esc(text)}>`;
  });
  return `${pad}<sld${s.bg && s.bg !== '#000000' ? s.bg : ''}: {${s.id}}(\n${lines.filter(Boolean).join('\n')}\n${pad})>`;
}

function tokenToPseudo(t: Token, pad: string): string[] {
  switch (t.type) {
    case 'space': return [];
    case 'heading': { const d = (t as Tokens.Heading).depth; return [`${pad}<${d <= 2 ? 'h1.anton' : d === 3 ? 'h2' : 'h3'}: ${esc(inlineFromMd((t as Tokens.Heading).text))}>`]; }
    case 'paragraph': {
      const p = t as Tokens.Paragraph;
      const only = p.tokens?.filter((x) => x.type !== 'text' || (x as Tokens.Text).text.trim());
      if (only?.length === 1 && only[0].type === 'image') { const im = only[0] as Tokens.Image; return [`${pad}<img: ${escRaw(im.href)} | ${escRaw(im.text)}>`]; }
      return [`${pad}<txt: ${esc(inlineFromMd(p.text))}>`];
    }
    case 'list': {
      const l = t as Tokens.List;
      const flat: string[] = [];
      const walk = (list: Tokens.List, depth: number) => { for (const it of list.items) { const first = it.text.split('\n')[0]; flat.push(`${'-'.repeat(depth + 1)} ${inlineFromMd(first)}`); for (const sub of it.tokens) if (sub.type === 'list') walk(sub as Tokens.List, depth + 1); } };
      walk(l, 0);
      return [`${pad}<lst${l.ordered ? '.num' : ''}: ${esc(flat.join(`\n${pad}  `))}>`];
    }
    case 'table': {
      const tb = t as Tokens.Table;
      const head = tb.header.map((c) => escCell(plain(c), ',')).join(', ');
      const rows = tb.rows.map((r) => `${pad}  | ${r.map((c) => escCell(plain(c), '|')).join(' | ')}`);
      return [`${pad}<tbl: {hash}( ${head}\n${rows.join('\n')}\n${pad})>`];
    }
    case 'blockquote': return [`${pad}<cit: ${esc(inlineFromMd((t as Tokens.Blockquote).text.trim()))}>`];
    case 'code': { const c = t as Tokens.Code; return [`${pad}<cod${c.lang ? `.${c.lang}` : ''}: ${esc(c.text)}>`]; }
    case 'hr': return [`${pad}<hr>`];
    case 'html': { const h = (t as Tokens.HTML).text.trim(); return h ? [`${pad}<txt: ${esc(h)}>`] : []; }
    case 'alignBlock': {
      const a = t as any;
      return [`${pad}<ali.${ALIGN_EN[a.value] ?? 'centro'}: (`, ...a.tokens.flatMap((x: Token) => tokenToPseudo(x, pad + '  ')), `${pad})>`];
    }
    case 'richBlock': {
      const a = (t as any).attrs as Record<string, string>, b = (t as any).block as string;
      if (b === 'math') return [`${pad}<eq: ${esc(a.tex ?? '')}>`];
      if (b === 'picture') return [`${pad}<img.${ALIGN_EN[a.align] ?? 'centro'}${a.width ? `@${a.width}` : ''}: ${escRaw(a.src ?? '')} | ${escRaw(a.alt ?? '')}>`];
      if (b === 'shape' || b === 'circle') {
        const kind = b === 'circle' ? 'circulo' : SHAPE_EN[a.kind ?? 'RECTANGLE'] ?? (a.kind ?? 'retangulo').toLowerCase();
        const fill = b === 'circle' ? a.color : a.fill;
        const size = b === 'circle' ? `@${a.size ?? 160},${a.size ?? 160}` : a.width || a.height ? `@${a.width ?? ''},${a.height ?? ''}` : '';
        return [`${pad}<frm.${kind}${fill && /^#/.test(fill) ? fill : ''}${size}: ${esc(a.text ?? '')}>`];
      }
      if (b === 'chart') {
        // as linhas do próprio dado (mantém o rótulo da primeira coluna, ex.: "Mês")
        const lines = (a.data ?? '').split(/\r?\n|\|/).map((l) => l.split(/;|\t/).map((c) => c.trim())).filter((r) => r.some(Boolean));
        const [head = [], ...body] = lines;
        const rows = body.map((r) => `${pad}  | ${r.map((x) => escCell(x, '|')).join(' | ')}`);
        return [`${pad}<grf.${CHART_EN[a.type] ?? 'colunas'}: ${idHead(a.id, a.name)} ${esc(a.title ?? '')}( ${head.map((x) => escCell(x, ',')).join(', ')}\n${rows.join('\n')}\n${pad})>`];
      }
      if (b === 'diagram') {
        const lines = (a.outline ?? '').split(/\r?\n/).filter((l) => l.trim()).map((l) => { const lead = /^\s*/.exec(l)![0].replace(/\t/g, '  ').length; return `${pad}  ${'-'.repeat(Math.floor(lead / 2))}${lead ? ' ' : ''}${escRaw(l.trim())}`; });
        return [`${pad}<dgm.${DIAGRAM_EN[a.type] ?? 'organograma'}: ${idHead(a.id, a.name)}(\n${lines.join('\n')}\n${pad})>`];
      }
      if (b === 'sheet') {
        const cells = parseCells(a.cells);
        const order = Object.keys(cells).sort((x, y) => { const mx = /^([A-Z]+)(\d+)$/.exec(x)!, my = /^([A-Z]+)(\d+)$/.exec(y)!; return Number(mx[2]) - Number(my[2]) || mx[1].localeCompare(my[1]); });
        return [`${pad}<pln${a.header === 'false' ? '.semcabecalho' : ''}: ${idHead(a.id, a.name)}(`, ...order.map((k) => { const m = /^([A-Z]+)(\d+)$/.exec(k)!; return `${pad}  <${m[1]}.${m[2]}: ${esc(cells[k])}>`; }), `${pad})>`];
      }
      if (b === 'slides') {
        const deck = parseDeck(a.deck);
        return [`${pad}<apr${deck.ratio === '4:3' ? '.4x3' : ''}: ${idHead(a.id, a.name)}(`, ...deck.slides.map((s) => slideToPseudo(s, pad + '  ')), `${pad})>`];
      }
      return [];
    }
    default: return (t as any).raw?.trim() ? [`${pad}<txt: ${esc((t as any).raw.trim())}>`] : [];
  }
}

/** Título e corpo (Markdown) da publicação → pseudocódigo. */
export function postToPseudo(title: string, body: string) {
  const tokens = new Marked({ gfm: true, extensions: markedBlocks() } as any).lexer(body ?? '');
  const lines = tokens.flatMap((t: Token) => tokenToPseudo(t, '  '));
  return `<doc: ${esc(title || 'Sem título').replace(/\(/g, '\\(')} (\n${lines.join('\n')}\n)>\n`;
}

// ---------------------------------------------------------------- pseudocódigo → modelo neutro (PDF, DOCX…)
/** *negrito* _itálico_ ~riscado~ `código` [texto](url) → trechos com formatação */
export function runsOf(t: string): RunM[] {
  const out: RunM[] = [];
  const re = /\*([^*]+)\*|_([^_]+)_|~([^~]+)~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) out.push({ text: t.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], format: { bold: true } });
    else if (m[2] !== undefined) out.push({ text: m[2], format: { italic: true } });
    else if (m[3] !== undefined) out.push({ text: m[3], format: { strike: true } });
    else if (m[4] !== undefined) out.push({ text: m[4], format: { fontFamily: 'monospace' } });
    else out.push({ text: m[5], format: { underline: true, color: '#1D4ED8', link: m[6] } });
    last = re.lastIndex;
  }
  if (last < t.length) out.push({ text: t.slice(last) });
  return out.length ? out : [{ text: '' }];
}
const stripHtml = (t: string) => t.replace(/<[^>]+>/g, '');

export function pseudoToModel(src: string): ImportModel {
  const nodes = parsePseudo(src);
  const doc = nodes.find((n) => n.tag === 'doc');
  const blocks: BlockM[] = [];
  const slides: SlideM[] = [];
  if (doc?.text) blocks.push({ kind: 'text', textType: 'TITLE', runs: [{ text: doc.text }] });
  const add = (n: PNode) => {
    switch (n.tag) {
      case 'h1': blocks.push({ kind: 'text', textType: 'HEADING_1', runs: runsOf(n.text) }); return;
      case 'h2': blocks.push({ kind: 'text', textType: 'HEADING_2', runs: runsOf(n.text) }); return;
      case 'h3': case 'h4': blocks.push({ kind: 'text', textType: 'HEADING_3', runs: runsOf(n.text) }); return;
      case 'txt': { const items = bulletItems(n.text); if (items) blocks.push({ kind: 'list', listType: 'BULLET', items: items.map((x) => ({ level: 0, runs: runsOf(stripHtml(x)) })) }); else for (const p of n.text.split(/\n{2,}/)) blocks.push({ kind: 'text', runs: runsOf(stripHtml(p)) }); return; }
      case 'lst': {
        const lines = n.text.split('\n').map((l) => l.trim()).filter(Boolean);
        const items = (bulletItems(n.text) && !n.text.includes('\n') ? bulletItems(n.text)!.map((x) => ({ level: 0, text: x })) : lines.map((l) => { const m = /^(-+)\s*(.*)$/.exec(l); return { level: m ? m[1].length - 1 : 0, text: m ? m[2] : l }; }));
        blocks.push({ kind: 'list', listType: n.mods.includes('num') ? 'NUMBERED' : 'BULLET', items: items.map((x) => ({ level: x.level, runs: runsOf(x.text) })) });
        return;
      }
      case 'cit': blocks.push({ kind: 'text', textType: 'QUOTE', runs: runsOf(n.text) }); return;
      case 'cod': blocks.push({ kind: 'text', textType: 'CODE', runs: [{ text: n.text }] }); return;
      case 'eq': blocks.push({ kind: 'text', textType: 'CODE', runs: [{ text: n.text }] }); return;
      case 'hr': return;
      case 'img': { const [src, alt = ''] = splitEsc(n.text, '|'); blocks.push({ kind: 'image', source: src, alt, ...(n.pos?.[0] ? { width: n.pos[0], height: Math.round(n.pos[0] * 0.66) } : {}) }); return; }
      case 'frm': blocks.push({ kind: 'shape', shapeType: SHAPE_PT[n.mods[0] ?? ''] ?? 'RECTANGLE', width: n.pos?.[0] || 240, height: n.pos?.[1] || 140, fill: n.color ?? '#FBBF00', color: '#000000', bold: true, runs: n.text ? [{ text: n.text }] : undefined }); return;
      case 'tbl': { const rows = tableRows(n.raw ?? ''); if (rows.length) blocks.push({ kind: 'table', header: true, rows: rows.map((r) => r.map((c) => stripHtml(c))) }); return; }
      case 'grf': {
        const rows = tableRows(n.raw ?? '');
        blocks.push({ kind: 'text', textType: 'HEADING_3', runs: [{ text: `Gráfico: ${n.text || n.name || 'sem título'}` }] });
        if (rows.length) blocks.push({ kind: 'table', header: true, rows });
        return;
      }
      case 'dgm': {
        const lines = (n.raw ?? '').split(/\n|\s\/\s/).filter((l) => l.trim());
        blocks.push({ kind: 'text', textType: 'HEADING_3', runs: [{ text: `Diagrama${n.name ? `: ${n.name}` : ''}` }] });
        blocks.push({ kind: 'list', listType: 'BULLET', items: lines.map((l) => { const m = /^\s*(-*)\s*(.*)$/.exec(l)!; return { level: m[1].length, runs: [{ text: m[2] }] }; }) });
        return;
      }
      case 'pln': {
        const cells: Record<string, string> = {};
        for (const c of n.children ?? []) if (c.mods.includes('cell')) cells[c.tag] = c.text;
        const { rows } = sheetMatrix(JSON.stringify(cells));
        blocks.push({ kind: 'text', textType: 'HEADING_3', runs: [{ text: n.name || n.text || 'Planilha' }] });
        if (rows.length) blocks.push({ kind: 'table', header: !n.mods.includes('semcabecalho'), rows: rows.map((r) => r.map((v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v))) });
        return;
      }
      case 'apr': case 'sld': {
        const list = n.tag === 'apr' ? (n.children ?? []).filter((c) => c.tag === 'sld') : [n];
        for (const s of list) {
          const sl = slideFrom(s);
          slides.push({ background: sl.bg, items: sl.items.map((it): SlideItemM => {
            const box = { x: (it.x / 100) * 1280, y: (it.y / 100) * 720, width: (it.w / 100) * 1280, height: (it.h / 100) * 720 };
            if (it.type === 'image') return { kind: 'image', ...box, source: it.src, alt: it.alt };
            if (it.type === 'shape') return { kind: 'shape', ...box, shapeType: it.kind, fill: it.fill, runs: it.text ? [{ text: it.text }] : undefined };
            if (it.type === 'block') return { kind: 'text', ...box, textType: 'PARAGRAPH', runs: [{ text: blockSummary(it), format: { color: '#A6A6A0' } }] };
            return { kind: 'text', ...box, textType: it.type === 'title' ? 'TITLE' : 'PARAGRAPH', runs: (it.text ?? '').split('\n').flatMap((l, k) => [...(k ? [{ text: '\n' }] : []), { text: l.replace(/^\s*-\s+/, '• '), format: { color: it.color, ...(it.bold ? { bold: true } : {}) } }]) };
          }) });
        }
        if (n.tag === 'apr') blocks.push({ kind: 'text', runs: [{ text: `Apresentação${n.name ? ` "${n.name}"` : ''}: ${list.length} slides (no fim do arquivo).`, format: { italic: true } }] });
        return;
      }
      case 'ali': case 'doc': for (const c of n.children ?? []) add(c); return;
      default: if (n.text) blocks.push({ kind: 'text', runs: runsOf(n.text) });
    }
  };
  for (const n of groupSlides(doc ? doc.children ?? [] : nodes)) add(n);
  return { application: 'DOCUMENT_EDITOR', name: doc?.text || 'Documento', blocks, ...(slides.length ? { slides, slideSize: { width: 1280, height: 720 } } : {}) };
}
export { parseAttrs };

/** Linhas de tabela → <tbl: {hash}( cabeçalho, … | célula | … )> (usado pela leitura de PDF). */
export function tableRowsToPseudo(rows: string[][], pad = '  ') {
  const [head = [], ...body] = rows;
  return `${pad}<tbl: {hash}( ${head.map((x) => escCell(x, ',')).join(', ')}\n${body.map((r) => `${pad}  | ${r.map((x) => escCell(x, '|')).join(' | ')}`).join('\n')}\n${pad})>`;
}
