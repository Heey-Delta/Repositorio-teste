// Formatos do Office (Office Open XML): XLSX, DOCX e PPTX — escrita e leitura, sem dependências.
// Fórmulas vão para o XLSX com nomes de função em inglês e separador ","; na leitura o motor entende os dois.
import type { BlockM, ImportModel, RunM, Scalar, SheetM, SlideItemM, SlideM } from './model.ts';
import { plain } from './model.ts';
import { readZip, writeZip, fromUtf8, type ZipEntry } from './zip.ts';
import { all, attr, esc, kid, kids, parseXml, textContent, type XNode } from './xml.ts';
import { parse, stringify, mapRefs, toAddress, parseAddress, type Ast } from '../formula/parse.ts';
import { createRegistry } from '../formula/functions.ts';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = (type: string) => `${NS_R}/${type}`;
const rels = (list: { id: string; type: string; target: string; external?: boolean }[]) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((r) => `<Relationship Id="${r.id}" Type="${r.type.startsWith('http') ? r.type : REL(r.type)}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
const hex6 = (c: unknown) => { const m = /^#?([0-9a-f]{6})/i.exec(String(c ?? '')) ?? /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(String(c ?? '')); if (!m) return null; return (m.length === 4 ? m[1] + m[1] + m[2] + m[2] + m[3] + m[3] : m[1]).toUpperCase(); };
const bytesToB64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' };
const dataUri = (path: string, bytes: Uint8Array) => `data:${MIME[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream'};base64,${bytesToB64(bytes)}`;
const parseDataUri = (src?: string) => { const m = /^data:([^;,]+);base64,(.*)$/s.exec(src ?? ''); return m ? { mime: m[1], ext: Object.entries(MIME).find(([, v]) => v === m[1])?.[0] ?? 'bin', bytes: b64ToBytes(m[2]) } : null; };
/** Caminho relativo ("../media/x.png") resolvido contra a pasta do arquivo que aponta. */
const resolve = (from: string, target: string) => { if (target.startsWith('/')) return target.slice(1); const parts = from.split('/').slice(0, -1); for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); } return parts.join('/'); };
async function relsOf(zip: Map<string, Uint8Array>, part: string): Promise<Map<string, { target: string; external: boolean; type: string }>> {
  const p = part.split('/'); const name = p.pop()!; const path = [...p, '_rels', `${name}.rels`].join('/');
  const x = zip.get(path);
  const out = new Map<string, { target: string; external: boolean; type: string }>();
  if (!x) return out;
  for (const r of all(parseXml(fromUtf8(x)), 'Relationship')) out.set(r.attrs.Id, { target: r.attrs.TargetMode === 'External' ? r.attrs.Target : resolve(part, r.attrs.Target), external: r.attrs.TargetMode === 'External', type: r.attrs.Type });
  return out;
}

// ---------------------------------------------------------------- fórmulas PT ⇄ Excel

let englishNames: Map<string, string> | null = null;
function toEnglish(name: string) {
  if (!englishNames) {
    englishNames = new Map();
    for (const f of createRegistry().list()) { const en = f.aliases.find((a) => /^[A-Z][A-Z0-9.]*$/.test(a)) ?? f.name; for (const n of [f.name, ...f.aliases]) englishNames.set(n.toUpperCase(), en); }
  }
  return englishNames.get(name.toUpperCase()) ?? name.toUpperCase();
}
function excelAst(a: Ast): Ast {
  switch (a.k) {
    case 'bool': return { k: 'call', name: a.v ? 'TRUE' : 'FALSE', args: [] };
    case 'call': return { k: 'call', name: toEnglish(a.name), args: a.args.map(excelAst) };
    case 'un': case 'pct': return { ...a, arg: excelAst(a.arg) };
    case 'bin': return { ...a, left: excelAst(a.left), right: excelAst(a.right) };
    default: return a;
  }
}
/** "=SOMA(A1;B1)" → "SUM(A1,B1)" (sem o "="). */
export function toExcelFormula(f: string): string {
  try { return stringify(excelAst(parse(f.replace(/^=/, ''))), ','); } catch { return f.replace(/^=/, ''); }
}
/** Fórmula compartilhada do Excel: desloca as referências relativas. */
function shiftFormula(f: string, dr: number, dc: number): string {
  try { return stringify(mapRefs(parse(f), (r) => ({ ...r, row: r.absRow ? r.row : r.row + dr, col: r.absCol ? r.col : r.col + dc })), ','); } catch { return f; }
}

// ---------------------------------------------------------------- XLSX

export function toXlsx(m: ImportModel, fallbackRows?: { name: string; rows: Scalar[][] }[]): Uint8Array {
  const sheets: SheetM[] = m.sheets?.length ? m.sheets : (fallbackRows ?? []).map((t) => ({ name: t.name, cells: Object.fromEntries(t.rows.flatMap((r, i) => r.map((v, j) => [toAddress({ row: i + 1, col: j + 1 }), { value: v }] as const)).filter(([, c]) => c.value !== null && c.value !== '')) }));
  if (!sheets.length) sheets.push({ name: 'Planilha1', cells: {} });
  const used = new Set<string>();
  const names = sheets.map((s) => { let n = (s.name || 'Planilha').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Planilha', k = 2; while (used.has(n.toLowerCase())) n = `${n.slice(0, 27)} (${k++})`; used.add(n.toLowerCase()); return n; });
  const files: ZipEntry[] = [];
  files.push({ name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` });
  files.push({ name: '_rels/.rels', data: rels([{ id: 'rId1', type: 'officeDocument', target: 'xl/workbook.xml' }]) });
  files.push({ name: 'xl/workbook.xml', data: `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: rels([...sheets.map((_, i) => ({ id: `rId${i + 1}`, type: 'worksheet', target: `worksheets/sheet${i + 1}.xml` })), { id: `rId${sheets.length + 1}`, type: 'styles', target: 'styles.xml' }]) });
  files.push({ name: 'xl/styles.xml', data: `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` });
  sheets.forEach((sh, i) => {
    const byRow = new Map<number, { col: number; addr: string; xml: string }[]>();
    for (const [addr, c] of Object.entries(sh.cells)) {
      const p = parseAddress(addr);
      const v = c.value ?? null;
      let xml: string;
      const val = typeof v === 'number' && Number.isFinite(v) ? `<v>${v}</v>` : typeof v === 'boolean' ? `<v>${v ? 1 : 0}</v>` : '';
      if (c.formula) xml = `<c r="${addr}"${typeof v === 'string' ? ' t="str"' : typeof v === 'boolean' ? ' t="b"' : ''}><f>${esc(toExcelFormula(c.formula))}</f>${typeof v === 'string' ? `<v>${esc(v)}</v>` : val}</c>`;
      else if (typeof v === 'string') xml = `<c r="${addr}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      else if (typeof v === 'boolean') xml = `<c r="${addr}" t="b">${val}</c>`;
      else if (val) xml = `<c r="${addr}">${val}</c>`;
      else continue;
      (byRow.get(p.row) ?? byRow.set(p.row, []).get(p.row)!).push({ col: p.col, addr, xml });
    }
    const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([r, cs]) => `<row r="${r}">${cs.sort((a, b) => a.col - b.col).map((c) => c.xml).join('')}</row>`).join('');
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>` });
  });
  return writeZip(files);
}

export async function fromXlsx(bytes: Uint8Array): Promise<ImportModel> {
  const zip = await readZip(bytes);
  const wbPath = 'xl/workbook.xml';
  const wb = zip.get(wbPath) ?? (() => { throw new Error('Não é uma planilha XLSX (falta xl/workbook.xml).'); })();
  const wrels = await relsOf(zip, wbPath);
  const shared: string[] = [];
  const ssEntry = [...wrels.values()].find((r) => r.type.endsWith('/sharedStrings'));
  const ss = zip.get(ssEntry?.target ?? 'xl/sharedStrings.xml');
  if (ss) for (const si of kids(kid(parseXml(fromUtf8(ss)), 'sst'), 'si')) shared.push(all(si, 't').map(textContent).join(''));
  const sheets: SheetM[] = [];
  for (const s of all(parseXml(fromUtf8(wb)), 'sheet')) {
    const rel = wrels.get(attr(s, 'id') ?? '');
    const x = rel && zip.get(rel.target);
    if (!x) continue;
    const cells: SheetM['cells'] = {};
    const masters = new Map<string, { f: string; row: number; col: number }>();
    for (const c of all(parseXml(fromUtf8(x)), 'c')) {
      const addr = c.attrs.r; if (!addr) continue;
      const t = c.attrs.t, vNode = kid(c, 'v'), fNode = kid(c, 'f');
      const raw = vNode ? textContent(vNode) : undefined;
      let value: Scalar = null;
      if (t === 's') value = shared[Number(raw)] ?? '';
      else if (t === 'inlineStr') value = all(c, 't').map(textContent).join('');
      else if (t === 'b') value = raw === '1';
      else if (t === 'str' || t === 'e') value = raw ?? '';
      else if (raw !== undefined && raw !== '') value = Number(raw);
      let formula: string | undefined;
      if (fNode) {
        const p = parseAddress(addr);
        const ftext = textContent(fNode);
        if (fNode.attrs.t === 'shared' && fNode.attrs.si !== undefined) {
          if (ftext) masters.set(fNode.attrs.si, { f: ftext, row: p.row, col: p.col });
          const mst = masters.get(fNode.attrs.si);
          formula = ftext || (mst ? shiftFormula(mst.f, p.row - mst.row, p.col - mst.col) : undefined);
        } else if (ftext) formula = ftext;
      }
      if (formula) cells[addr] = { formula: `=${formula}`, value };
      else if (value !== null && value !== '') cells[addr] = { value };
    }
    sheets.push({ name: s.attrs.name ?? `Planilha${sheets.length + 1}`, cells });
  }
  return { application: 'SPREADSHEET_EDITOR', sheets };
}

// ---------------------------------------------------------------- DOCX

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const DOCX_STYLE: Record<string, string> = { TITLE: 'Title', SUBTITLE: 'Subtitle', HEADING_1: 'Heading1', HEADING_2: 'Heading2', HEADING_3: 'Heading3', HEADING_4: 'Heading4', HEADING_5: 'Heading5', HEADING_6: 'Heading6', QUOTE: 'Quote', CODE: 'Code' };

function wRun(r: RunM): string {
  const f = r.format ?? {};
  const pr = [
    typeof f.fontFamily === 'string' && !String(f.fontFamily).startsWith('theme:') ? `<w:rFonts w:ascii="${esc(f.fontFamily === 'monospace' ? 'Consolas' : f.fontFamily)}" w:hAnsi="${esc(f.fontFamily === 'monospace' ? 'Consolas' : f.fontFamily)}"/>` : '',
    f.bold ? '<w:b/>' : '', f.italic ? '<w:i/>' : '', f.strike ? '<w:strike/>' : '',
    hex6(f.color) ? `<w:color w:val="${hex6(f.color)}"/>` : '',
    typeof f.fontSize === 'number' ? `<w:sz w:val="${Math.round(f.fontSize * 2)}"/>` : '',
    hex6(f.highlight) ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex6(f.highlight)}"/>` : '',
    f.underline ? '<w:u w:val="single"/>' : '',
    f.baseline === 'SUPERSCRIPT' ? '<w:vertAlign w:val="superscript"/>' : f.baseline === 'SUBSCRIPT' ? '<w:vertAlign w:val="subscript"/>' : '',
  ].join('');
  return r.text.split('\n').map((part, i) => `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}${i ? '<w:br/>' : ''}${part.split('\t').map((t, k) => `${k ? '<w:tab/>' : ''}<w:t xml:space="preserve">${esc(t)}</w:t>`).join('')}</w:r>`).join('');
}

export function toDocx(m: ImportModel, page: { width: number; height: number; margins: { top: number; right: number; bottom: number; left: number }; orientation?: string } = { width: 794, height: 1123, margins: { top: 96, right: 96, bottom: 96, left: 96 } }): Uint8Array {
  const tw = (px: number) => Math.round(px * 15);
  const links: { id: string; target: string }[] = [];
  const media: { id: string; path: string; bytes: Uint8Array; ext: string }[] = [];
  let nums = 0, drawing = 0;
  const numDefs: { id: number; abs: number }[] = [];
  const para = (inner: string, style?: string, extra = '') => `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${inner}</w:p>`;
  const runs = (rs: RunM[]) => rs.map((r) => {
    const link = typeof r.format?.link === 'string' ? r.format.link : null;
    if (!link) return wRun(r);
    if (link.startsWith('#')) return `<w:hyperlink w:anchor="${esc(link.slice(1))}">${wRun({ ...r, format: { ...r.format, underline: true, color: '#0563C1' } })}</w:hyperlink>`;
    const id = `rIdL${links.length + 1}`; links.push({ id, target: link });
    return `<w:hyperlink r:id="${id}">${wRun({ ...r, format: { ...r.format, underline: true, color: '#0563C1' } })}</w:hyperlink>`;
  }).join('');
  const body: string[] = [];
  const blocks = (bs: BlockM[]) => {
    for (const b of bs) {
      if (b.kind === 'text') body.push(para(runs(b.runs), DOCX_STYLE[b.textType ?? '']));
      else if (b.kind === 'list') {
        const id = ++nums; numDefs.push({ id, abs: b.listType === 'NUMBERED' ? 2 : 1 });
        for (const it of b.items) body.push(para(runs(it.runs), 'ListParagraph', `<w:numPr><w:ilvl w:val="${Math.min(8, it.level)}"/><w:numId w:val="${id}"/></w:numPr>`));
      } else if (b.kind === 'table') {
        const w = Math.max(1, ...b.rows.map((r) => r.length));
        const content = tw(page.width - page.margins.left - page.margins.right), col = Math.floor(content / w);
        const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`).join('');
        body.push(`<w:tbl><w:tblPr><w:tblW w:w="${col * w}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLook w:val="04A0" w:firstRow="${b.header ? 1 : 0}" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${Array(w).fill(`<w:gridCol w:w="${col}"/>`).join('')}</w:tblGrid>${b.rows.map((r, i) => `<w:tr>${i === 0 && b.header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${Array.from({ length: w }, (_, k) => `<w:tc><w:tcPr><w:tcW w:w="${col}" w:type="dxa"/></w:tcPr>${para(wRun({ text: r[k] === null || r[k] === undefined ? '' : typeof r[k] === 'boolean' ? (r[k] ? 'VERDADEIRO' : 'FALSO') : String(r[k]), format: i === 0 && b.header ? { bold: true } : {} }))}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`);
        body.push('<w:p/>');
      } else if (b.kind === 'image') {
        const img = parseDataUri(b.source);
        if (!img) { body.push(para(wRun({ text: `[Imagem${b.alt ? `: ${b.alt}` : ''}]`, format: { italic: true } }))); continue; }
        const id = `rIdM${media.length + 1}`, path = `media/image${media.length + 1}.${img.ext}`;
        media.push({ id, path, bytes: img.bytes, ext: img.ext });
        const maxW = page.width - page.margins.left - page.margins.right;
        const w0 = b.width ?? 320, h0 = b.height ?? 240, k = Math.min(1, maxW / w0);
        const cx = Math.round(w0 * k * 9525), cy = Math.round(h0 * k * 9525), n = ++drawing;
        body.push(`<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Imagem ${n}" descr="${esc(b.alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="Imagem ${n}" descr="${esc(b.alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
      } else if (b.kind === 'shape') { if (b.runs?.length) body.push(para(runs(b.runs), undefined, '<w:jc w:val="center"/>')); }
      else body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }
  };
  if (m.blocks) blocks(m.blocks);
  m.slides?.forEach((s, i) => { if (i) blocks([{ kind: 'break' }]); blocks(s.items.flatMap((it): BlockM[] => it.runs ? [{ kind: 'text', textType: it.textType, runs: it.runs }] : it.rows ? [{ kind: 'table', header: true, rows: it.rows }] : it.kind === 'image' ? [{ kind: 'image', alt: it.alt ?? '', source: it.source }] : [])); });
  m.sheets?.forEach((sh) => blocks([{ kind: 'text', textType: 'HEADING_2', runs: [{ text: sh.name }] }, { kind: 'table', header: false, rows: Object.keys(sh.cells).length ? sheetRows(sh) : [] }].filter((b) => b.kind !== 'table' || (b.rows?.length ?? 0) > 0) as BlockM[]));
  const landscape = page.width > page.height;
  const sect = `<w:sectPr><w:pgSz w:w="${tw(page.width)}" w:h="${tw(page.height)}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(page.margins.top)}" w:right="${tw(page.margins.right)}" w:bottom="${tw(page.margins.bottom)}" w:left="${tw(page.margins.left)}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  const heading = (id: string, name: string, size: number, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/>${extra}</w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  // mesma numeração da tela (Word): 1. → a. → i. → 1. …
  const lvls = (fmt: 'bullet' | 'decimal') => Array.from({ length: 9 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt === 'bullet' ? 'bullet' : ['decimal', 'lowerLetter', 'lowerRoman'][i % 3]}"/><w:lvlText w:val="${fmt === 'bullet' ? ['•', '◦', '▪'][i % 3] : `%${i + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
  const files: ZipEntry[] = [
    { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...new Set(media.map((x) => x.ext))].map((ext) => `<Default Extension="${ext}" ContentType="${MIME[ext] ?? 'application/octet-stream'}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: rels([{ id: 'rId1', type: 'officeDocument', target: 'word/document.xml' }, { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' }]) },
    { name: 'docProps/core.xml', data: `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(m.name ?? '')}</dc:title></cp:coreProperties>` },
    { name: 'word/_rels/document.xml.rels', data: rels([{ id: 'rId1', type: 'styles', target: 'styles.xml' }, { id: 'rId2', type: 'numbering', target: 'numbering.xml' }, ...links.map((l) => ({ id: l.id, type: 'hyperlink', target: l.target, external: true })), ...media.map((x) => ({ id: x.id, type: 'image', target: x.path }))]) },
    { name: 'word/document.xml', data: `${XML}<w:document ${W_NS}><w:body>${body.join('')}${sect}</w:body></w:document>` },
    { name: 'word/styles.xml', data: `${XML}<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading('Title', 'Title', 56)}${heading('Subtitle', 'Subtitle', 32)}${[32, 26, 24, 22, 22, 22].map((s, i) => heading(`Heading${i + 1}`, `heading ${i + 1}`, s, `<w:outlineLvl w:val="${i}"/>`)).join('')}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="864" w:right="864"/></w:pPr><w:rPr><w:i/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style></w:styles>` },
    { name: 'word/numbering.xml', data: `${XML}<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('bullet')}</w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('decimal')}</w:abstractNum>${numDefs.map((n) => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="${n.abs}"/>${n.abs === 2 ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ''}</w:num>`).join('')}</w:numbering>` },
    ...media.map((x) => ({ name: `word/${x.path}`, data: x.bytes })),
  ];
  return writeZip(files);
}
const sheetRows = (sh: SheetM): Scalar[][] => {
  let R = 0, C = 0;
  for (const a of Object.keys(sh.cells)) { const p = parseAddress(a); R = Math.max(R, p.row); C = Math.max(C, p.col); }
  const out: Scalar[][] = Array.from({ length: R }, () => Array(C).fill(null));
  for (const [a, c] of Object.entries(sh.cells)) { const p = parseAddress(a); out[p.row - 1][p.col - 1] = c.value ?? null; }
  return out;
};

const on = (n: XNode | undefined) => !!n && !['0', 'false', 'none'].includes(attr(n, 'val') ?? '');
function docxRunFormat(rPr: XNode | undefined): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if (!rPr) return f;
  if (on(kid(rPr, 'b'))) f.bold = true;
  if (on(kid(rPr, 'i'))) f.italic = true;
  if (on(kid(rPr, 'u'))) f.underline = true;
  if (on(kid(rPr, 'strike')) || on(kid(rPr, 'dstrike'))) f.strike = true;
  const c = attr(kid(rPr, 'color'), 'val'); if (c && c !== 'auto' && /^[0-9a-f]{6}$/i.test(c)) f.color = `#${c.toUpperCase()}`;
  const sz = attr(kid(rPr, 'sz'), 'val'); if (sz) f.fontSize = Number(sz) / 2;
  const font = attr(kid(rPr, 'rFonts'), 'ascii'); if (font) f.fontFamily = font;
  const va = attr(kid(rPr, 'vertAlign'), 'val'); if (va === 'superscript') f.baseline = 'SUPERSCRIPT'; else if (va === 'subscript') f.baseline = 'SUBSCRIPT';
  const shd = attr(kid(rPr, 'shd'), 'fill'); if (shd && /^[0-9a-f]{6}$/i.test(shd)) f.highlight = `#${shd.toUpperCase()}`;
  return f;
}

export async function fromDocx(bytes: Uint8Array): Promise<ImportModel> {
  const zip = await readZip(bytes);
  const docPath = 'word/document.xml';
  const xml = zip.get(docPath) ?? (() => { throw new Error('Não é um documento DOCX (falta word/document.xml).'); })();
  const drels = await relsOf(zip, docPath);
  // estilos: id → nome (o Word em português usa ids como "Ttulo1")
  const styleName = new Map<string, string>();
  const charStyle = new Map<string, Record<string, unknown>>();
  const st = zip.get('word/styles.xml');
  if (st) for (const s of all(parseXml(fromUtf8(st)), 'style')) {
    const id = attr(s, 'styleId') ?? '', name = (attr(kid(s, 'name'), 'val') ?? '').toLowerCase();
    styleName.set(id, name);
    if (attr(s, 'type') === 'character') charStyle.set(id, { ...(name.includes('strong') ? { bold: true } : {}), ...(name === 'emphasis' ? { italic: true } : {}), ...docxRunFormat(kid(s, 'rPr')) });
  }
  const numFmt = new Map<string, string>();
  const nb = zip.get('word/numbering.xml');
  if (nb) {
    const root = parseXml(fromUtf8(nb));
    const abs = new Map<string, string>();
    for (const a of all(root, 'abstractNum')) abs.set(attr(a, 'abstractNumId') ?? '', attr(kid(kids(a, 'lvl')[0], 'numFmt'), 'val') ?? 'bullet');
    for (const n of all(root, 'num')) numFmt.set(attr(n, 'numId') ?? '', abs.get(attr(kid(n, 'abstractNumId'), 'val') ?? '') ?? 'bullet');
  }
  const typeOf = (styleId?: string) => {
    const name = styleName.get(styleId ?? '') ?? (styleId ?? '').toLowerCase();
    if (name === 'title') return 'TITLE';
    if (name === 'subtitle') return 'SUBTITLE';
    if (name === 'quote' || name === 'intense quote') return 'QUOTE';
    const h = /^heading\s*([1-6])$/.exec(name) ?? /^heading([1-6])$/i.exec(styleId ?? '');
    return h ? `HEADING_${h[1]}` : 'PARAGRAPH';
  };
  const blocks: BlockM[] = [];
  let list: Extract<BlockM, { kind: 'list' }> | null = null, listId = '';
  const paraRuns = (p: XNode): { runs: RunM[]; pageBreakAfter: boolean; images: BlockM[] } => {
    const out: RunM[] = [];
    const images: BlockM[] = [];
    let pageBreakAfter = false;
    const runOf = (r: XNode, extra: Record<string, unknown> = {}) => {
      const rPr = kid(r, 'rPr');
      const f = { ...(charStyle.get(attr(kid(rPr, 'rStyle'), 'val') ?? '') ?? {}), ...docxRunFormat(rPr), ...extra };
      for (const c of kids(r)) {
        const n = c.name.slice(c.name.indexOf(':') + 1);
        if (n === 't') out.push({ text: textContent(c), format: f });
        else if (n === 'tab') out.push({ text: '\t', format: f });
        else if (n === 'br') { if (attr(c, 'type') === 'page') pageBreakAfter = true; else out.push({ text: '\n', format: f }); }
        else if (n === 'drawing') {
          const blip = all(c, 'blip')[0], docPr = all(c, 'docPr')[0], ext = all(c, 'extent')[0];
          const rel = blip && drels.get(attr(blip, 'embed') ?? '');
          const data = rel && zip.get(rel.target);
          images.push({ kind: 'image', alt: attr(docPr, 'descr') ?? attr(docPr, 'title') ?? '', ...(data ? { source: dataUri(rel!.target, data) } : {}), ...(ext ? { width: Math.round(Number(ext.attrs.cx) / 9525), height: Math.round(Number(ext.attrs.cy) / 9525) } : {}) });
        }
      }
    };
    for (const c of kids(p)) {
      const n = c.name.slice(c.name.indexOf(':') + 1);
      if (n === 'r') runOf(c);
      else if (n === 'hyperlink') { const rel = drels.get(attr(c, 'id') ?? ''); const href = rel?.target ?? (attr(c, 'anchor') ? `#${attr(c, 'anchor')}` : undefined); for (const r of kids(c, 'r')) runOf(r, href ? { link: href } : {}); }
      else if (n === 'ins' || n === 'smartTag' || n === 'fldSimple' || n === 'sdt') for (const r of all(c, 'r')) runOf(r);
    }
    const merged: RunM[] = [];
    for (const r of out) { const last = merged.at(-1); if (last && JSON.stringify(last.format) === JSON.stringify(r.format)) last.text += r.text; else merged.push({ text: r.text, format: { ...r.format } }); }
    for (const r of merged) if (r.format && !Object.keys(r.format).length) delete r.format;
    return { runs: merged, pageBreakAfter, images };
  };
  const body = all(parseXml(fromUtf8(xml)), 'body')[0];
  const visit = (n: XNode) => {
    for (const c of kids(n)) {
      const name = c.name.slice(c.name.indexOf(':') + 1);
      if (name === 'p') {
        const pPr = kid(c, 'pPr');
        const numPr = kid(pPr, 'numPr');
        const { runs, pageBreakAfter, images } = paraRuns(c);
        if (numPr) {
          const id = attr(kid(numPr, 'numId'), 'val') ?? '0', lvl = Number(attr(kid(numPr, 'ilvl'), 'val') ?? 0);
          if (id !== '0') {
            const type = numFmt.get(id) === 'bullet' || !numFmt.has(id) ? 'BULLET' : 'NUMBERED';
            if (!list || listId !== id) { list = { kind: 'list', listType: type, items: [] }; listId = id; blocks.push(list); }
            list.items.push({ level: lvl, runs });
            continue;
          }
        }
        list = null;
        if (plain(runs).trim()) blocks.push({ kind: 'text', textType: typeOf(attr(kid(pPr, 'pStyle'), 'val')), runs });
        blocks.push(...images);
        if (pageBreakAfter) blocks.push({ kind: 'break' });
      } else if (name === 'tbl') {
        list = null;
        const rows: Scalar[][] = kids(c, 'tr').map((tr) => kids(tr, 'tc').map((tc) => { const t = kids(tc, 'p').map((p) => plain(paraRuns(p).runs)).join('\n'); return t === '' ? null : /^-?\d+([.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : t; }));
        const first = kids(c, 'tr')[0];
        blocks.push({ kind: 'table', header: !!kid(kid(first, 'trPr'), 'tblHeader'), rows });
      } else if (name === 'sdt') visit(kid(c, 'sdtContent') ?? c);
    }
  };
  visit(body);
  // tira parágrafos vazios das pontas
  while (blocks[0]?.kind === 'text' && !plain((blocks[0] as any).runs).trim()) blocks.shift();
  while (blocks.at(-1)?.kind === 'text' && !plain((blocks.at(-1) as any).runs).trim()) blocks.pop();
  const title = zip.get('docProps/core.xml') ? textContent(all(parseXml(fromUtf8(zip.get('docProps/core.xml')!)), 'title')[0] ?? { name: '#text', attrs: {}, children: [], text: '' }) : '';
  return { application: 'DOCUMENT_EDITOR', blocks, ...(title ? { name: title } : {}) };
}

// ---------------------------------------------------------------- PPTX

const EMU = 9525;
const PRESET: Record<string, string> = { RECTANGLE: 'rect', SQUARE: 'rect', ROUNDED_RECTANGLE: 'roundRect', CIRCLE: 'ellipse', ELLIPSE: 'ellipse', TRIANGLE: 'triangle', DIAMOND: 'diamond', PENTAGON: 'pentagon', HEXAGON: 'hexagon', STAR: 'star5', ARROW: 'rightArrow', CALLOUT: 'wedgeRectCallout', POLYGON: 'octagon', OCTAGON: 'octagon', RIGHT_TRIANGLE: 'rtTriangle', PARALLELOGRAM: 'parallelogram', TRAPEZOID: 'trapezoid', STAR6: 'star6', ARROW_LEFT: 'leftArrow', ARROW_UP: 'upArrow', ARROW_DOWN: 'downArrow', DOUBLE_ARROW: 'leftRightArrow', CHEVRON: 'chevron', CLOUD: 'cloud', HEART: 'heart', CROSS: 'plus', LIGHTNING: 'lightningBolt', MOON: 'moon', DOCUMENT: 'flowChartDocument', CYLINDER: 'can', LINE: 'line' };
const FROM_PRESET: Record<string, string> = Object.fromEntries(Object.entries(PRESET).filter(([k]) => !['SQUARE', 'CIRCLE'].includes(k)).map(([k, v]) => [v, k]));
const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function aParas(runs: RunM[], baseSize: number): string {
  const paras: RunM[][] = [[]];
  for (const r of runs) r.text.split('\n').forEach((part, i) => { if (i) paras.push([]); if (part) paras.at(-1)!.push({ text: part, format: r.format }); });
  return paras.map((rs) => `<a:p>${rs.map((r) => {
    const f = r.format ?? {};
    const color = hex6(f.color);
    const font = typeof f.fontFamily === 'string' && !String(f.fontFamily).startsWith('theme:') ? f.fontFamily : null;
    return `<a:r><a:rPr lang="pt-BR" sz="${Math.round((typeof f.fontSize === 'number' ? f.fontSize : baseSize) * 100)}"${f.bold ? ' b="1"' : ''}${f.italic ? ' i="1"' : ''}${f.underline ? ' u="sng"' : ''}${f.strike ? ' strike="sngStrike"' : ''} dirty="0">${color ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : ''}${font ? `<a:latin typeface="${esc(font)}"/>` : ''}</a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
  }).join('')}<a:endParaRPr lang="pt-BR" sz="${baseSize * 100}" dirty="0"/></a:p>`).join('');
}

export function toPptx(m: ImportModel): Uint8Array {
  const size = m.slideSize ?? { width: 1280, height: 720 };
  const slides: SlideM[] = m.slides?.length ? m.slides : [{ items: (m.blocks ?? []).filter((b): b is Extract<BlockM, { kind: 'text' }> => b.kind === 'text').slice(0, 12).map((b, i) => ({ kind: 'text', x: 60, y: 40 + i * 50, width: size.width - 120, height: 44, textType: b.textType, runs: b.runs })) }];
  const files: ZipEntry[] = [];
  const media: { name: string; bytes: Uint8Array; ext: string }[] = [];
  const slideXml = slides.map((s, si) => {
    let id = 2;
    const srels: { id: string; type: string; target: string }[] = [{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }];
    const xfrm = (it: SlideItemM, tag = 'a') => `<${tag}:xfrm><a:off x="${Math.round(it.x * EMU)}" y="${Math.round(it.y * EMU)}"/><a:ext cx="${Math.max(1, Math.round(it.width * EMU))}" cy="${Math.max(1, Math.round(it.height * EMU))}"/></${tag}:xfrm>`;
    const shapes = s.items.map((it) => {
      const n = id++;
      const fill = hex6(it.fill), line = hex6(it.stroke);
      const isTitle = it.textType === 'TITLE' || it.textType === 'HEADING_1';
      if (it.kind === 'text' || it.kind === 'shape') {
        const geom = it.kind === 'shape' ? PRESET[it.shapeType ?? 'RECTANGLE'] ?? 'rect' : 'rect';
        const spFill = fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : it.kind === 'shape' ? '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>' : '<a:noFill/>';
        const ln = line ? `<a:ln w="12700"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>` : '';
        const base = isTitle ? 40 : it.textType?.startsWith('HEADING') ? 28 : it.textType === 'SUBTITLE' ? 24 : 18;
        return `<p:sp><p:nvSpPr><p:cNvPr id="${n}" name="${isTitle ? 'Título' : it.kind === 'shape' ? 'Forma' : 'Texto'} ${n}"/><p:cNvSpPr${it.kind === 'text' ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(it)}<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${spFill}${ln}</p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"${it.kind === 'shape' ? ' anchor="ctr"' : ''}><a:normAutofit/></a:bodyPr><a:lstStyle/>${it.runs?.length ? aParas(it.runs, base) : `<a:p><a:endParaRPr lang="pt-BR" dirty="0"/></a:p>`}</p:txBody></p:sp>`;
      }
      if (it.kind === 'line') return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${n}" name="Linha ${n}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(it)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="${line ?? '404040'}"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`;
      if (it.kind === 'table') {
        const rows = it.rows ?? [[null]], w = Math.max(1, ...rows.map((r) => r.length));
        const colW = Math.round((it.width * EMU) / w), rowH = Math.round((it.height * EMU) / Math.max(1, rows.length));
        return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${n}" name="Tabela ${n}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrm(it, 'p')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${Array(w).fill(`<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>${rows.map((r) => `<a:tr h="${rowH}">${Array.from({ length: w }, (_, k) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${aParas([{ text: r[k] === null || r[k] === undefined ? '' : String(r[k]) }], 14)}</a:txBody><a:tcPr><a:lnL w="6350"><a:solidFill><a:srgbClr val="A6A6A6"/></a:solidFill></a:lnL><a:lnR w="6350"><a:solidFill><a:srgbClr val="A6A6A6"/></a:solidFill></a:lnR><a:lnT w="6350"><a:solidFill><a:srgbClr val="A6A6A6"/></a:solidFill></a:lnT><a:lnB w="6350"><a:solidFill><a:srgbClr val="A6A6A6"/></a:solidFill></a:lnB></a:tcPr></a:tc>`).join('')}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
      }
      const img = parseDataUri(it.source);
      if (!img) return `<p:sp><p:nvSpPr><p:cNvPr id="${n}" name="Imagem ${n}" descr="${esc(it.alt ?? '')}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(it)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>${aParas([{ text: `[Imagem${it.alt ? `: ${it.alt}` : ''}]` }], 14)}</p:txBody></p:sp>`;
      const name = `image${media.length + 1}.${img.ext}`;
      media.push({ name, bytes: img.bytes, ext: img.ext });
      const rid = `rId${srels.length + 1}`;
      srels.push({ id: rid, type: 'image', target: `../media/${name}` });
      return `<p:pic><p:nvPicPr><p:cNvPr id="${n}" name="Imagem ${n}" descr="${esc(it.alt ?? '')}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(it)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    }).join('');
    const bg = hex6(s.background);
    files.push({ name: `ppt/slides/_rels/slide${si + 1}.xml.rels`, data: rels(srels) });
    return `${XML}<p:sld ${P_NS}><p:cSld>${bg ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` : ''}<p:spTree>${GRP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  });
  const exts = [...new Set(media.map((x) => x.ext))];
  files.push({ name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.map((e) => `<Default Extension="${e}" ContentType="${MIME[e] ?? 'application/octet-stream'}"/>`).join('')}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideXml.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>` });
  files.push({ name: '_rels/.rels', data: rels([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }]) });
  files.push({ name: 'ppt/presentation.xml', data: `${XML}<p:presentation ${P_NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideXml.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${Math.round(size.width * EMU)}" cy="${Math.round(size.height * EMU)}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr lang="pt-BR"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>` });
  files.push({ name: 'ppt/_rels/presentation.xml.rels', data: rels([{ id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' }, { id: 'rId2', type: 'theme', target: 'theme/theme1.xml' }, ...slideXml.map((_, i) => ({ id: `rId${i + 3}`, type: 'slide', target: `slides/slide${i + 1}.xml` }))]) });
  files.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: `${XML}<p:sldMaster ${P_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4000"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>` });
  files.push({ name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }, { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' }]) });
  files.push({ name: 'ppt/slideLayouts/slideLayout1.xml', data: `${XML}<p:sldLayout ${P_NS} type="blank" preserve="1"><p:cSld name="Em branco"><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` });
  files.push({ name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]) });
  const solid = (c: string) => `<a:solidFill><a:schemeClr val="${c}"/></a:solidFill>`;
  files.push({ name: 'ppt/theme/theme1.xml', data: `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Hallan"><a:themeElements><a:clrScheme name="Hallan"><a:dk1><a:srgbClr val="1E293B"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0F172A"/></a:dk2><a:lt2><a:srgbClr val="F1F5F9"/></a:lt2><a:accent1><a:srgbClr val="FBBF00"/></a:accent1><a:accent2><a:srgbClr val="2563EB"/></a:accent2><a:accent3><a:srgbClr val="16A34A"/></a:accent3><a:accent4><a:srgbClr val="9333EA"/></a:accent4><a:accent5><a:srgbClr val="EA580C"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Hallan"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Hallan"><a:fillStyleLst>${solid('phClr').repeat(3)}</a:fillStyleLst><a:lnStyleLst>${`<a:ln w="6350">${solid('phClr')}</a:ln>`.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${solid('phClr').repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>` });
  slideXml.forEach((x, i) => files.push({ name: `ppt/slides/slide${i + 1}.xml`, data: x }));
  for (const x of media) files.push({ name: `ppt/media/${x.name}`, data: x.bytes });
  return writeZip(files);
}

function aRuns(txBody: XNode | undefined): RunM[] {
  const out: RunM[] = [];
  kids(txBody, 'p').forEach((p, i) => {
    if (i) out.push({ text: '\n' });
    for (const r of kids(p)) {
      const n = r.name.slice(r.name.indexOf(':') + 1);
      if (n === 'br') { out.push({ text: '\n' }); continue; }
      if (n !== 'r' && n !== 'fld') continue;
      const pr = kid(r, 'rPr'), f: Record<string, unknown> = {};
      if (pr?.attrs.b === '1') f.bold = true;
      if (pr?.attrs.i === '1') f.italic = true;
      if (pr?.attrs.u && pr.attrs.u !== 'none') f.underline = true;
      if (pr?.attrs.strike && pr.attrs.strike !== 'noStrike') f.strike = true;
      if (pr?.attrs.sz) f.fontSize = Number(pr.attrs.sz) / 100;
      const c = attr(kid(kid(pr, 'solidFill'), 'srgbClr'), 'val'); if (c) f.color = `#${c.toUpperCase()}`;
      const font = attr(kid(pr, 'latin'), 'typeface'); if (font && !font.startsWith('+')) f.fontFamily = font;
      out.push({ text: textContent(kid(r, 't') ?? { name: '#text', attrs: {}, children: [], text: '' }), ...(Object.keys(f).length ? { format: f } : {}) });
    }
  });
  const merged: RunM[] = [];
  for (const r of out) { const last = merged.at(-1); if (last && JSON.stringify(last.format) === JSON.stringify(r.format)) last.text += r.text; else merged.push({ ...r }); }
  return merged.filter((r) => r.text);
}

export async function fromPptx(bytes: Uint8Array): Promise<ImportModel> {
  const zip = await readZip(bytes);
  const presPath = 'ppt/presentation.xml';
  const pres = zip.get(presPath) ?? (() => { throw new Error('Não é uma apresentação PPTX (falta ppt/presentation.xml).'); })();
  const prels = await relsOf(zip, presPath);
  const root = parseXml(fromUtf8(pres));
  const sz = all(root, 'sldSz')[0];
  const size = sz ? { width: Math.round(Number(sz.attrs.cx) / EMU), height: Math.round(Number(sz.attrs.cy) / EMU) } : { width: 1280, height: 720 };
  const slides: SlideM[] = [];
  for (const sid of all(root, 'sldId')) {
    const rel = prels.get(Object.entries(sid.attrs).find(([k]) => /(^|:)id$/.test(k) && k.includes(':'))?.[1] ?? '');   // r:id (o "id" sem prefixo é o número do slide)
    const x = rel && zip.get(rel.target);
    if (!x) continue;
    const srels = await relsOf(zip, rel!.target);
    const sld = parseXml(fromUtf8(x));
    const items: SlideItemM[] = [];
    const boxOf = (spPr: XNode | undefined, fallback: { x: number; y: number; width: number; height: number }) => {
      const xf = kid(spPr, 'xfrm');
      const off = kid(xf, 'off'), ext = kid(xf, 'ext');
      return off && ext ? { x: Number(off.attrs.x) / EMU, y: Number(off.attrs.y) / EMU, width: Number(ext.attrs.cx) / EMU, height: Number(ext.attrs.cy) / EMU } : fallback;
    };
    let auto = 0;
    const fallback = () => ({ x: 60, y: 40 + (auto++) * 90, width: size.width - 120, height: 80 });
    const walk = (tree: XNode | undefined, dx = 0, dy = 0) => {
      for (const c of kids(tree)) {
        const n = c.name.slice(c.name.indexOf(':') + 1);
        if (n === 'sp') {
          const spPr = kid(c, 'spPr');
          const b = boxOf(spPr, fallback());
          const ph = all(c, 'ph')[0];
          const isTitle = ph && ['title', 'ctrTitle'].includes(ph.attrs.type ?? '');
          const runs = aRuns(kid(c, 'txBody'));
          const geom = attr(kid(spPr, 'prstGeom'), 'prst');
          const fill = attr(kid(kid(spPr, 'solidFill'), 'srgbClr'), 'val');
          const line = attr(kid(kid(kid(spPr, 'ln'), 'solidFill'), 'srgbClr'), 'val');
          const txBox = attr(all(c, 'cNvSpPr')[0], 'txBox') === '1';
          const isShape = !txBox && !ph && (fill || (geom && geom !== 'rect'));
          items.push({ kind: isShape ? 'shape' : 'text', x: b.x + dx, y: b.y + dy, width: b.width, height: b.height, ...(isShape ? { shapeType: FROM_PRESET[geom ?? 'rect'] ?? 'RECTANGLE' } : { textType: isTitle ? 'TITLE' : ph?.attrs.type === 'subTitle' ? 'SUBTITLE' : 'PARAGRAPH' }), ...(runs.length || !isShape ? { runs } : {}), ...(fill ? { fill: `#${fill}` } : {}), ...(line ? { stroke: `#${line}` } : {}) });
        } else if (n === 'pic') {
          const b = boxOf(kid(c, 'spPr'), fallback());
          const blip = all(c, 'blip')[0];
          const r = blip && srels.get(attr(blip, 'embed') ?? '');
          const data = r && zip.get(r.target);
          items.push({ kind: 'image', x: b.x + dx, y: b.y + dy, width: b.width, height: b.height, alt: attr(all(c, 'cNvPr')[0], 'descr') ?? '', ...(data ? { source: dataUri(r!.target, data) } : {}) });
        } else if (n === 'cxnSp') {
          const b = boxOf(kid(c, 'spPr'), fallback());
          const line = attr(kid(kid(kid(kid(c, 'spPr'), 'ln'), 'solidFill'), 'srgbClr'), 'val');
          items.push({ kind: 'line', x: b.x + dx, y: b.y + dy, width: b.width, height: b.height, ...(line ? { stroke: `#${line}` } : {}) });
        } else if (n === 'graphicFrame') {
          const tbl = all(c, 'tbl')[0];
          if (!tbl) continue;
          const b = boxOf(c, fallback());
          items.push({ kind: 'table', x: b.x + dx, y: b.y + dy, width: b.width, height: b.height, rows: kids(tbl, 'tr').map((tr) => kids(tr, 'tc').map((tc) => { const t = plain(aRuns(kid(tc, 'txBody'))); return t === '' ? null : /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t; })) });
        } else if (n === 'grpSp') {
          const off = kid(kid(kid(c, 'grpSpPr'), 'xfrm'), 'off'), choff = kid(kid(kid(c, 'grpSpPr'), 'xfrm'), 'chOff');
          walk(c, dx + (off ? Number(off.attrs.x) / EMU : 0) - (choff ? Number(choff.attrs.x) / EMU : 0), dy + (off ? Number(off.attrs.y) / EMU : 0) - (choff ? Number(choff.attrs.y) / EMU : 0));
        }
      }
    };
    walk(all(sld, 'spTree')[0]);
    const bg = attr(all(all(sld, 'bg')[0] ?? { name: '', attrs: {}, children: [], text: '' }, 'srgbClr')[0], 'val');
    slides.push({ items: items.map((it) => ({ ...it, x: Math.round(it.x), y: Math.round(it.y), width: Math.round(it.width), height: Math.round(it.height) })), ...(bg ? { background: `#${bg}` } : {}) });
  }
  return { application: 'PRESENTATION_EDITOR', slideSize: size, slides };
}
