// SVG: slides (formas, textos, linhas, imagens, tabelas), gráficos e diagramas — vetorial, abre em qualquer
// navegador e serve de base para PNG (a interface rasteriza o SVG num canvas).
import { shapeSvg } from './shapes.ts';
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
function textBlock(runs: RunM[], x: number, y: number, w: number, h: number, size: number, center = false, t?: { font: string; ink: string }) {
  const ls = lines(runs, w - 8, size);
  const lh = size * 1.25;
  const top = center ? y + (h - ls.length * lh) / 2 : y + 4;
  return ls.map((l, i) => `<text x="${center ? x + w / 2 : x + 4}" y="${top + lh * (i + 0.8)}" font-size="${size}" font-family="${t?.font ?? FONT}"${center ? ' text-anchor="middle"' : ''} fill="${t?.ink ?? '#1E293B'}">${l.runs.map(tspan).join('')}</text>`).join('');
}
function shapePath(it: SlideItemM) {
  const fill = it.fill ?? (it.kind === 'shape' ? '#4472C4' : 'none');
  return `<g transform="translate(${it.x},${it.y})">${shapeSvg({ shapeType: it.shapeType, ...it.geometry }, it.width, it.height, { fill, stroke: it.stroke })}</g>`;
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

/** Cores e fonte dos desenhos de gráfico e diagrama. LIGHT = exportações; o site usa um tema escuro próprio. */
export interface SvgTheme { bg: string; ink: string; muted: string; grid: string; axis: string; font: string; nodeFill: string; nodeStroke: string; link: string; sliceStroke: string; palette: string[] }
export const LIGHT_THEME: SvgTheme = { bg: '#FFFFFF', ink: '#1E293B', muted: '#64748B', grid: '#E2E8F0', axis: '#94A3B8', font: FONT, nodeFill: '#FFFFFF', nodeStroke: '#2563EB', link: '#64748B', sliceStroke: '#FFFFFF', palette: ['#FBBF00', '#2563EB', '#16A34A', '#9333EA', '#EA580C', '#0891B2'] };
const bgRect = (t: SvgTheme) => (t.bg === 'none' ? '' : `<rect width="100%" height="100%" fill="${t.bg}"/>`);

export function chartSvg(d: ChartData, title = '', W = 640, H = 400, t: SvgTheme = LIGHT_THEME): string {
  const P = t.palette, F = t.font;
  const pad = { l: 56, r: 16, t: title ? 40 : 16, b: 56 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const series = d.series.filter((s) => s.visible !== false);
  const head = title ? `<text x="${W / 2}" y="26" text-anchor="middle" font-size="18" font-weight="700" font-family="${F}" fill="${t.ink}">${esc(title)}</text>` : '';
  const legend = series.map((s, i) => `<rect x="${pad.l + i * 140}" y="${H - 22}" width="12" height="12" fill="${s.color ?? P[i % P.length]}"/><text x="${pad.l + i * 140 + 18}" y="${H - 12}" font-size="13" font-family="${F}" fill="${t.muted}">${esc(s.name)}</text>`).join('');
  if (['PIE', 'DOUGHNUT'].includes(d.chartType)) {
    const vals = (series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0)), total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2, cy = pad.t + ph / 2, r = Math.min(pw, ph) / 2;
    let a0 = -Math.PI / 2;
    const slices = vals.map((v, i) => { const a1 = a0 + (v / total) * Math.PI * 2; const large = a1 - a0 > Math.PI ? 1 : 0; const p = `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`; a0 = a1; return `<path d="${p}" fill="${P[i % P.length]}" stroke="${t.sliceStroke}"><title>${esc(String(d.categories[i] ?? ''))}: ${v}</title></path>`; }).join('');
    const hole = d.chartType === 'DOUGHNUT' ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="${t.sliceStroke}"/>` : '';
    const keys = d.categories.map((c, i) => `<rect x="${W - pad.r - 120}" y="${pad.t + i * 20}" width="12" height="12" fill="${P[i % P.length]}"/><text x="${W - pad.r - 102}" y="${pad.t + i * 20 + 10}" font-size="12" font-family="${F}" fill="${t.muted}">${esc(String(c))}</text>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${bgRect(t)}${head}${slices}${hole}${keys}</svg>`;
  }
  const all = series.flatMap((s) => s.values.filter((v): v is number => typeof v === 'number'));
  const max = Math.max(0, ...all), min = Math.min(0, ...all), span = max - min || 1;
  const Y = (v: number) => pad.t + ph - ((v - min) / span) * ph;
  const n = Math.max(1, d.categories.length), slot = pw / n;
  const grid = Array.from({ length: 5 }, (_, i) => { const v = min + (span * i) / 4; return `<line x1="${pad.l}" y1="${Y(v)}" x2="${W - pad.r}" y2="${Y(v)}" stroke="${t.grid}"/><text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" font-family="${F}" fill="${t.muted}">${Math.round(v * 100) / 100}</text>`; }).join('');
  const cats = d.categories.map((c, i) => `<text x="${pad.l + slot * (i + 0.5)}" y="${pad.t + ph + 18}" text-anchor="middle" font-size="12" font-family="${F}" fill="${t.muted}">${esc(String(c))}</text>`).join('');
  const isLine = ['LINE', 'AREA', 'SCATTER'].includes(d.chartType);
  const bars = series.map((s, si) => {
    const color = s.color ?? P[si % P.length];
    if (isLine) {
      const pts = s.values.map((v, i) => (v === null ? null : `${pad.l + slot * (i + 0.5)},${Y(v)}`)).filter(Boolean) as string[];
      const area = d.chartType === 'AREA' && pts.length ? `<polygon points="${pad.l + slot * 0.5},${Y(0)} ${pts.join(' ')} ${pad.l + slot * (pts.length - 0.5)},${Y(0)}" fill="${color}" fill-opacity=".18"/>` : '';
      return `${area}<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="3"/>`;
    }
    const bw = (slot * 0.7) / Math.max(1, series.length);
    return s.values.map((v, i) => (v === null ? '' : `<rect x="${pad.l + slot * i + slot * 0.15 + bw * si}" y="${Math.min(Y(v), Y(0))}" width="${bw}" height="${Math.abs(Y(v) - Y(0))}" fill="${color}"><title>${esc(s.name)} · ${esc(String(d.categories[i] ?? ''))}: ${v}</title></rect>`)).join('');
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${bgRect(t)}${head}${grid}<line x1="${pad.l}" y1="${Y(0)}" x2="${W - pad.r}" y2="${Y(0)}" stroke="${t.axis}"/>${bars}${cats}${legend}</svg>`;
}

export function diagramSvg(d: any, t: SvgTheme = LIGHT_THEME): string {
  const W = d.bounds?.width ?? 400, H = d.bounds?.height ?? 300;
  const routes = (d.routes ?? []).map((r: any) => {
    const p = r.points as { x: number; y: number }[];
    const path = r.routing === 'CURVED' && p.length === 4 ? `M${p[0].x},${p[0].y} C${p[1].x},${p[1].y} ${p[2].x},${p[2].y} ${p[3].x},${p[3].y}` : `M${p.map((q) => `${q.x},${q.y}`).join(' L')}`;
    const mid = p[Math.floor(p.length / 2)];
    return `<path d="${path}" fill="none" stroke="${t.link}" stroke-width="2" marker-end="url(#seta)"/>${r.label ? `<text x="${mid.x + 4}" y="${mid.y - 4}" font-size="12" font-family="${t.font}" fill="${t.muted}">${esc(r.label)}</text>` : ''}`;
  }).join('');
  const items = (d.items ?? []).map((it: any) => {
    const shape = shapePath({ kind: 'shape', x: it.x, y: it.y, width: it.width, height: it.height, shapeType: it.resolvedShape === 'DIAMOND' ? 'DIAMOND' : it.resolvedShape === 'ELLIPSE' || it.resolvedShape === 'CIRCLE' ? 'ELLIPSE' : 'ROUNDED_RECTANGLE', fill: d.diagramType === 'VENN' ? `${t.palette[0]}40` : t.nodeFill, stroke: t.nodeStroke });
    return shape + textBlock([{ text: it.label }], it.x, it.y, it.width, it.height, 14, true, t);
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><marker id="seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${t.link}"/></marker></defs>${bgRect(t)}${routes}${items}</svg>`;
}
