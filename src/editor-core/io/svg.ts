// SVG: slides (formas, textos, linhas, imagens, tabelas), gráficos e diagramas — vetorial, abre em qualquer
// navegador e serve de base para PNG (a interface rasteriza o SVG num canvas).
import type { RunM, SlideM, SlideItemM, Scalar } from './model.ts';
import type { ChartData } from '../charts/chart.ts';
import { esc } from './xml.ts';

const FONT = 'Calibri, Carlito, Arial, sans-serif';
const width = (s: string, size: number) => s.length * size * 0.52;

function lines(runs: RunM[], maxW: number, size: number): { text: string; runs: RunM[] }[] {
  const out: { text: string; runs: RunM[] }[] = [];
  let cur: RunM[] = [], w = 0;
  const push = () => { out.push({ text: cur.map((r) => r.text).join(''), runs: cur }); cur = []; w = 0; };
  for (const r of runs) for (const tok of r.text.split(/(\n|\s+)/)) {
    if (!tok) continue;
    if (tok === '\n') { push(); continue; }
    const tw = width(tok, Number(r.format?.fontSize ?? size));
    if (w + tw > maxW && cur.length && !/^\s+$/.test(tok)) push();
    if (/^\s+$/.test(tok) && !cur.length) continue;
    cur.push({ text: tok, format: r.format }); w += tw;
  }
  if (cur.length || !out.length) push();
  return out;
}
const tspan = (r: RunM) => {
  const f = r.format ?? {};
  const a = [f.bold ? 'font-weight="700"' : '', f.italic ? 'font-style="italic"' : '', f.underline || f.strike ? `text-decoration="${f.underline ? 'underline' : 'line-through'}"` : '', typeof f.color === 'string' && f.color.startsWith('#') ? `fill="${f.color}"` : '', typeof f.fontSize === 'number' ? `font-size="${f.fontSize * 1.333}"` : ''].filter(Boolean).join(' ');
  return a ? `<tspan ${a}>${esc(r.text)}</tspan>` : esc(r.text);
};
function textBlock(runs: RunM[], x: number, y: number, w: number, h: number, size: number, center = false) {
  const ls = lines(runs, w - 8, size);
  const lh = size * 1.25;
  const top = center ? y + (h - ls.length * lh) / 2 : y + 4;
  return ls.map((l, i) => `<text x="${center ? x + w / 2 : x + 4}" y="${top + lh * (i + 0.8)}" font-size="${size}" font-family="${FONT}"${center ? ' text-anchor="middle"' : ''} fill="#1E293B">${l.runs.map(tspan).join('')}</text>`).join('');
}
function shapePath(it: SlideItemM) {
  const { x, y, width: w, height: h } = it;
  const fill = it.fill ?? (it.kind === 'shape' ? '#4472C4' : 'none'), stroke = it.stroke ? ` stroke="${it.stroke}" stroke-width="2"` : '';
  switch (it.shapeType) {
    case 'ELLIPSE': case 'CIRCLE': return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"${stroke}/>`;
    case 'ROUNDED_RECTANGLE': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) * 0.15}" fill="${fill}"${stroke}/>`;
    case 'DIAMOND': return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" fill="${fill}"${stroke}/>`;
    case 'TRIANGLE': return `<polygon points="${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}" fill="${fill}"${stroke}/>`;
    default: {
      // mesmas proporções do editor (em % da caixa)
      const POLY: Record<string, number[][]> = {
        STAR: [[50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35]],
        ARROW: [[0, 30], [65, 30], [65, 0], [100, 50], [65, 100], [65, 70], [0, 70]],
        PENTAGON: [[50, 0], [100, 38], [82, 100], [18, 100], [0, 38]],
        HEXAGON: [[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]],
      };
      const poly = POLY[it.shapeType ?? ''];
      if (poly) return `<polygon points="${poly.map(([px, py]) => `${x + (w * px) / 100},${y + (h * py) / 100}`).join(' ')}" fill="${fill}"${stroke}/>`;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${stroke}/>`;
    }
  }
}
const cell = (v: Scalar) => (v === null || v === undefined ? '' : String(v));

export function slideSvg(s: SlideM, size: { width: number; height: number }): string {
  const parts = s.items.map((it) => {
    const tsize = it.textType === 'TITLE' || it.textType === 'HEADING_1' ? 40 : it.textType === 'SUBTITLE' ? 28 : 22;
    if (it.kind === 'line') return `<line x1="${it.x}" y1="${it.y}" x2="${it.x + it.width}" y2="${it.y + it.height}" stroke="${it.stroke ?? '#404040'}" stroke-width="2"/>`;
    if (it.kind === 'image') return it.source ? `<image href="${esc(it.source)}" x="${it.x}" y="${it.y}" width="${it.width}" height="${it.height}" preserveAspectRatio="xMidYMid meet"><title>${esc(it.alt ?? '')}</title></image>` : `<rect x="${it.x}" y="${it.y}" width="${it.width}" height="${it.height}" fill="#E2E8F0"/>`;
    if (it.kind === 'table') {
      const rows = it.rows ?? [], cols = Math.max(1, ...rows.map((r) => r.length)), cw = it.width / cols, rh = it.height / Math.max(1, rows.length);
      return rows.map((r, i) => Array.from({ length: cols }, (_, k) => `<rect x="${it.x + k * cw}" y="${it.y + i * rh}" width="${cw}" height="${rh}" fill="${i === 0 ? '#F1F5F9' : '#FFFFFF'}" stroke="#A6A6A6"/><text x="${it.x + k * cw + 6}" y="${it.y + i * rh + rh * 0.65}" font-size="16" font-family="${FONT}"${i === 0 ? ' font-weight="700"' : ''} fill="#1E293B">${esc(cell(r[k] ?? null))}</text>`).join('')).join('');
    }
    return (it.kind === 'shape' || it.fill ? shapePath(it) : '') + (it.runs?.length ? textBlock(it.runs, it.x, it.y, it.width, it.height, tsize, it.kind === 'shape') : '');
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.width} ${size.height}" width="${size.width}" height="${size.height}"><rect width="100%" height="100%" fill="${s.background ?? '#FFFFFF'}"/>${parts.join('')}</svg>`;
}

const PALETTE = ['#FBBF00', '#2563EB', '#16A34A', '#9333EA', '#EA580C', '#0891B2'];
export function chartSvg(d: ChartData, title = '', W = 640, H = 400): string {
  const pad = { l: 56, r: 16, t: title ? 40 : 16, b: 56 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const series = d.series.filter((s) => s.visible !== false);
  const head = title ? `<text x="${W / 2}" y="26" text-anchor="middle" font-size="18" font-weight="700" font-family="${FONT}" fill="#1E293B">${esc(title)}</text>` : '';
  const legend = series.map((s, i) => `<rect x="${pad.l + i * 140}" y="${H - 22}" width="12" height="12" fill="${s.color ?? PALETTE[i % 6]}"/><text x="${pad.l + i * 140 + 18}" y="${H - 12}" font-size="13" font-family="${FONT}" fill="#334155">${esc(s.name)}</text>`).join('');
  if (['PIE', 'DOUGHNUT'].includes(d.chartType)) {
    const vals = (series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0)), total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2, cy = pad.t + ph / 2, r = Math.min(pw, ph) / 2;
    let a0 = -Math.PI / 2;
    const slices = vals.map((v, i) => { const a1 = a0 + (v / total) * Math.PI * 2; const large = a1 - a0 > Math.PI ? 1 : 0; const p = `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`; a0 = a1; return `<path d="${p}" fill="${PALETTE[i % 6]}" stroke="#fff"><title>${esc(String(d.categories[i] ?? ''))}: ${v}</title></path>`; }).join('');
    const hole = d.chartType === 'DOUGHNUT' ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#fff"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/>${head}${slices}${hole}</svg>`;
  }
  const all = series.flatMap((s) => s.values.filter((v): v is number => typeof v === 'number'));
  const max = Math.max(0, ...all), min = Math.min(0, ...all), span = max - min || 1;
  const Y = (v: number) => pad.t + ph - ((v - min) / span) * ph;
  const n = Math.max(1, d.categories.length), slot = pw / n;
  const grid = Array.from({ length: 5 }, (_, i) => { const v = min + (span * i) / 4; return `<line x1="${pad.l}" y1="${Y(v)}" x2="${W - pad.r}" y2="${Y(v)}" stroke="#E2E8F0"/><text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" font-family="${FONT}" fill="#64748B">${Math.round(v * 100) / 100}</text>`; }).join('');
  const cats = d.categories.map((c, i) => `<text x="${pad.l + slot * (i + 0.5)}" y="${pad.t + ph + 18}" text-anchor="middle" font-size="12" font-family="${FONT}" fill="#334155">${esc(String(c))}</text>`).join('');
  const isLine = ['LINE', 'AREA', 'SCATTER'].includes(d.chartType);
  const bars = series.map((s, si) => {
    const color = s.color ?? PALETTE[si % 6];
    if (isLine) { const pts = s.values.map((v, i) => (v === null ? null : `${pad.l + slot * (i + 0.5)},${Y(v)}`)).filter(Boolean).join(' '); return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3"/>`; }
    const bw = (slot * 0.7) / Math.max(1, series.length);
    return s.values.map((v, i) => (v === null ? '' : `<rect x="${pad.l + slot * i + slot * 0.15 + bw * si}" y="${Math.min(Y(v), Y(0))}" width="${bw}" height="${Math.abs(Y(v) - Y(0))}" fill="${color}"><title>${esc(s.name)} · ${esc(String(d.categories[i] ?? ''))}: ${v}</title></rect>`)).join('');
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/>${head}${grid}<line x1="${pad.l}" y1="${Y(0)}" x2="${W - pad.r}" y2="${Y(0)}" stroke="#94A3B8"/>${bars}${cats}${legend}</svg>`;
}

export function diagramSvg(d: any): string {
  const W = d.bounds?.width ?? 400, H = d.bounds?.height ?? 300;
  const routes = (d.routes ?? []).map((r: any) => {
    const p = r.points as { x: number; y: number }[];
    const path = r.routing === 'CURVED' && p.length === 4 ? `M${p[0].x},${p[0].y} C${p[1].x},${p[1].y} ${p[2].x},${p[2].y} ${p[3].x},${p[3].y}` : `M${p.map((q) => `${q.x},${q.y}`).join(' L')}`;
    const mid = p[Math.floor(p.length / 2)];
    return `<path d="${path}" fill="none" stroke="#64748B" stroke-width="2" marker-end="url(#seta)"/>${r.label ? `<text x="${mid.x + 4}" y="${mid.y - 4}" font-size="12" font-family="${FONT}" fill="#334155">${esc(r.label)}</text>` : ''}`;
  }).join('');
  const items = (d.items ?? []).map((it: any) => {
    const shape = shapePath({ kind: 'shape', x: it.x, y: it.y, width: it.width, height: it.height, shapeType: it.resolvedShape === 'DIAMOND' ? 'DIAMOND' : it.resolvedShape === 'ELLIPSE' || it.resolvedShape === 'CIRCLE' ? 'ELLIPSE' : 'ROUNDED_RECTANGLE', fill: d.diagramType === 'VENN' ? 'rgba(37,99,235,0.25)' : '#FFFFFF', stroke: '#2563EB' });
    return shape + textBlock([{ text: it.label }], it.x, it.y, it.width, it.height, 14, true);
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><marker id="seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748B"/></marker></defs><rect width="100%" height="100%" fill="#fff"/>${routes}${items}</svg>`;
}
