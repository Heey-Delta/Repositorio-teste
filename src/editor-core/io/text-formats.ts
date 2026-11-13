// Formatos de texto: TXT, Markdown, HTML e CSV (ida e volta pelo modelo neutro).
import type { BlockM, ImportModel, RunM, Scalar, SheetM } from './model.ts';
import { plain } from './model.ts';
import { esc, kids, parseXml, textContent, type XNode } from './xml.ts';
import { indexToCol, toAddress } from '../formula/parse.ts';

const HEAD_LEVEL: Record<string, number> = { TITLE: 1, HEADING_1: 1, SUBTITLE: 2, HEADING_2: 2, HEADING_3: 3, HEADING_4: 4, HEADING_5: 5, HEADING_6: 6 };
const LEVEL_TYPE = ['', 'HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6'];
const show = (v: Scalar) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'VERDADEIRO' : 'FALSO') : String(v));

/** Planilha → matriz (de A1 até a última célula usada). */
export function sheetMatrix(sh: SheetM): Scalar[][] {
  let rows = 0, cols = 0;
  const cells = Object.entries(sh.cells).map(([a, c]) => { const m = /^([A-Z]+)(\d+)$/.exec(a)!; const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), row = Number(m[2]); rows = Math.max(rows, row); cols = Math.max(cols, col); return { row, col, v: c.formula ? c.value ?? null : c.value ?? null }; });
  const out: Scalar[][] = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (const c of cells) out[c.row - 1][c.col - 1] = c.v as Scalar;
  return out;
}

// ---------------------------------------------------------------- TXT

export function toTxt(m: ImportModel): string {
  const out: string[] = [];
  const blocks = (bs: BlockM[]) => {
    for (const b of bs) {
      if (b.kind === 'text') out.push(plain(b.runs));
      else if (b.kind === 'list') { const n: number[] = []; out.push(b.items.map((it) => { n.length = it.level + 1; n[it.level] = (n[it.level] ?? 0) + 1; return `${'  '.repeat(it.level)}${b.listType === 'NUMBERED' ? `${n[it.level]}.` : '-'} ${plain(it.runs)}`; }).join('\n')); }
      else if (b.kind === 'table') out.push(b.rows.map((r) => r.map(show).join('\t')).join('\n'));
      else if (b.kind === 'image') out.push(`[Imagem${b.alt ? `: ${b.alt}` : ''}]`);
      else if (b.kind === 'shape') { if (b.runs?.length) out.push(plain(b.runs)); }
      else out.push('\f');
    }
  };
  if (m.blocks) blocks(m.blocks);
  m.slides?.forEach((s, i) => { if (i || out.length) out.push('---'); for (const it of [...s.items].sort((a, b) => a.y - b.y || a.x - b.x)) { if (it.runs) out.push(plain(it.runs)); else if (it.rows) out.push(it.rows.map((r) => r.map(show).join('\t')).join('\n')); } });
  m.sheets?.forEach((sh) => { if (m.sheets!.length > 1) out.push(`# ${sh.name}`); out.push(sheetMatrix(sh).map((r) => r.map(show).join('\t')).join('\n')); });
  return out.join('\n\n') + '\n';
}

export function fromTxt(text: string): ImportModel {
  const blocks: BlockM[] = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim()).map((l) => (l === '\f' ? { kind: 'break' } : { kind: 'text', textType: 'PARAGRAPH', runs: [{ text: l }] }));
  return { blocks };
}

// ---------------------------------------------------------------- Markdown

function mdInline(runs: RunM[]): string {
  return runs.map((r) => {
    const f = r.format ?? {};
    let t = r.text.replace(/([\\`*_[\]#|])/g, '\\$1');
    if (!t.trim()) return t;
    // pontuação e espaços nas pontas ficam fora das marcas (evita "**a***, b*", que é ambíguo)
    const lead = t.match(/^[\s,.;:!?)\]}'"’”-]*/)![0], trail = t.slice(lead.length).match(/[\s,.;:!?([{'"‘“-]*$/)![0];
    t = t.slice(lead.length, t.length - trail.length);
    if (!t) return lead + trail;
    if (f.code || f.fontFamily === 'monospace') t = '`' + r.text.trim() + '`';
    if (f.bold) t = `**${t}**`;
    if (f.italic) t = `*${t}*`;
    if (f.strike) t = `~~${t}~~`;
    if (typeof f.link === 'string') t = `[${t}](${f.link})`;
    return lead + t + trail;
  }).join('');
}
const mdCell = (v: Scalar) => show(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function toMarkdown(m: ImportModel): string {
  const out: string[] = [];
  const blocks = (bs: BlockM[]) => {
    for (const b of bs) {
      if (b.kind === 'text') {
        const lvl = HEAD_LEVEL[b.textType ?? ''];
        if (b.textType === 'CODE') out.push('```\n' + plain(b.runs) + '\n```');
        else if (b.textType === 'QUOTE') out.push('> ' + mdInline(b.runs));
        else out.push((lvl ? '#'.repeat(lvl) + ' ' : '') + mdInline(b.runs));
      } else if (b.kind === 'list') { const n: number[] = []; out.push(b.items.map((it) => { n.length = it.level + 1; n[it.level] = (n[it.level] ?? 0) + 1; return `${'   '.repeat(it.level)}${b.listType === 'NUMBERED' ? `${n[it.level]}.` : '-'} ${mdInline(it.runs)}`; }).join('\n')); }
      else if (b.kind === 'table') {
        if (!b.rows.length) continue;
        const w = Math.max(...b.rows.map((r) => r.length));
        const row = (r: Scalar[]) => `| ${Array.from({ length: w }, (_, i) => mdCell(r[i] ?? null)).join(' | ')} |`;
        const [head, ...rest] = b.header ? b.rows : [Array(w).fill(''), ...b.rows];
        out.push([row(head), `| ${Array(w).fill('---').join(' | ')} |`, ...rest.map(row)].join('\n'));
      } else if (b.kind === 'image') out.push(`![${b.alt.replace(/[[\]]/g, '')}](${b.source ?? ''})`);
      else if (b.kind === 'shape') out.push(shapeHtml(b));   // Markdown aceita HTML: a forma aparece onde o HTML é exibido
      else out.push('---');
    }
  };
  if (m.blocks) blocks(m.blocks);
  m.slides?.forEach((s, i) => {
    if (i || out.length) out.push('---');
    for (const it of [...s.items].sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (it.kind === 'text' || (it.kind === 'shape' && it.runs)) blocks([{ kind: 'text', textType: it.textType, runs: it.runs ?? [] }]);
      else if (it.kind === 'table') blocks([{ kind: 'table', header: true, rows: it.rows ?? [] }]);
      else if (it.kind === 'image') blocks([{ kind: 'image', alt: it.alt ?? '', source: it.source }]);
    }
  });
  m.sheets?.forEach((sh) => { out.push(`## ${sh.name}`); blocks([{ kind: 'table', header: true, rows: sheetMatrix(sh) }]); });
  return out.join('\n\n') + '\n';
}

/** Negrito (**x**), itálico (*x* ou _x_), riscado (~~x~~), código (`x`) e link ([texto](endereço)). */
export function parseMdInline(src: string, base: Record<string, unknown> = {}): RunM[] {
  const out: RunM[] = [];
  const push = (text: string, format: Record<string, unknown>) => { if (!text) return; const last = out.at(-1); if (last && JSON.stringify(last.format) === JSON.stringify(format)) last.text += text; else out.push({ text, format: { ...format } }); };
  const re = /\\([\\`*_[\]#|~])|`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(?!\s)(.+?)\*|(?<![\p{L}\d])_(?!\s)(.+?)_(?![\p{L}\d])|\[([^\]]*)\]\(([^)\s]*)\)/gu;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    push(src.slice(last, m.index), base);
    if (m[1]) push(m[1], base);
    else if (m[2] !== undefined) push(m[2], { ...base, code: true, fontFamily: 'monospace' });
    else if (m[3] ?? m[4]) for (const r of parseMdInline(m[3] ?? m[4], { ...base, bold: true })) push(r.text, r.format!);
    else if (m[5]) for (const r of parseMdInline(m[5], { ...base, strike: true })) push(r.text, r.format!);
    else if (m[6] ?? m[7]) for (const r of parseMdInline(m[6] ?? m[7], { ...base, italic: true })) push(r.text, r.format!);
    else if (m[8] !== undefined) for (const r of parseMdInline(m[8], { ...base, link: m[9] })) push(r.text, r.format!);
    last = re.lastIndex;
  }
  push(src.slice(last), base);
  return out.length ? out : [{ text: '', format: { ...base } }];
}

export function fromMarkdown(src: string): ImportModel {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: BlockM[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { blocks.push({ kind: 'text', textType: 'PARAGRAPH', runs: parseMdInline(para.join(' ')) }); para = []; } };
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  const scalar = (s: string): Scalar => (s === '' ? null : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) { flush(); continue; }
    let m: RegExpExecArray | null;
    if (/^```/.test(l)) { flush(); const code: string[] = []; while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]); blocks.push({ kind: 'text', textType: 'CODE', runs: [{ text: code.join('\n') }] }); continue; }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(l))) { flush(); blocks.push({ kind: 'text', textType: LEVEL_TYPE[m[1].length], runs: parseMdInline(m[2]) }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); blocks.push({ kind: 'break' }); continue; }
    if ((m = /^>\s?(.*)$/.exec(l))) { flush(); blocks.push({ kind: 'text', textType: 'QUOTE', runs: parseMdInline(m[1]) }); continue; }
    if ((m = /^!\[([^\]]*)\]\(([^)\s]*)\)\s*$/.exec(l))) { flush(); blocks.push({ kind: 'image', alt: m[1], source: m[2] || undefined }); continue; }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      flush();
      const rows: Scalar[][] = [cells(l).map(scalar)];
      i++;
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) rows.push(cells(lines[++i]).map(scalar));
      blocks.push({ kind: 'table', header: true, rows });
      continue;
    }
    if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l))) {
      flush();
      const listType = /\d/.test(m[2]) ? 'NUMBERED' : 'BULLET';
      const items: { level: number; runs: RunM[] }[] = [];
      let j = i;
      for (; j < lines.length; j++) {
        const x = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[j]);
        if (!x) break;
        items.push({ level: Math.floor(x[1].replace(/\t/g, '    ').length / 2), runs: parseMdInline(x[3]) });
      }
      // normaliza os recuos (2, 3 ou 4 espaços por nível)
      const steps = [...new Set(items.map((x) => x.level))].sort((a, b) => a - b);
      for (const it of items) it.level = steps.indexOf(it.level);
      blocks.push({ kind: 'list', listType, items });
      i = j - 1;
      continue;
    }
    para.push(l.trim());
  }
  flush();
  return { blocks };
}

// ---------------------------------------------------------------- HTML

const CLIP: Record<string, string> = { TRIANGLE: 'polygon(50% 0,100% 100%,0 100%)', DIAMOND: 'polygon(50% 0,100% 50%,50% 100%,0 50%)', STAR: 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)', ARROW: 'polygon(0 30%,65% 30%,65% 0,100% 50%,65% 100%,65% 70%,0 70%)', PENTAGON: 'polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)', HEXAGON: 'polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)' };
/** Forma no fluxo do texto (círculo, retângulo…) como HTML com estilo próprio. */
function shapeHtml(b: Extract<BlockM, { kind: 'shape' }>) {
  const round = b.shapeType === 'CIRCLE' || b.shapeType === 'ELLIPSE' ? 'border-radius:50%;' : b.shapeType === 'ROUNDED_RECTANGLE' ? 'border-radius:14px;' : '';
  const clip = CLIP[b.shapeType] ? `clip-path:${CLIP[b.shapeType]};` : '';
  return `<div class="shape" role="img" aria-label="${esc(b.runs?.length ? plain(b.runs) : b.shapeType.toLowerCase())}" style="width:${b.width}px;height:${b.height}px;max-width:100%;margin:1rem auto;display:flex;align-items:center;justify-content:center;text-align:center;background:${esc(b.fill ?? '#4472C4')};color:${esc(b.color ?? '#FFFFFF')};${b.bold ? 'font-weight:700;' : ''}${b.fontSize ? `font-size:${b.fontSize}pt;` : ''}${round}${clip}">${b.runs?.length ? htmlInline(b.runs) : ''}</div>`;
}

function htmlInline(runs: RunM[]): string {
  return runs.map((r) => {
    const f = r.format ?? {};
    let t = esc(r.text).replace(/\n/g, '<br>');
    const style = [f.color ? `color:${f.color}` : '', f.highlight ? `background:${f.highlight}` : '', f.fontSize ? `font-size:${f.fontSize}pt` : '', f.fontFamily && !f.code ? `font-family:${esc(String(f.fontFamily).replace(/^theme:.*/, 'inherit'))}` : ''].filter(Boolean).join(';');
    if (f.code) t = `<code>${t}</code>`;
    if (f.bold) t = `<strong>${t}</strong>`;
    if (f.italic) t = `<em>${t}</em>`;
    if (f.underline) t = `<u>${t}</u>`;
    if (f.strike) t = `<s>${t}</s>`;
    if (style) t = `<span style="${style}">${t}</span>`;
    if (typeof f.link === 'string') t = `<a href="${esc(f.link)}">${t}</a>`;
    return t;
  }).join('');
}
const htmlTable = (rows: Scalar[][], header = false) => `<table>\n${rows.map((r, i) => `<tr>${r.map((c) => (header && i === 0 ? `<th>${esc(show(c))}</th>` : `<td>${esc(show(c))}</td>`)).join('')}</tr>`).join('\n')}\n</table>`;

function htmlList(b: Extract<BlockM, { kind: 'list' }>): string {
  const tag = b.listType === 'NUMBERED' ? 'ol' : 'ul';
  let html = '', depth = -1;
  for (const it of b.items) {
    if (it.level > depth) { while (depth < it.level) { html += `<${tag}>`; depth++; } }
    else { html += '</li>'; while (depth > it.level) { html += `</${tag}></li>`; depth--; } }
    html += `<li>${htmlInline(it.runs)}`;
  }
  while (depth >= 0) { html += `</li></${tag}>`; depth--; }
  return html.replace(/<\/li><\/li>/g, '</li>');
}

export function toHtml(m: ImportModel): string {
  const body: string[] = [];
  const blocks = (bs: BlockM[]) => {
    for (const b of bs) {
      if (b.kind === 'text') {
        const lvl = HEAD_LEVEL[b.textType ?? ''];
        if (b.textType === 'CODE') body.push(`<pre><code>${esc(plain(b.runs))}</code></pre>`);
        else if (b.textType === 'QUOTE') body.push(`<blockquote>${htmlInline(b.runs)}</blockquote>`);
        else body.push(lvl ? `<h${lvl}${b.textType === 'TITLE' ? ' class="title"' : b.textType === 'SUBTITLE' ? ' class="subtitle"' : ''}>${htmlInline(b.runs)}</h${lvl}>` : `<p>${htmlInline(b.runs) || '<br>'}</p>`);
      } else if (b.kind === 'list') body.push(htmlList(b));
      else if (b.kind === 'table') body.push(htmlTable(b.rows, b.header));
      else if (b.kind === 'image') body.push(`<figure><img src="${esc(b.source ?? '')}" alt="${esc(b.alt)}"></figure>`);
      else if (b.kind === 'shape') body.push(shapeHtml(b));
      else body.push('<hr class="page-break">');
    }
  };
  if (m.blocks) blocks(m.blocks);
  const size = m.slideSize ?? { width: 1280, height: 720 };
  m.slides?.forEach((s, i) => {
    const items = s.items.map((it) => {
      const pos = `left:${(it.x / size.width) * 100}%;top:${(it.y / size.height) * 100}%;width:${(it.width / size.width) * 100}%;height:${(it.height / size.height) * 100}%`;
      const look = [it.fill ? `background:${it.fill}` : '', it.stroke ? `border:1px solid ${it.stroke}` : '', it.shapeType === 'ELLIPSE' || it.shapeType === 'CIRCLE' ? 'border-radius:50%' : ''].filter(Boolean).join(';');
      const lvl = HEAD_LEVEL[it.textType ?? ''];
      const inner = it.kind === 'image' ? `<img src="${esc(it.source ?? '')}" alt="${esc(it.alt ?? '')}">` : it.kind === 'table' ? htmlTable(it.rows ?? [], true) : it.runs ? (lvl ? `<h${lvl}>${htmlInline(it.runs)}</h${lvl}>` : `<p>${htmlInline(it.runs)}</p>`) : '';
      return `<div class="item" style="${pos}${look ? ';' + look : ''}">${inner}</div>`;
    }).join('\n');
    body.push(`<section class="slide" aria-label="Slide ${i + 1}" style="aspect-ratio:${size.width}/${size.height}${s.background ? `;background:${s.background}` : ''}">\n${items}\n</section>`);
  });
  m.sheets?.forEach((sh) => body.push(`<h2>${esc(sh.name)}</h2>\n${htmlTable(sheetMatrix(sh))}`));
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.name ?? 'Documento')}</title>
<style>
body{font-family:system-ui,sans-serif;line-height:1.5;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#1e293b}
table{border-collapse:collapse;margin:1rem 0}td,th{border:1px solid #cbd5e1;padding:.25rem .5rem}th{background:#f1f5f9}
h1.title{text-align:center}.subtitle{text-align:center;color:#475569}
img{max-width:100%}.page-break{break-after:page;border:0}
.slide{position:relative;width:100%;border:1px solid #cbd5e1;margin:1rem 0;overflow:hidden;background:#fff}.slide .item{position:absolute;box-sizing:border-box;overflow:hidden}.slide p,.slide h1,.slide h2{margin:0}
</style>
</head>
<body>
${body.join('\n')}
</body>
</html>
`;
}

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'img', 'hr', 'pre', 'blockquote', 'figure', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'body', 'html', 'li', 'tr', 'thead', 'tbody', 'figcaption', 'dl', 'dt', 'dd']);

function inlineRuns(n: XNode, base: Record<string, unknown> = {}, out: RunM[] = []): RunM[] {
  for (const c of n.children) {
    if (c.name === '#text') { const t = c.text.replace(/\s+/g, ' '); if (t) out.push({ text: t, format: { ...base } }); continue; }
    if (c.name === 'br') { out.push({ text: '\n', format: { ...base } }); continue; }
    if (['ul', 'ol', 'table', 'img'].includes(c.name)) continue;
    const f: Record<string, unknown> = { ...base };
    if (c.name === 'strong' || c.name === 'b') f.bold = true;
    if (c.name === 'em' || c.name === 'i') f.italic = true;
    if (c.name === 'u' || c.name === 'ins') f.underline = true;
    if (c.name === 's' || c.name === 'del' || c.name === 'strike') f.strike = true;
    if (c.name === 'code') { f.code = true; f.fontFamily = 'monospace'; }
    if (c.name === 'a' && c.attrs.href) f.link = c.attrs.href;
    const st = c.attrs.style ?? '';
    const color = /(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,8})/i.exec(st); if (color) f.color = color[1].toUpperCase();
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) f.bold = true;
    if (/font-style\s*:\s*italic/i.test(st)) f.italic = true;
    if (/text-decoration[^;]*underline/i.test(st)) f.underline = true;
    if (/text-decoration[^;]*line-through/i.test(st)) f.strike = true;
    inlineRuns(c, f, out);
  }
  return out;
}
const tidy = (runs: RunM[]) => {
  const out: RunM[] = [];
  for (const r of runs) { const last = out.at(-1); if (last && JSON.stringify(last.format) === JSON.stringify(r.format)) last.text += r.text; else out.push({ ...r }); }
  if (out.length) { out[0].text = out[0].text.replace(/^\s+/, ''); out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, ''); }
  return out.filter((r) => r.text);
};

export function fromHtml(src: string): ImportModel {
  const doc = parseXml(src, true);
  const blocks: BlockM[] = [];
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(src)?.[1]?.trim();
  const scalar = (s: string): Scalar => { const t = s.trim(); return t === '' ? null : /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t; };
  let pending: RunM[] = [];
  const flush = () => { const r = tidy(pending); if (r.length) blocks.push({ kind: 'text', textType: 'PARAGRAPH', runs: r }); pending = []; };
  const list = (n: XNode, level: number, items: { level: number; runs: RunM[] }[]) => {
    for (const li of kids(n, 'li')) {
      items.push({ level, runs: tidy(inlineRuns(li)) });
      for (const sub of li.children.filter((c) => c.name === 'ul' || c.name === 'ol')) list(sub, level + 1, items);
    }
    return items;
  };
  const walk = (n: XNode) => {
    for (const c of n.children) {
      if (c.name === '#text' || !BLOCK_TAGS.has(c.name)) { pending.push(...inlineRuns({ ...n, children: [c] })); continue; }
      flush();
      const h = /^h([1-6])$/.exec(c.name);
      if (h) { const r = tidy(inlineRuns(c)); const cls = ` ${c.attrs.class ?? ''} `; if (r.length) blocks.push({ kind: 'text', textType: cls.includes(' title ') ? 'TITLE' : cls.includes(' subtitle ') ? 'SUBTITLE' : LEVEL_TYPE[Number(h[1])], runs: r }); }
      else if (c.name === 'p' || c.name === 'figcaption' || c.name === 'dt' || c.name === 'dd') { const r = tidy(inlineRuns(c)); if (r.length) blocks.push({ kind: 'text', textType: 'PARAGRAPH', runs: r }); for (const img of c.children.filter((x) => x.name === 'img')) blocks.push({ kind: 'image', alt: img.attrs.alt ?? '', source: img.attrs.src }); }
      else if (c.name === 'blockquote') { const r = tidy(inlineRuns(c)); if (r.length) blocks.push({ kind: 'text', textType: 'QUOTE', runs: r }); }
      else if (c.name === 'pre') blocks.push({ kind: 'text', textType: 'CODE', runs: [{ text: textContent(c).replace(/\n$/, '') }] });
      else if (c.name === 'ul' || c.name === 'ol') blocks.push({ kind: 'list', listType: c.name === 'ol' ? 'NUMBERED' : 'BULLET', items: list(c, 0, []) });
      else if (c.name === 'table') {
        const trs: XNode[] = [];
        const collect = (x: XNode) => { for (const k of kids(x)) { if (k.name === 'tr') trs.push(k); else if (['thead', 'tbody', 'tfoot'].includes(k.name)) collect(k); } };
        collect(c);
        const rows = trs.map((tr) => kids(tr).filter((x) => x.name === 'td' || x.name === 'th').map((td) => scalar(textContent(td).replace(/\s+/g, ' '))));
        if (rows.length) blocks.push({ kind: 'table', header: Boolean(trs[0] && kids(trs[0], 'th').length), rows });
      } else if (c.name === 'img') blocks.push({ kind: 'image', alt: c.attrs.alt ?? '', source: c.attrs.src });
      else if (c.name === 'hr') blocks.push({ kind: 'break' });
      else walk(c);
    }
    flush();
  };
  walk(doc);
  return { blocks, ...(title ? { name: title } : {}) };
}

// ---------------------------------------------------------------- CSV

export function toCsv(rows: Scalar[][], opts: { delimiter?: string; decimal?: string } = {}): string {
  const d = opts.delimiter ?? ',', dec = opts.decimal ?? '.';
  const cell = (v: Scalar) => {
    const s = typeof v === 'number' ? String(v).replace('.', dec) : show(v);
    return /["\n\r]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(d)).join('\r\n') + '\r\n';
}

export function parseCsv(src: string, opts: { delimiter?: string; decimal?: string } = {}): Scalar[][] {
  const text = src.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const best = [';', '\t', ','].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0];
  const d = opts.delimiter ?? (best[1] > 1 ? best[0] : ',');
  const dec = opts.decimal ?? (d === ';' ? ',' : '.');
  const rows: string[][] = [];
  let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"' && f === '') q = true;
    else if (ch === d) { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const num = dec === ',' ? /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/ : /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
  return rows.map((r) => r.map((s): Scalar => {
    const t = s.trim();
    if (t === '') return null;
    if (num.test(t)) return Number(dec === ',' ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
    if (/^(verdadeiro|true)$/i.test(t)) return true;
    if (/^(falso|false)$/i.test(t)) return false;
    return s;
  }));
}

export function sheetFromRows(name: string, rows: Scalar[][]): SheetM {
  const cells: SheetM['cells'] = {};
  rows.forEach((r, i) => r.forEach((v, j) => { if (v !== null && v !== '') cells[toAddress({ row: i + 1, col: j + 1 })] = typeof v === 'string' && v.startsWith('=') ? { formula: v } : { value: v }; }));
  return { name, cells };
}
export const colName = indexToCol;
