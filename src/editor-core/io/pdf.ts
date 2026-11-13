// PDF sem dependências: fontes padrão (Helvetica/Courier, codificação WinAnsi — acentos do português ok),
// quebra de linha pelas métricas da fonte, tabelas com bordas, listas, quebras de página, slides (uma página
// por slide, nas posições) e imagens JPEG embutidas (outros formatos viram um quadro com o texto alternativo).
import type { BlockM, ImportModel, RunM, Scalar, SlideItemM } from './model.ts';
import { sheetMatrix } from './text-formats.ts';

const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const WIN: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };

interface Font { bold: boolean; italic: boolean; mono: boolean; size: number; color: [number, number, number] }
const fontName = (f: Font) => (f.mono ? 'F5' : f.bold ? (f.italic ? 'F4' : 'F2') : f.italic ? 'F3' : 'F1');
function charWidth(ch: string, f: Font) {
  if (f.mono) return 600;
  const base = ch.normalize('NFD')[0];
  const c = base.charCodeAt(0);
  const w = c >= 32 && c <= 126 ? HELV[c - 32] : ch === '•' ? 350 : ch === '—' ? 1000 : ch === '–' ? 556 : 556;
  return f.bold ? w * 1.06 : w;
}
const textWidth = (s: string, f: Font) => [...s].reduce((t, ch) => t + charWidth(ch, f), 0) * f.size / 1000;
/** Texto → string literal do PDF em WinAnsi (o que não existe vira "?"). */
const pdfStr = (s: string) => '(' + [...s].map((ch) => {
  const c = ch.charCodeAt(0);
  const code = c >= 32 && c <= 126 ? c : c >= 0xa0 && c <= 0xff ? c : WIN[ch] ?? 63;
  if (code === 40 || code === 41 || code === 92) return '\\' + String.fromCharCode(code);
  return code > 126 ? '\\' + code.toString(8).padStart(3, '0') : String.fromCharCode(code);
}).join('') + ')';
const rgb = (hex?: unknown): [number, number, number] => { const m = /^#?([0-9a-f]{6})/i.exec(String(hex ?? '')); if (!m) return [0.12, 0.16, 0.23]; const v = parseInt(m[1], 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
const n2 = (x: number) => (Math.round(x * 100) / 100).toString();
const show = (v: Scalar) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'VERDADEIRO' : 'FALSO') : typeof v === 'number' ? String(v).replace('.', ',') : String(v));

interface Img { name: string; bytes: Uint8Array; w: number; h: number; gray: boolean }
function jpegInfo(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let p = 2;
  while (p < bytes.length) {
    if (bytes[p] !== 0xff) return null;
    const m = bytes[p + 1], len = (bytes[p + 2] << 8) | bytes[p + 3];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: (bytes[p + 5] << 8) | bytes[p + 6], w: (bytes[p + 7] << 8) | bytes[p + 8], gray: bytes[p + 9] === 1 };
    p += 2 + len;
  }
  return null;
}
const jpegFrom = (src?: string) => { const m = /^data:image\/jpe?g;base64,(.*)$/s.exec(src ?? ''); if (!m) return null; const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)); const info = jpegInfo(bytes); return info ? { bytes, ...info } : null; };

class Writer {
  pages: string[][] = [];
  cur: string[] = [];
  images: Img[] = [];
  W: number; H: number;
  constructor(W: number, H: number) { this.W = W; this.H = H; }
  newPage(W = this.W, H = this.H) { this.W = W; this.H = H; this.cur = []; this.pages.push(this.cur); (this.cur as any).size = [W, H]; }
  text(x: number, y: number, s: string, f: Font) { if (!s) return; this.cur.push(`BT ${f.color.map(n2).join(' ')} rg /${fontName(f)} ${n2(f.size)} Tf ${n2(x)} ${n2(this.H - y)} Td ${pdfStr(s)} Tj ET`); }
  rect(x: number, y: number, w: number, h: number, fill?: [number, number, number], stroke?: [number, number, number]) {
    const ops = [`${n2(x)} ${n2(this.H - y - h)} ${n2(w)} ${n2(h)} re`];
    if (fill) this.cur.push(`${fill.map(n2).join(' ')} rg`);
    if (stroke) this.cur.push(`${stroke.map(n2).join(' ')} RG 0.5 w`);
    this.cur.push(`${ops[0]} ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
  }
  /** Elipse inscrita na caixa (4 curvas de Bézier). */
  ellipse(x: number, y: number, w: number, h: number, fill: [number, number, number]) {
    const k = 0.5523, rx = w / 2, ry = h / 2, cx = x + rx, cy = this.H - (y + ry);
    this.cur.push(`${fill.map(n2).join(' ')} rg ${n2(cx + rx)} ${n2(cy)} m ${n2(cx + rx)} ${n2(cy + k * ry)} ${n2(cx + k * rx)} ${n2(cy + ry)} ${n2(cx)} ${n2(cy + ry)} c ${n2(cx - k * rx)} ${n2(cy + ry)} ${n2(cx - rx)} ${n2(cy + k * ry)} ${n2(cx - rx)} ${n2(cy)} c ${n2(cx - rx)} ${n2(cy - k * ry)} ${n2(cx - k * rx)} ${n2(cy - ry)} ${n2(cx)} ${n2(cy - ry)} c ${n2(cx + k * rx)} ${n2(cy - ry)} ${n2(cx + rx)} ${n2(cy - k * ry)} ${n2(cx + rx)} ${n2(cy)} c f`);
  }
  line(x1: number, y1: number, x2: number, y2: number, c: [number, number, number] = [0.6, 0.6, 0.6], w = 0.5) { this.cur.push(`${c.map(n2).join(' ')} RG ${n2(w)} w ${n2(x1)} ${n2(this.H - y1)} m ${n2(x2)} ${n2(this.H - y2)} l S`); }
  image(img: { bytes: Uint8Array; w: number; h: number; gray: boolean }, x: number, y: number, w: number, h: number) {
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, ...img });
    this.cur.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(this.H - y - h)} cm /${name} Do Q`);
  }
  build(title: string): Uint8Array {
    const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
    const parts: Uint8Array[] = [];
    const offsets: number[] = [];
    let len = 0;
    const push = (b: Uint8Array) => { parts.push(b); len += b.length; };
    const obj = (n: number, body: string | Uint8Array[]) => { offsets[n] = len; if (typeof body === 'string') push(enc(`${n} 0 obj\n${body}\nendobj\n`)); else { push(enc(`${n} 0 obj\n`)); body.forEach(push); push(enc('\nendobj\n')); } };
    push(enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
    const fonts = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Courier'];
    // 1 catálogo · 2 páginas · 3 info · 4..8 fontes · 9.. imagens · depois páginas e conteúdos
    const imgBase = 9, pageBase = imgBase + this.images.length;
    const pageIds = this.pages.map((_, i) => pageBase + i * 2);
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${this.pages.length} >>`);
    obj(3, `<< /Title ${pdfStr(title)} /Producer (Hallan Editor) >>`);
    fonts.forEach((f, i) => obj(4 + i, `<< /Type /Font /Subtype /Type1 /BaseFont /${f}${f === 'Courier' ? '' : ' /Encoding /WinAnsiEncoding'} >>`));
    this.images.forEach((im, i) => obj(imgBase + i, [enc(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /${im.gray ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`), im.bytes, enc('\nendstream')]));
    const res = `<< /Font << ${fonts.map((_, i) => `/F${i + 1} ${4 + i} 0 R`).join(' ')} >>${this.images.length ? ` /XObject << ${this.images.map((im, i) => `/${im.name} ${imgBase + i} 0 R`).join(' ')} >>` : ''} >>`;
    this.pages.forEach((ops, i) => {
      const [W, H] = (ops as any).size as [number, number];
      const content = ops.join('\n');
      obj(pageIds[i], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(W)} ${n2(H)}] /Resources ${res} /Contents ${pageIds[i] + 1} 0 R >>`);
      obj(pageIds[i] + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });
    const total = pageBase + this.pages.length * 2;
    const xref = len;
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let k = 1; k < total; k++) x += `${String(offsets[k] ?? 0).padStart(10, '0')} 00000 n \n`;
    push(enc(`${x}trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    const out = new Uint8Array(len);
    let p = 0;
    for (const b of parts) { out.set(b, p); p += b.length; }
    return out;
  }
}

const SIZE: Record<string, number> = { TITLE: 24, SUBTITLE: 16, HEADING_1: 20, HEADING_2: 16, HEADING_3: 13.5, HEADING_4: 12, HEADING_5: 11, HEADING_6: 11 };
const fontOf = (r: RunM, base: number, bold = false): Font => {
  const f = r.format ?? {};
  return { bold: Boolean(f.bold) || bold, italic: Boolean(f.italic), mono: f.fontFamily === 'monospace' || Boolean(f.code), size: typeof f.fontSize === 'number' ? f.fontSize : base, color: rgb(f.color) };
};

/** Quebra os trechos em linhas que cabem em `width` (pontos). */
function wrap(runs: RunM[], width: number, base: number, bold = false) {
  type Piece = { text: string; font: Font; w: number };
  const lines: { pieces: Piece[]; height: number }[] = [];
  let line: Piece[] = [], lw = 0;
  const end = () => { const h = Math.max(base, ...line.map((p) => p.font.size)) * 1.3; lines.push({ pieces: line, height: h }); line = []; lw = 0; };
  for (const r of runs) {
    const font = fontOf(r, base, bold);
    for (const tok of r.text.split(/(\n|\s+)/)) {
      if (!tok) continue;
      if (tok === '\n') { end(); continue; }
      let w = textWidth(tok, font);
      if (/^\s+$/.test(tok)) { if (!line.length) continue; line.push({ text: ' ', font, w: textWidth(' ', font) }); lw += textWidth(' ', font); continue; }
      if (lw + w > width && line.length) { while (line.length && /^\s+$/.test(line[line.length - 1].text)) { lw -= line.pop()!.w; } end(); }
      let t = tok;
      while (w > width && t.length > 1) {   // palavra maior que a linha: corta
        let k = t.length; while (k > 1 && textWidth(t.slice(0, k), font) > width) k--;
        line.push({ text: t.slice(0, k), font, w: textWidth(t.slice(0, k), font) }); end();
        t = t.slice(k); w = textWidth(t, font);
      }
      line.push({ text: t, font, w }); lw += w;
    }
  }
  if (line.length || !lines.length) end();
  return lines;
}

export function toPdf(m: ImportModel, page: { width: number; height: number; margins: { top: number; right: number; bottom: number; left: number } } = { width: 794, height: 1123, margins: { top: 96, right: 96, bottom: 96, left: 96 } }): Uint8Array {
  const pt = (px: number) => px * 0.75;
  const W = pt(page.width), H = pt(page.height);
  const M = { top: pt(page.margins.top), right: pt(page.margins.right), bottom: pt(page.margins.bottom), left: pt(page.margins.left) };
  const out = new Writer(W, H);
  let y = 0;
  const content = W - M.left - M.right;
  const start = () => { out.newPage(W, H); y = M.top; };
  const room = (h: number) => { if (y + h > H - M.bottom && y > M.top + 0.1) start(); };
  const drawLines = (lines: ReturnType<typeof wrap>, x: number, align: 'LEFT' | 'CENTER' = 'LEFT', maxW = content) => {
    for (const l of lines) {
      room(l.height);
      let cx = x + (align === 'CENTER' ? (maxW - l.pieces.reduce((s, p) => s + p.w, 0)) / 2 : 0);
      const base = y + l.height * 0.78;
      for (const p of l.pieces) { out.text(cx, base, p.text, p.font); cx += p.w; }
      y += l.height;
    }
  };
  const table = (rows: Scalar[][], header: boolean, x = M.left, w = content, paged = true) => {
    const cols = Math.max(1, ...rows.map((r) => r.length)), cw = w / cols, pad = 4;
    rows.forEach((r, i) => {
      const bold = header && i === 0;
      const cells = Array.from({ length: cols }, (_, k) => wrap([{ text: show(r[k] ?? null) }], cw - pad * 2, 10, bold));
      const h = Math.max(...cells.map((c) => c.reduce((s, l) => s + l.height, 0))) + pad * 2;
      if (paged) room(h);
      if (bold) out.rect(x, y, w, h, [0.95, 0.96, 0.98]);
      cells.forEach((c, k) => {
        out.rect(x + k * cw, y, cw, h, undefined, [0.65, 0.65, 0.65]);
        let yy = y + pad;
        for (const l of c) { let cx = x + k * cw + pad; for (const p of l.pieces) { out.text(cx, yy + l.height * 0.78, p.text, p.font); cx += p.w; } yy += l.height; }
      });
      y += h;
    });
    y += 8;
  };
  const blocks = (bs: BlockM[]) => {
    for (const b of bs) {
      if (b.kind === 'break') { start(); continue; }
      if (b.kind === 'text') {
        const size = SIZE[b.textType ?? ''] ?? (b.textType === 'CODE' ? 10 : 11);
        const heading = Boolean(SIZE[b.textType ?? '']);
        if (heading) { y += 8; room(size * 2.6); }
        const runs = b.textType === 'CODE' ? b.runs.map((r) => ({ ...r, format: { ...r.format, fontFamily: 'monospace' } })) : b.textType === 'QUOTE' ? b.runs.map((r) => ({ ...r, format: { ...r.format, italic: true } })) : b.runs;
        const indent = b.textType === 'QUOTE' ? 24 : 0;
        drawLines(wrap(runs, content - indent * 2, size, heading), M.left + indent, b.textType === 'TITLE' ? 'CENTER' : 'LEFT');
        y += heading ? 4 : 6;
      } else if (b.kind === 'list') {
        const counters: number[] = [];
        for (const it of b.items) {
          counters.length = it.level + 1; counters[it.level] = (counters[it.level] ?? 0) + 1;
          const indent = 14 + it.level * 18;
          const mark = b.listType === 'NUMBERED' ? `${counters.slice(0, it.level + 1).join('.')}.` : ['•', '–', '·'][it.level % 3];
          const lines = wrap(it.runs, content - indent - 6, 11);
          room(lines[0].height);
          const mf: Font = { bold: false, italic: false, mono: false, size: 11, color: [0.12, 0.16, 0.23] };
          const mx = M.left + indent - 12;
          out.text(mx, y + lines[0].height * 0.78, mark, mf);
          drawLines(lines, Math.max(M.left + indent + 2, mx + textWidth(mark, mf) + 4));
        }
        y += 6;
      } else if (b.kind === 'table') table(b.rows, Boolean(b.header));
      else if (b.kind === 'shape') {
        const w = Math.min(content, pt(b.width)), hh = pt(b.height) * (w / pt(b.width));
        room(hh + 12);
        const x = M.left + (content - w) / 2, fill = rgb(b.fill ?? '#4472C4');
        if (b.shapeType === 'CIRCLE' || b.shapeType === 'ELLIPSE') out.ellipse(x, y, w, hh, fill); else out.rect(x, y, w, hh, fill);
        if (b.runs?.length) {
          const ls = wrap(b.runs.map((r) => ({ ...r, format: { color: b.color ?? '#FFFFFF', bold: b.bold, ...(r.format ?? {}) } })), w - 16, b.fontSize ?? 14, Boolean(b.bold));
          let ty = y + (hh - ls.reduce((t, l) => t + l.height, 0)) / 2;
          for (const l of ls) { let cx = x + (w - l.pieces.reduce((t, p) => t + p.w, 0)) / 2; for (const p of l.pieces) { out.text(cx, ty + l.height * 0.78, p.text, p.font); cx += p.w; } ty += l.height; }
        }
        y += hh + 12;
      }
      else if (b.kind === 'image') {
        const jpg = jpegFrom(b.source);
        const w0 = pt(b.width ?? 320), h0 = pt(b.height ?? 240), k = Math.min(1, content / w0);
        const w = w0 * k, h = h0 * k;
        room(h + 8);
        if (jpg) out.image(jpg, M.left, y, w, h);
        else { out.rect(M.left, y, w, h, [0.89, 0.91, 0.94]); out.text(M.left + 8, y + h / 2, `[Imagem${b.alt ? `: ${b.alt}` : ''}]`, { bold: false, italic: true, mono: false, size: 10, color: [0.3, 0.33, 0.4] }); }
        y += h + 8;
      }
    }
  };
  if (m.blocks?.length) { start(); blocks(m.blocks); }
  if (m.sheets?.length) {
    if (!out.pages.length) start();
    for (const sh of m.sheets) { blocks([{ kind: 'text', textType: 'HEADING_2', runs: [{ text: sh.name }] }]); table(sheetMatrix(sh), false); }
  }
  if (m.slides?.length) {
    const size = m.slideSize ?? { width: 1280, height: 720 };
    const SW = pt(size.width), SH = pt(size.height);
    for (const s of m.slides) {
      out.newPage(SW, SH);
      out.rect(0, 0, SW, SH, rgb(s.background ?? '#FFFFFF'));
      for (const it of s.items as SlideItemM[]) {
        const x = pt(it.x), yy = pt(it.y), w = pt(it.width), h = pt(it.height);
        if (it.kind === 'shape' || (it.kind === 'text' && it.fill)) out.rect(x, yy, w, h, rgb(it.fill ?? '#4472C4'), it.stroke ? rgb(it.stroke) : undefined);
        if (it.kind === 'line') out.line(x, yy, x + w, yy + h, rgb(it.stroke ?? '#404040'), 1.5);
        if (it.kind === 'image') { const jpg = jpegFrom(it.source); if (jpg) out.image(jpg, x, yy, w, h); else out.rect(x, yy, w, h, [0.89, 0.91, 0.94]); }
        if (it.kind === 'table' && it.rows) { y = yy; table(it.rows, true, x, w, false); }
        if (it.runs?.length) {
          const size2 = it.textType === 'TITLE' || it.textType === 'HEADING_1' ? 30 : it.textType === 'SUBTITLE' ? 20 : 14;
          const lines = wrap(it.runs, w - 8, size2, it.textType === 'TITLE');
          let ty = yy + 4 + (it.kind === 'shape' ? Math.max(0, (h - lines.reduce((t, l) => t + l.height, 0)) / 2) : 0);
          for (const l of lines) { let cx = x + 4 + (it.kind === 'shape' ? (w - 8 - l.pieces.reduce((t, p) => t + p.w, 0)) / 2 : 0); for (const p of l.pieces) { out.text(cx, ty + l.height * 0.78, p.text, p.font); cx += p.w; } ty += l.height; }
        }
      }
    }
  }
  if (!out.pages.length) start();
  // número da página no rodapé (documentos)
  if (!m.slides?.length) out.pages.forEach((p, i) => { const [PW] = (p as any).size; const s = `${i + 1} / ${out.pages.length}`; const f = { bold: false, italic: false, mono: false, size: 9, color: [0.45, 0.5, 0.56] as [number, number, number] }; p.push(`BT ${f.color.map(n2).join(' ')} rg /F1 9 Tf ${n2(PW / 2 - textWidth(s, f) / 2)} ${n2(M.bottom / 2)} Td ${pdfStr(s)} Tj ET`); });
  return out.build(m.name ?? 'Documento');
}
