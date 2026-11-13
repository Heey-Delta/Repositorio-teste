// B2 · Imagens, formas e tabelas: o que faltava em relação a Word/PowerPoint/Excel.
//   Imagem: IMAGE_CROP (margens, proporção ou forma) · IMAGE_ADJUST (brilho, contraste, saturação, cinza, sépia,
//           negativo, matiz, transparência, recolorir) · IMAGE_RESET
//   Forma:  SHAPE_GALLERY · SHAPE_EDIT_POINTS · SHAPE_BOOLEAN (unir, combinar, subtrair, interseção)
//   Tabela: TABLE_SPLIT · TABLE_STYLES / TABLE_STYLE (galeria e opções: cabeçalho, total, 1ª/última coluna,
//           faixas) · TABLE_AUTOFIT (conteúdo, janela, fixa) · TABLE_PROPERTIES (repetir cabeçalho, alinhamento)
import type { EditorNode } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { clone, fail } from '../util.ts';
import { createNode, removeSubtree } from './basic.ts';
import { BOOLEAN_MODES, SHAPES, fitPath, pathPoints, pointsPath, shapeD, type BooleanMode } from '../io/shapes.ts';

// ---------------------------------------------------------------- imagem
export interface ImageAdjust { brightness?: number; contrast?: number; saturation?: number; grayscale?: boolean; sepia?: boolean; invert?: boolean; hue?: number; transparency?: number; recolor?: string | null; blur?: number }
const ADJ_RANGES: Record<string, [number, number]> = { brightness: [-100, 100], contrast: [-100, 100], saturation: [-100, 100], hue: [-180, 180], transparency: [0, 1], blur: [0, 50] };
export const CROP_SHAPES = ['RECTANGLE', 'CIRCLE', 'ELLIPSE', 'ROUNDED_RECTANGLE', 'TRIANGLE', 'DIAMOND', 'HEXAGON', 'STAR', 'HEART'];

/** Filtro CSS/SVG equivalente aos ajustes (o mesmo valor serve para a tela e para o SVG exportado). */
export function imageFilter(a: ImageAdjust | undefined) {
  if (!a) return '';
  const f: string[] = [];
  if (a.brightness) f.push(`brightness(${1 + a.brightness / 100})`);
  if (a.contrast) f.push(`contrast(${1 + a.contrast / 100})`);
  if (a.saturation) f.push(`saturate(${1 + a.saturation / 100})`);
  if (a.grayscale || a.recolor) f.push('grayscale(1)');
  if (a.sepia || a.recolor) f.push('sepia(1)');
  if (a.recolor) f.push(`hue-rotate(${hueOf(a.recolor) - 40}deg) saturate(2)`);   // a sépia fica perto de 40°
  if (a.invert) f.push('invert(1)');
  if (a.hue) f.push(`hue-rotate(${a.hue}deg)`);
  if (a.blur) f.push(`blur(${a.blur}px)`);
  return f.join(' ');
}
function hueOf(hex: string) {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.length === 3 ? v[i / 2].repeat(2) : v.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(h * 60 + 360) % 360;
}
/** Recorte em CSS: margens viram inset(); forma vira clip-path com o desenho da biblioteca. */
export function imageClip(crop: EditorNode['data']['crop']) {
  if (!crop) return '';
  if (crop.shape && crop.shape !== 'RECTANGLE') return `path('${shapeD(crop.shape, 0, 0, 100, 100)}')`;
  const p = (v: number | undefined) => `${Math.round((v ?? 0) * 1000) / 10}%`;
  return crop.left || crop.top || crop.right || crop.bottom ? `inset(${p(crop.top)} ${p(crop.right)} ${p(crop.bottom)} ${p(crop.left)})` : '';
}
const image = (e: Engine, id: string | null | undefined) => { const n = e.get(id); if (n.type !== 'IMAGE') fail('INVALID_OPERATION', `${n.id} não é uma imagem.`); e.assertEditable(n.id); return n; };

// ---------------------------------------------------------------- tabela: galeria de estilos
export interface TableLook { headerRow?: boolean; totalRow?: boolean; firstColumn?: boolean; lastColumn?: boolean; bandedRows?: boolean; bandedColumns?: boolean }
export const TABLE_STYLES: Record<string, { label: string; header: string; headerInk: string; band: string; line: string; total?: string }> = {
  GRID: { label: 'Grade', header: '#FFFFFF', headerInk: '#000000', band: '#FFFFFF', line: '#000000' },
  PLAIN: { label: 'Simples', header: '#FFFFFF', headerInk: '#000000', band: '#F2F2F2', line: '#BFBFBF' },
  BLUE: { label: 'Azul', header: '#4472C4', headerInk: '#FFFFFF', band: '#D9E2F3', line: '#8EAADB', total: '#B4C6E7' },
  ORANGE: { label: 'Laranja', header: '#ED7D31', headerInk: '#FFFFFF', band: '#FBE4D5', line: '#F4B083', total: '#F7CAAC' },
  GREEN: { label: 'Verde', header: '#70AD47', headerInk: '#FFFFFF', band: '#E2EFD9', line: '#A8D08D', total: '#C5E0B3' },
  GRAY: { label: 'Cinza', header: '#7F7F7F', headerInk: '#FFFFFF', band: '#EDEDED', line: '#C9C9C9', total: '#DBDBDB' },
  DARK: { label: 'Escura', header: '#000000', headerInk: '#FBBF00', band: '#1A1A1A', line: '#3A3A3A', total: '#262626' },
  ACCENT: { label: 'Destaque', header: '#FBBF00', headerInk: '#000000', band: '#FFF4CC', line: '#E0B000', total: '#FFE08A' },
};
/** Cor de fundo e tinta de cada célula conforme o estilo da tabela (para a tela e para os exportadores). */
export function tableCellLook(d: Record<string, any>, r: number, c: number): { fill?: string; ink?: string; bold?: boolean } {
  const st = TABLE_STYLES[d.tableStyle ?? ''];
  if (!st) return {};
  const look: TableLook = { headerRow: d.header ?? true, bandedRows: true, ...(d.look ?? {}) };
  const rows = d.rows.length, cols = d.columns.length;
  if (look.headerRow && r === 0) return { fill: st.header, ink: st.headerInk, bold: true };
  if (look.totalRow && r === rows - 1) return { fill: st.total ?? st.band, bold: true };
  if ((look.firstColumn && c === 0) || (look.lastColumn && c === cols - 1)) return { bold: true, fill: st.band };
  const bodyRow = r - (look.headerRow ? 1 : 0);
  if (look.bandedRows && bodyRow % 2 === 1) return { fill: st.band };
  if (look.bandedColumns && c % 2 === 1) return { fill: st.band };
  return {};
}
const table = (e: Engine, id: string | null | undefined) => { const n = e.get(id); if (n.type !== 'TABLE') fail('INVALID_OPERATION', `${n.id} não é uma tabela.`); e.assertEditable(n.id); return n; };
const cellText = (c: any) => String(c?.error?.code ?? c?.calculatedValue ?? c?.value ?? '');

export const objectHandlers: Record<string, Handler> = {
  // ---------------------------------------------------------------- imagem
  /** IMAGE_CROP { left, top, right, bottom } (frações 0–0,9) · { aspect: "1:1" | "4:3" | "16:9" | "3:2" } · { shape } · null limpa. */
  IMAGE_CROP: (e, op) => {
    const n = image(e, op.targetId);
    const t = e.touchNode(n.id);
    if (op.payload === null || op.payload?.reset) { t.data.crop = null; return null; }
    const p: Record<string, any> = op.payload ?? {};
    const crop: Record<string, any> = { ...(n.data.crop ?? {}) };
    if (p.aspect) {
      const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(p.aspect));
      if (!m) fail('VALIDATION', 'Proporção no formato 16:9, 4:3, 1:1…');
      const want = Number(m![1]) / Number(m![2]);
      const w = Number(n.layout.width ?? 100), h = Number(n.layout.height ?? 100), have = w / h;
      Object.assign(crop, { left: 0, right: 0, top: 0, bottom: 0 });
      if (have > want) { const cut = (1 - want / have) / 2; crop.left = crop.right = Math.round(cut * 1000) / 1000; t.layout.width = Math.round(h * want); }
      else { const cut = (1 - have / want) / 2; crop.top = crop.bottom = Math.round(cut * 1000) / 1000; t.layout.height = Math.round(w / want); }
    }
    for (const k of ['left', 'top', 'right', 'bottom']) if (p[k] !== undefined) {
      if (typeof p[k] !== 'number' || p[k] < 0 || p[k] > 0.9) fail('VALIDATION', 'Recorte: cada margem vai de 0 a 0,9 (fração da imagem).');
      crop[k] = p[k];
    }
    if ((crop.left ?? 0) + (crop.right ?? 0) >= 0.95 || (crop.top ?? 0) + (crop.bottom ?? 0) >= 0.95) fail('VALIDATION', 'O recorte não pode tirar a imagem inteira.');
    if (p.shape !== undefined) { if (!CROP_SHAPES.includes(p.shape)) fail('VALIDATION', `Recortar na forma: ${CROP_SHAPES.join(', ')}.`); crop.shape = p.shape; }
    t.data.crop = crop;
    return crop;
  },

  /** IMAGE_ADJUST { brightness, contrast, saturation (−100…100), hue (−180…180), transparency (0…1), blur, grayscale, sepia, invert, recolor }. null tira o ajuste. */
  IMAGE_ADJUST: (e, op) => {
    const n = image(e, op.targetId);
    const p = op.payload ?? {};
    const adj: Record<string, any> = { ...(n.data.adjust ?? {}) };
    for (const [k, v] of Object.entries<any>(p)) {
      if (v === null) { delete adj[k]; continue; }
      if (ADJ_RANGES[k]) { const [a, b] = ADJ_RANGES[k]; if (typeof v !== 'number' || v < a || v > b) fail('VALIDATION', `${k} vai de ${a} a ${b}.`); adj[k] = v; }
      else if (['grayscale', 'sepia', 'invert'].includes(k)) { if (typeof v !== 'boolean') fail('VALIDATION', `${k} é sim/não.`); adj[k] = v; }
      else if (k === 'recolor') { if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) fail('VALIDATION', 'Recolorir: cor #RRGGBB.'); adj[k] = v; }
      else fail('VALIDATION', `Ajuste desconhecido: ${k}.`);
    }
    e.touchNode(n.id).data.adjust = adj;
    return { adjust: adj, filter: imageFilter(adj), opacity: adj.transparency !== undefined ? 1 - adj.transparency : 1 };
  },

  /** Volta a imagem ao original: sem recorte, sem ajustes, sem giro e (com size: true) no tamanho do arquivo. */
  IMAGE_RESET: (e, op) => {
    const n = image(e, op.targetId);
    const t = e.touchNode(n.id);
    t.data.crop = null; delete t.data.adjust;
    t.layout.rotation = 0; t.layout.flipH = false; t.layout.flipV = false;
    const a = e.doc.assets[n.data.assetId] as any;
    if (op.payload?.size && a?.width && a?.height) { t.layout.width = a.width; t.layout.height = a.height; }
    return n.id;
  },

  // ---------------------------------------------------------------- formas
  SHAPE_GALLERY: () => Object.entries(SHAPES).map(([id, s]) => ({ id, label: s.label, path: s.d })),

  /** Editar pontos: SHAPE_EDIT_POINTS { points: [[x,y], …] (0–100), closed } transforma em forma livre. Sem points devolve os atuais. */
  SHAPE_EDIT_POINTS: (e, op) => {
    const n = e.get(op.targetId);
    if (n.type !== 'SHAPE') fail('INVALID_OPERATION', `${n.id} não é uma forma.`);
    const current = pathPoints(n.data.shapeType === 'CUSTOM' ? n.data.path : SHAPES[n.data.shapeType]?.d ?? SHAPES.RECTANGLE.d);
    const pts = op.payload?.points;
    if (!pts) return current;
    e.assertEditable(n.id);
    if (!Array.isArray(pts) || pts.length < 2 || pts.some((p: any) => !Array.isArray(p) || p.length !== 2 || p.some((v: any) => typeof v !== 'number' || v < -50 || v > 150))) fail('VALIDATION', 'Pontos: lista de [x, y] entre −50 e 150 (caixa 0–100), pelo menos 2.');
    const t = e.touchNode(n.id);
    t.data.shapeType = 'CUSTOM';
    t.data.path = pointsPath(pts, op.payload?.closed !== false);
    delete t.data.boolean;
    return t.data.path;
  },

  /** Operações booleanas (como "Mesclar formas" no PowerPoint): SHAPE_BOOLEAN { ids: [primeira, …], mode }. A aparência é a da primeira. */
  SHAPE_BOOLEAN: (e, op) => {
    const ids: string[] = op.payload?.ids ?? e.state.selection.selectedIds;
    const mode: BooleanMode = op.payload?.mode;
    if (!BOOLEAN_MODES.includes(mode)) fail('VALIDATION', `Modo: ${BOOLEAN_MODES.join(', ')}.`);
    if (ids.length < 2) fail('INVALID_PAYLOAD', 'Selecione pelo menos duas formas.');
    const nodes = ids.map((id) => e.get(id));
    if (nodes.some((n) => n.type !== 'SHAPE')) fail('INVALID_OPERATION', 'Só formas podem ser combinadas.');
    if (nodes.some((n) => n.parentId !== nodes[0].parentId)) fail('INVALID_OPERATION', 'As formas precisam estar no mesmo slide/bloco.');
    for (const n of nodes) e.assertEditable(n.id);
    const box = (n: EditorNode) => ({ x: Number(n.layout.x ?? 0), y: Number(n.layout.y ?? 0), w: Number(n.layout.width ?? 100), h: Number(n.layout.height ?? 100) });
    const bs = nodes.map(box);
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
    const W = x1 - x0 || 1, H = y1 - y0 || 1;
    // cada parte vai para a caixa 0–100 da forma nova (partes de uma forma já combinada entram todas)
    const parts = nodes.flatMap((n, i) => {
      const b = bs[i];
      const toBox = (d: string) => fitPath(d, ((b.x - x0) / W) * 100, ((b.y - y0) / H) * 100, (b.w / W) * 100, (b.h / H) * 100);
      if (n.data.boolean?.parts) return n.data.boolean.parts.map(toBox);
      return [toBox(shapeD(n.data.shapeType, 0, 0, 100, 100, n.data))];
    });
    const first = nodes[0];
    const shape = createNode(e, {
      parentId: first.parentId!, nodeType: 'SHAPE', index: e.get(first.parentId).children.indexOf(first.id),
      data: { shapeType: 'CUSTOM', path: parts.join(' '), boolean: { mode, parts }, ...(first.data.runs ? { runs: clone(first.data.runs) } : {}) },
      layout: { ...clone(first.layout), x: x0, y: y0, width: W, height: H },
    });
    const t = e.touchNode(shape.id); t.styleId = first.styleId; t.styleOverrides = clone(first.styleOverrides);
    for (const n of nodes) removeSubtree(e, n.id);
    return shape.id;
  },

  // ---------------------------------------------------------------- tabelas
  /** Divide a tabela antes da linha `row` (índice): a parte de baixo vira outra tabela logo depois. */
  TABLE_SPLIT: (e, op) => {
    const n = table(e, op.targetId);
    const row = op.payload?.row;
    const d = n.data;
    if (!Number.isInteger(row) || row < 1 || row >= d.rows.length) fail('VALIDATION', `Linha para dividir: de 1 a ${d.rows.length - 1}.`);
    if (d.rows.some((r: any, ri: number) => r.cells.some((c: any) => c.span && ri < row && ri + c.span.rows > row))) fail('INVALID_OPERATION', 'Há células mescladas atravessando essa linha. Divida-as antes.');
    const lower = { ...clone(d), rows: clone(d.rows.slice(row)), header: op.payload?.repeatHeader ? true : false, filter: null };
    if (op.payload?.repeatHeader) lower.rows.unshift(clone(d.rows[0]));
    // ids novos para linhas e células copiadas
    for (const r of lower.rows) { r.id = e.newId('ROW'); for (const c of r.cells) c.id = e.newId('CELL'); }
    const t = e.touchNode(n.id); t.data.rows = d.rows.slice(0, row);
    const parentId = n.parentId!;
    return createNode(e, { parentId, nodeType: 'TABLE', data: lower, layout: clone(n.layout), index: e.get(parentId).children.indexOf(n.id) + 1 }).id;
  },

  TABLE_STYLES: () => Object.entries(TABLE_STYLES).map(([id, s]) => ({ id, ...s })),

  /** TABLE_STYLE { style?, headerRow?, totalRow?, firstColumn?, lastColumn?, bandedRows?, bandedColumns? } */
  TABLE_STYLE: (e, op) => {
    const n = table(e, op.targetId);
    const p = op.payload ?? {};
    const t = e.touchNode(n.id);
    if (p.style !== undefined) { if (p.style !== null && !TABLE_STYLES[p.style]) fail('VALIDATION', `Estilo de tabela: ${Object.keys(TABLE_STYLES).join(', ')}.`); t.data.tableStyle = p.style; }
    const look: Record<string, boolean> = { ...(t.data.look ?? {}) };
    for (const k of ['headerRow', 'totalRow', 'firstColumn', 'lastColumn', 'bandedRows', 'bandedColumns']) if (p[k] !== undefined) {
      if (typeof p[k] !== 'boolean') fail('VALIDATION', `${k} é sim/não.`);
      look[k] = p[k];
      if (k === 'headerRow') t.data.header = p[k];
    }
    t.data.look = look;
    return { style: t.data.tableStyle ?? null, look };
  },

  /** TABLE_AUTOFIT { mode: CONTENT (pelo texto) | WINDOW (largura disponível) | FIXED, width? } */
  TABLE_AUTOFIT: (e, op) => {
    const n = table(e, op.targetId);
    const mode = op.payload?.mode ?? 'CONTENT';
    if (!['CONTENT', 'WINDOW', 'FIXED'].includes(mode)) fail('VALIDATION', 'Ajuste: CONTENT, WINDOW ou FIXED.');
    const t = e.touchNode(n.id);
    t.data.autofit = mode;
    if (mode === 'FIXED') return t.data.columns.map((c: any) => c.width);
    const need = t.data.columns.map((_: any, ci: number) => Math.max(40, ...t.data.rows.map((r: any) => Math.min(400, cellText(r.cells[ci]).length * 7 + 16))));
    if (mode === 'WINDOW') {
      const avail = op.payload?.width ?? Number(e.get(n.parentId).layout.width ?? 0) ?? 0;
      const total = avail > 0 ? avail : 624;   // A4 com margens normais (pt)
      const sum = need.reduce((a: number, b: number) => a + b, 0);
      need.forEach((w: number, i: number) => { need[i] = Math.round((w / sum) * total); });
    }
    t.data.columns.forEach((c: any, i: number) => { c.width = need[i]; });
    return need;
  },

  /** TABLE_PROPERTIES { repeatHeader?, align?: LEFT|CENTER|RIGHT, allowRowBreak?, caption? } */
  TABLE_PROPERTIES: (e, op) => {
    const n = table(e, op.targetId);
    const p = op.payload ?? {};
    const t = e.touchNode(n.id);
    if (p.repeatHeader !== undefined) t.data.repeatHeader = Boolean(p.repeatHeader);
    if (p.allowRowBreak !== undefined) t.data.allowRowBreak = Boolean(p.allowRowBreak);
    if (p.align !== undefined) { if (!['LEFT', 'CENTER', 'RIGHT'].includes(p.align)) fail('VALIDATION', 'Alinhamento da tabela: LEFT, CENTER ou RIGHT.'); t.data.align = p.align; }
    if (p.caption !== undefined) t.data.caption = String(p.caption);
    return { repeatHeader: Boolean(t.data.repeatHeader), align: t.data.align ?? 'LEFT', allowRowBreak: t.data.allowRowBreak !== false, caption: t.data.caption ?? '' };
  },
};
