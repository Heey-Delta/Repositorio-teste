// Motor de diagramas (F04.07, F08.10–12): fluxogramas, organogramas, processos, mapas mentais, ciclos e Venn.
//
// Um diagrama é UM nó (DIAGRAM) cujo conteúdo é um grafo:
//   items:       [{ id, label, kind?, parentId?, shape?, size?, style?, x?, y? }]  (parentId = hierarquia)
//   connections: [{ id, from, to, label?, routing?, arrow? }]                     (ligações livres)
// O motor CALCULA, a cada mudança, a posição/tamanho de cada item, o traçado das ligações (routes) e o tamanho
// total (bounds). O desenho só lê esse resultado. Ligações implícitas: pai→filho na hierarquia e, em processos e
// ciclos sem ligações explícitas, a sequência dos itens.
//
// Algoritmos (layoutOptions.algorithm, padrão pelo tipo):
//   TREE (organograma/hierarquia) · LAYERED (fluxograma: camadas pelo caminho mais longo, ignora retornos)
//   RADIAL (mapa mental) · LINEAR (processo) · CYCLE (círculo) · VENN (círculos sobrepostos)
import type { EditorNode } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { clone, fail } from '../util.ts';

export const DIAGRAM_TYPES = ['FLOWCHART', 'ORGCHART', 'PROCESS', 'MINDMAP', 'HIERARCHY', 'CYCLE', 'VENN'];
export const ITEM_KINDS = ['PROCESS', 'DECISION', 'START', 'END', 'IO', 'DOCUMENT', 'SUBPROCESS', 'DATABASE', 'NOTE'];
const ALGORITHMS = ['TREE', 'LAYERED', 'RADIAL', 'LINEAR', 'CYCLE', 'VENN'];
const ROUTINGS = ['STRAIGHT', 'ELBOW', 'CURVED'];
const DEFAULT_ALGO: Record<string, string> = { FLOWCHART: 'LAYERED', ORGCHART: 'TREE', HIERARCHY: 'TREE', MINDMAP: 'RADIAL', PROCESS: 'LINEAR', CYCLE: 'CYCLE', VENN: 'VENN' };
const DEFAULT_ROUTING: Record<string, string> = { FLOWCHART: 'ELBOW', ORGCHART: 'ELBOW', HIERARCHY: 'ELBOW', MINDMAP: 'CURVED', PROCESS: 'STRAIGHT', CYCLE: 'CURVED', VENN: 'STRAIGHT' };
const KIND_SHAPE: Record<string, string> = { PROCESS: 'RECTANGLE', DECISION: 'DIAMOND', START: 'ELLIPSE', END: 'ELLIPSE', IO: 'PARALLELOGRAM', DOCUMENT: 'DOCUMENT', SUBPROCESS: 'SUBPROCESS', DATABASE: 'CYLINDER', NOTE: 'CALLOUT' };
const MARGIN = 20;

export interface DiagramItem { id: string; label: string; kind?: string; parentId?: string | null; shape?: string; size?: { width: number; height: number }; style?: Record<string, unknown>; x?: number; y?: number; width?: number; height?: number; resolvedShape?: string }
export interface DiagramConnection { id: string; from: string; to: string; label?: string; routing?: string; arrow?: boolean }
export interface Route { id: string; from: string; to: string; label?: string; implicit?: boolean; routing: string; points: { x: number; y: number }[] }
type Pt = { x: number; y: number };

// ---------------------------------------------------------------- validação

export function validateDiagram(d: any) {
  if (!DIAGRAM_TYPES.includes(d.diagramType)) fail('VALIDATION', `Diagrama: ${DIAGRAM_TYPES.join(', ')}.`);
  if (!Array.isArray(d.items) || !Array.isArray(d.connections)) fail('VALIDATION', 'Diagrama precisa de items e connections.');
  const ids = new Set<string>();
  for (const it of d.items) {
    if (ids.has(it.id)) fail('VALIDATION', `Item repetido: ${it.id}.`);
    ids.add(it.id);
    if (typeof it.label !== 'string') fail('VALIDATION', 'Todo item do diagrama precisa de um texto (label).');
    if (it.kind !== undefined && !ITEM_KINDS.includes(it.kind)) fail('VALIDATION', `Tipo do item: ${ITEM_KINDS.join(', ')}.`);
    if (it.size !== undefined && !(it.size?.width > 0 && it.size?.height > 0)) fail('VALIDATION', 'Tamanho do item: { width, height } positivos.');
  }
  for (const it of d.items) {
    if (it.parentId && !ids.has(it.parentId)) fail('VALIDATION', `Item ${it.id} aponta para um pai que não existe.`);
    const seen = new Set<string>();
    for (let p: any = it; p?.parentId; p = d.items.find((x: any) => x.id === p.parentId)) {
      if (seen.has(p.id)) fail('VALIDATION', 'A hierarquia do diagrama não pode ter ciclo (um item dentro dele mesmo).');
      seen.add(p.id);
    }
  }
  for (const c of d.connections) {
    if (!ids.has(c.from) || !ids.has(c.to)) fail('VALIDATION', `A conexão ${c.id} liga itens que não existem.`);
    if (c.from === c.to) fail('VALIDATION', 'Uma conexão liga dois itens diferentes.');
    if (c.routing !== undefined && !ROUTINGS.includes(c.routing)) fail('VALIDATION', `Traçado: ${ROUTINGS.join(', ')}.`);
  }
  const o = d.layoutOptions ?? {};
  if (o.algorithm !== undefined && !ALGORITHMS.includes(o.algorithm)) fail('VALIDATION', `Layout: ${ALGORITHMS.join(', ')}.`);
  if (o.direction !== undefined && !['TB', 'BT', 'LR', 'RL'].includes(o.direction)) fail('VALIDATION', 'Direção: TB, BT, LR ou RL.');
}

// ---------------------------------------------------------------- layout

function sizeOf(it: DiagramItem, type: string) {
  if (it.size) return { ...it.size };
  if (type === 'VENN') return { width: 160, height: 160 };
  const w = Math.max(100, Math.min(220, it.label.length * 7 + 32));
  if (it.kind === 'DECISION') return { width: Math.max(140, w + 20), height: 80 };
  if (type === 'MINDMAP' && !it.parentId) return { width: Math.max(140, w), height: 60 };
  return { width: w, height: it.kind === 'START' || it.kind === 'END' ? 44 : 52 };
}

const childrenOf = (items: DiagramItem[], id: string | null) => items.filter((x) => (x.parentId ?? null) === id);

function treeLayout(items: DiagramItem[], gx: number, gy: number) {
  const ext = new Map<string, number>();
  const extent = (it: DiagramItem): number => {
    const ch = childrenOf(items, it.id);
    const sum = ch.reduce((s, c) => s + extent(c), 0) + gx * Math.max(0, ch.length - 1);
    const v = Math.max(it.width!, sum);
    ext.set(it.id, v);
    return v;
  };
  const roots = childrenOf(items, null);
  roots.forEach(extent);
  const depthH: number[] = [];
  const depth = (it: DiagramItem): number => (it.parentId ? depth(items.find((x) => x.id === it.parentId)!) + 1 : 0);
  for (const it of items) { const d = depth(it); depthH[d] = Math.max(depthH[d] ?? 0, it.height!); }
  const top = (d: number) => depthH.slice(0, d).reduce((s, h) => s + h + gy, 0);
  const place = (it: DiagramItem, x0: number, d: number) => {
    const e = ext.get(it.id)!;
    it.x = x0 + (e - it.width!) / 2;
    it.y = top(d) + (depthH[d] - it.height!) / 2;
    const ch = childrenOf(items, it.id);
    const sum = ch.reduce((s, c) => s + ext.get(c.id)!, 0) + gx * Math.max(0, ch.length - 1);
    let cx = x0 + (e - sum) / 2;
    for (const c of ch) { place(c, cx, d + 1); cx += ext.get(c.id)! + gx; }
  };
  let x = 0;
  for (const r of roots) { place(r, x, 0); x += ext.get(r.id)! + gx; }
}

function layeredLayout(items: DiagramItem[], edges: [string, string][], gx: number, gy: number) {
  const idx = new Map(items.map((it, i) => [it.id, i]));
  const out = new Map(items.map((it) => [it.id, [] as string[]]));
  for (const [a, b] of edges) out.get(a)!.push(b);
  // retornos (ciclos) não contam para as camadas
  const state = new Map<string, number>();   // 1 = na pilha, 2 = visitado
  const back = new Set<string>();
  const dfs = (v: string) => {
    state.set(v, 1);
    for (const w of out.get(v)!) {
      if (state.get(w) === 1) back.add(`${v}>${w}`);
      else if (!state.get(w)) dfs(w);
    }
    state.set(v, 2);
  };
  const indeg = new Map(items.map((it) => [it.id, 0]));
  for (const [, b] of edges) indeg.set(b, indeg.get(b)! + 1);
  for (const it of items) if (!state.get(it.id) && indeg.get(it.id) === 0) dfs(it.id);
  for (const it of items) if (!state.get(it.id)) dfs(it.id);
  const fwd = edges.filter(([a, b]) => !back.has(`${a}>${b}`));
  const rank = new Map(items.map((it) => [it.id, 0]));
  const deg = new Map(items.map((it) => [it.id, 0]));
  for (const [, b] of fwd) deg.set(b, deg.get(b)! + 1);
  const queue = items.filter((it) => deg.get(it.id) === 0).map((it) => it.id);
  while (queue.length) {
    const v = queue.shift()!;
    for (const [a, b] of fwd) if (a === v) {
      rank.set(b, Math.max(rank.get(b)!, rank.get(v)! + 1));
      deg.set(b, deg.get(b)! - 1);
      if (deg.get(b) === 0) queue.push(b);
    }
  }
  const layers: DiagramItem[][] = [];
  for (const it of items) (layers[rank.get(it.id)!] ??= []).push(it);
  // ordem na camada: média da posição dos antecessores (reduz cruzamentos)
  const pos = new Map<string, number>();
  layers.forEach((L, r) => {
    if (r > 0) {
      const key = (it: DiagramItem) => {
        const preds = fwd.filter(([, b]) => b === it.id).map(([a]) => pos.get(a)).filter((x): x is number => x !== undefined);
        return preds.length ? preds.reduce((s, x) => s + x, 0) / preds.length : idx.get(it.id)!;
      };
      L.sort((a, b) => key(a) - key(b) || idx.get(a.id)! - idx.get(b.id)!);
    }
    L.forEach((it, i) => pos.set(it.id, i));
  });
  const widths = layers.map((L) => L.reduce((s, it) => s + it.width!, 0) + gx * (L.length - 1));
  const maxW = Math.max(...widths, 0);
  let y = 0;
  layers.forEach((L, r) => {
    const h = Math.max(...L.map((it) => it.height!));
    let x = (maxW - widths[r]) / 2;
    for (const it of L) { it.x = x; it.y = y + (h - it.height!) / 2; x += it.width! + gx; }
    y += h + gy;
  });
}

function radialLayout(items: DiagramItem[], radius: number) {
  const roots = childrenOf(items, null);
  const leaves = new Map<string, number>();
  const count = (id: string): number => { const ch = childrenOf(items, id); const v = ch.length ? ch.reduce((s, c) => s + count(c.id), 0) : 1; leaves.set(id, v); return v; };
  const center = roots[0];
  if (!center) return;
  center.x = -center.width! / 2; center.y = -center.height! / 2;
  // outras raízes giram em volta da primeira como se fossem filhas
  const first = [...childrenOf(items, center.id), ...roots.slice(1)];
  first.forEach((c) => count(c.id));
  const total = first.reduce((s, c) => s + leaves.get(c.id)!, 0) || 1;
  const place = (list: DiagramItem[], a0: number, span: number, depth: number, sum: number) => {
    let a = a0;
    for (const c of list) {
      const part = (span * leaves.get(c.id)!) / sum;
      const mid = a + part / 2;
      c.x = Math.cos(mid) * radius * depth - c.width! / 2;
      c.y = Math.sin(mid) * radius * depth - c.height! / 2;
      const ch = childrenOf(items, c.id);
      if (ch.length) place(ch, a, part, depth + 1, ch.reduce((s, k) => s + leaves.get(k.id)!, 0));
      a += part;
    }
  };
  place(first, -Math.PI / 2, Math.PI * 2, 1, total);
}

/** Calcula posições, tamanhos, traçados e limites. Muda `d` no lugar. */
export function layoutDiagram(d: any) {
  const type = d.diagramType;
  const items: DiagramItem[] = d.items;
  const o = d.layoutOptions ?? {};
  const algo = o.algorithm ?? DEFAULT_ALGO[type];
  const gx = o.spacing?.x ?? (algo === 'TREE' ? 30 : 40), gy = o.spacing?.y ?? 60;
  const manual = d.autoLayout === false;
  for (const it of items) {
    const s = sizeOf(it, type);
    it.width = s.width; it.height = s.height;
    it.resolvedShape = it.shape ?? (type === 'VENN' ? 'CIRCLE' : KIND_SHAPE[it.kind ?? 'PROCESS']);
  }
  const explicit: DiagramConnection[] = d.connections;
  const implicit: { from: string; to: string }[] = items.filter((it) => it.parentId).map((it) => ({ from: it.parentId!, to: it.id }))
    .filter((p) => !explicit.some((c) => c.from === p.from && c.to === p.to));
  if ((type === 'PROCESS' || type === 'CYCLE') && !explicit.length && !implicit.length) {
    for (let i = 0; i + 1 < items.length; i++) implicit.push({ from: items[i].id, to: items[i + 1].id });
    if (type === 'CYCLE' && items.length > 2) implicit.push({ from: items.at(-1)!.id, to: items[0].id });
  }

  if (!manual) {
    if (algo === 'TREE') treeLayout(items, gx, gy);
    else if (algo === 'LAYERED') layeredLayout(items, [...explicit.map((c) => [c.from, c.to] as [string, string]), ...implicit.map((c) => [c.from, c.to] as [string, string])], gx, gy);
    else if (algo === 'RADIAL') radialLayout(items, o.radius ?? 200);
    else if (algo === 'LINEAR') { let x = 0; const h = Math.max(0, ...items.map((it) => it.height!)); for (const it of items) { it.x = x; it.y = (h - it.height!) / 2; x += it.width! + gx; } }
    else if (algo === 'CYCLE') {
      const n = items.length, w = Math.max(0, ...items.map((it) => it.width!));
      const r = o.radius ?? Math.max(120, (n * (w + gx)) / (2 * Math.PI));
      items.forEach((it, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n); it.x = Math.cos(a) * r - it.width! / 2; it.y = Math.sin(a) * r - it.height! / 2; });
    } else if (algo === 'VENN') {
      const s = items[0]?.width ?? 160, step = s * 0.6;
      if (items.length === 3) [[0, 0], [step, 0], [step / 2, step * 0.85]].forEach(([x, y], i) => { items[i].x = x; items[i].y = y; });
      else items.forEach((it, i) => { it.x = i * step; it.y = 0; });
    }
    const dir = o.direction ?? (algo === 'LINEAR' ? 'LR' : 'TB');
    if (algo === 'TREE' || algo === 'LAYERED' || algo === 'LINEAR') {
      const natural = algo === 'LINEAR' ? 'LR' : 'TB';
      if ((natural === 'TB') !== (dir === 'TB' || dir === 'BT')) for (const it of items) { const cx = it.x! + it.width! / 2, cy = it.y! + it.height! / 2; it.x = cy - it.width! / 2; it.y = cx - it.height! / 2; }
      if (dir === 'BT') { const m = Math.max(...items.map((it) => it.y! + it.height!)); for (const it of items) it.y = m - it.y! - it.height!; }
      if (dir === 'RL') { const m = Math.max(...items.map((it) => it.x! + it.width!)); for (const it of items) it.x = m - it.x! - it.width!; }
    }
    const minX = Math.min(...items.map((it) => it.x!)), minY = Math.min(...items.map((it) => it.y!));
    for (const it of items) { it.x = Math.round(it.x! - minX + MARGIN); it.y = Math.round(it.y! - minY + MARGIN); }
  } else {
    // modo manual: itens novos (sem posição) entram abaixo do que já existe
    let bottom = Math.max(MARGIN, ...items.filter((it) => it.x !== undefined).map((it) => it.y! + it.height! + 40));
    for (const it of items) if (it.x === undefined || it.y === undefined) { it.x = MARGIN; it.y = bottom; bottom += it.height! + 40; }
  }

  const byId = new Map(items.map((it) => [it.id, it]));
  const route = (from: string, to: string, routing: string): Pt[] => {
    const a = byId.get(from)!, b = byId.get(to)!;
    const ca = { x: a.x! + a.width! / 2, y: a.y! + a.height! / 2 }, cb = { x: b.x! + b.width! / 2, y: b.y! + b.height! / 2 };
    const vertical = Math.abs(cb.y - ca.y) >= Math.abs(cb.x - ca.x);
    const port = (it: DiagramItem, c: Pt, toward: Pt): Pt => vertical
      ? { x: c.x, y: toward.y >= c.y ? it.y! + it.height! : it.y! }
      : { x: toward.x >= c.x ? it.x! + it.width! : it.x!, y: c.y };
    const p1 = port(a, ca, cb), p2 = port(b, cb, ca);
    if (routing === 'STRAIGHT' || (vertical ? p1.x === p2.x : p1.y === p2.y)) return [p1, p2];
    if (routing === 'ELBOW') {
      if (vertical) { const my = Math.round((p1.y + p2.y) / 2); return [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2]; }
      const mx = Math.round((p1.x + p2.x) / 2); return [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
    }
    // CURVED: Bézier cúbica (pontos de controle no meio, na direção da saída)
    return vertical
      ? [p1, { x: p1.x, y: (p1.y + p2.y) / 2 }, { x: p2.x, y: (p1.y + p2.y) / 2 }, p2]
      : [p1, { x: (p1.x + p2.x) / 2, y: p1.y }, { x: (p1.x + p2.x) / 2, y: p2.y }, p2];
  };
  const def = DEFAULT_ROUTING[type];
  d.routes = type === 'VENN' ? [] : [
    ...explicit.map((c): Route => ({ id: c.id, from: c.from, to: c.to, ...(c.label ? { label: c.label } : {}), routing: c.routing ?? def, points: route(c.from, c.to, c.routing ?? def) })),
    ...implicit.map((c, i): Route => ({ id: `implicit:${i}`, from: c.from, to: c.to, implicit: true, routing: def, points: route(c.from, c.to, def) })),
  ];
  d.bounds = items.length
    ? { width: Math.max(...items.map((it) => it.x! + it.width!)) + MARGIN, height: Math.max(...items.map((it) => it.y! + it.height!)) + MARGIN }
    : { width: 0, height: 0 };
  return d;
}

// ---------------------------------------------------------------- tópicos ↔ diagrama

/** "Diretoria\n  Vendas\n    Loja\n  TI" (recuo por espaços, tab ou marcadores - * •) → itens com hierarquia. */
export function itemsFromOutline(e: Engine, text: string): DiagramItem[] {
  const items: DiagramItem[] = [];
  const stack: { indent: number; id: string }[] = [];
  for (const raw of text.replace(/\t/g, '  ').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^ */)![0].length;
    const label = raw.trim().replace(/^[-*•]\s+/, '');
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const it: DiagramItem = { id: e.newId('DITEM'), label, parentId: stack.at(-1)?.id ?? null };
    items.push(it);
    stack.push({ indent, id: it.id });
  }
  return items;
}

export function outlineFromItems(items: DiagramItem[]): string {
  const lines: string[] = [];
  const walk = (id: string | null, depth: number) => { for (const c of childrenOf(items, id)) { lines.push('  '.repeat(depth) + c.label); walk(c.id, depth + 1); } };
  walk(null, 0);
  return lines.join('\n');
}

// ---------------------------------------------------------------- operações

function host(e: Engine, id: string | null | undefined, editable = true): EditorNode {
  const n = e.get(id);
  if (n.type !== 'DIAGRAM') fail('INVALID_OPERATION', `${n.id} não é um diagrama.`);
  if (!editable) return n;
  e.assertEditable(n.id);
  return e.touchNode(n.id);
}
const itemOf = (n: EditorNode, id: string): DiagramItem => n.data.items.find((x: DiagramItem) => x.id === id) ?? fail('NOT_FOUND', `Item ${id} não está no diagrama.`);
/** Valida e recalcula; se algo for inválido a transação inteira é desfeita. */
const commit = (n: EditorNode) => { validateDiagram(n.data); layoutDiagram(n.data); };
const siblings = (n: EditorNode, it: DiagramItem) => n.data.items.filter((x: DiagramItem) => (x.parentId ?? null) === (it.parentId ?? null));
const placeAfter = (n: EditorNode, it: DiagramItem, anchorId: string | null) => {
  const list: DiagramItem[] = n.data.items;
  list.splice(list.indexOf(it), 1);
  // depois do último descendente da âncora (mantém a ordem dos tópicos)
  let at = anchorId ? list.findIndex((x) => x.id === anchorId) : list.length - 1;
  const desc = (id: string): boolean => { const x = list.find((y) => y.id === id); return !!x?.parentId && (x.parentId === anchorId || desc(x.parentId)); };
  while (at + 1 < list.length && anchorId && desc(list[at + 1].id)) at++;
  list.splice(at + 1, 0, it);
};

export const diagramHandlers: Record<string, Handler> = {
  /** DIAGRAM_ADD_ITEM { label, kind?, parentId?, after?, connectFrom?, connectionLabel?, shape?, size?, style? } */
  DIAGRAM_ADD_ITEM: (e, op) => {
    const n = host(e, op.targetId);
    const p = op.payload ?? {};
    const it: DiagramItem = { id: e.newId('DITEM'), label: String(p.label ?? ''), ...(p.kind ? { kind: p.kind } : {}), parentId: p.parentId ?? null, ...(p.shape ? { shape: p.shape } : {}), ...(p.size ? { size: clone(p.size) } : {}), ...(p.style ? { style: clone(p.style) } : {}) };
    n.data.items.push(it);
    if (p.after) placeAfter(n, it, p.after);
    if (p.connectFrom) n.data.connections.push({ id: e.newId('DCON'), from: p.connectFrom, to: it.id, ...(p.connectionLabel ? { label: String(p.connectionLabel) } : {}) });
    commit(n);
    return it.id;
  },
  /** DIAGRAM_UPDATE_ITEM { itemId, label?, kind?, shape?, size?, style?, x?, y? } — mover à mão passa para o modo manual. */
  DIAGRAM_UPDATE_ITEM: (e, op) => {
    const n = host(e, op.targetId);
    const p = op.payload ?? {};
    const it = itemOf(n, p.itemId);
    for (const k of ['label', 'kind', 'shape', 'size', 'style'] as const) if (p[k] !== undefined) (it as any)[k] = p[k] === null ? undefined : clone(p[k]);
    if (p.x !== undefined || p.y !== undefined) {
      if (n.data.autoLayout !== false) n.data.autoLayout = false;
      if (p.x !== undefined) it.x = Number(p.x);
      if (p.y !== undefined) it.y = Number(p.y);
    }
    commit(n);
    return it.id;
  },
  /** DIAGRAM_REMOVE_ITEM { itemId, withChildren? } — sem withChildren, os filhos sobem para o avô. */
  DIAGRAM_REMOVE_ITEM: (e, op) => {
    const n = host(e, op.targetId);
    const it = itemOf(n, op.payload?.itemId);
    const gone = new Set([it.id]);
    if (op.payload?.withChildren) { let grew = true; while (grew) { grew = false; for (const x of n.data.items) if (x.parentId && gone.has(x.parentId) && !gone.has(x.id)) { gone.add(x.id); grew = true; } } }
    else for (const x of n.data.items) if (x.parentId === it.id) x.parentId = it.parentId ?? null;
    n.data.items = n.data.items.filter((x: DiagramItem) => !gone.has(x.id));
    n.data.connections = n.data.connections.filter((c: DiagramConnection) => !gone.has(c.from) && !gone.has(c.to));
    commit(n);
    return [...gone];
  },
  /** DIAGRAM_SET_PARENT { itemId, parentId | null } */
  DIAGRAM_SET_PARENT: (e, op) => {
    const n = host(e, op.targetId);
    const it = itemOf(n, op.payload?.itemId);
    const parentId = op.payload?.parentId ?? null;
    if (parentId) itemOf(n, parentId);
    it.parentId = parentId;
    placeAfter(n, it, parentId ? (siblings(n, it).filter((x: DiagramItem) => x.id !== it.id).at(-1)?.id ?? parentId) : null);
    commit(n);
    return it.id;
  },
  /** Sobe um nível: vira irmão do pai, logo depois dele. */
  DIAGRAM_PROMOTE: (e, op) => {
    const n = host(e, op.targetId);
    const it = itemOf(n, op.payload?.itemId);
    if (!it.parentId) fail('INVALID_OPERATION', 'O item já está no primeiro nível.');
    const parent = itemOf(n, it.parentId!);
    it.parentId = parent.parentId ?? null;
    placeAfter(n, it, parent.id);
    commit(n);
    return it.id;
  },
  /** Desce um nível: vira filho do irmão anterior. */
  DIAGRAM_DEMOTE: (e, op) => {
    const n = host(e, op.targetId);
    const it = itemOf(n, op.payload?.itemId);
    const sib = siblings(n, it);
    const prev = sib[sib.indexOf(it) - 1];
    if (!prev) fail('INVALID_OPERATION', 'Não há item anterior no mesmo nível para ficar dentro.');
    it.parentId = prev.id;
    const last = childrenOf(n.data.items, prev.id).filter((x) => x.id !== it.id).at(-1);
    placeAfter(n, it, last?.id ?? prev.id);
    commit(n);
    return it.id;
  },
  /** DIAGRAM_MOVE_ITEM { itemId, direction: UP | DOWN } — troca de lugar com o irmão vizinho. */
  DIAGRAM_MOVE_ITEM: (e, op) => {
    const n = host(e, op.targetId);
    const it = itemOf(n, op.payload?.itemId);
    const sib = siblings(n, it);
    const other = sib[sib.indexOf(it) + (op.payload?.direction === 'UP' ? -1 : 1)];
    if (!other) fail('INVALID_OPERATION', 'Não há para onde mover.');
    const list: DiagramItem[] = n.data.items;
    const i = list.indexOf(it), j = list.indexOf(other);
    list[i] = other; list[j] = it;
    commit(n);
    return it.id;
  },
  /** DIAGRAM_CONNECT { from, to, label?, routing?, arrow? } */
  DIAGRAM_CONNECT: (e, op) => {
    const n = host(e, op.targetId);
    const p = op.payload ?? {};
    if (n.data.connections.some((c: DiagramConnection) => c.from === p.from && c.to === p.to)) fail('VALIDATION', 'Esses itens já estão ligados.');
    const c: DiagramConnection = { id: e.newId('DCON'), from: p.from, to: p.to, ...(p.label ? { label: String(p.label) } : {}), ...(p.routing ? { routing: p.routing } : {}), ...(p.arrow === false ? { arrow: false } : {}) };
    n.data.connections.push(c);
    commit(n);
    return c.id;
  },
  /** DIAGRAM_UPDATE_CONNECTION { connectionId, label?, routing?, arrow?, from?, to? } */
  DIAGRAM_UPDATE_CONNECTION: (e, op) => {
    const n = host(e, op.targetId);
    const p = op.payload ?? {};
    const c: DiagramConnection = n.data.connections.find((x: DiagramConnection) => x.id === p.connectionId) ?? fail('NOT_FOUND', `Conexão ${p.connectionId} não existe.`);
    for (const k of ['label', 'routing', 'arrow', 'from', 'to'] as const) if (p[k] !== undefined) (c as any)[k] = p[k] === null ? undefined : p[k];
    commit(n);
    return c.id;
  },
  DIAGRAM_DISCONNECT: (e, op) => {
    const n = host(e, op.targetId);
    const before = n.data.connections.length;
    n.data.connections = n.data.connections.filter((c: DiagramConnection) => c.id !== op.payload?.connectionId);
    if (n.data.connections.length === before) fail('NOT_FOUND', `Conexão ${op.payload?.connectionId} não existe.`);
    commit(n);
    return op.payload?.connectionId;
  },
  /** DIAGRAM_LAYOUT { algorithm?, direction?, spacing?: { x, y }, radius? } — volta ao layout automático. */
  DIAGRAM_LAYOUT: (e, op) => {
    const n = host(e, op.targetId);
    const p = op.payload ?? {};
    n.data.layoutOptions = { ...(n.data.layoutOptions ?? {}), ...clone(p) };
    for (const k of Object.keys(n.data.layoutOptions)) if (n.data.layoutOptions[k] === null) delete n.data.layoutOptions[k];
    delete n.data.autoLayout;
    commit(n);
    return clone(n.data.bounds);
  },
  /** DIAGRAM_CHANGE_TYPE { diagramType } — mantém itens; sem hierarquia, ela é deduzida das ligações (1º antecessor). */
  DIAGRAM_CHANGE_TYPE: (e, op) => {
    const n = host(e, op.targetId);
    const t = op.payload?.diagramType;
    if (!DIAGRAM_TYPES.includes(t)) fail('VALIDATION', `Diagrama: ${DIAGRAM_TYPES.join(', ')}.`);
    const tree = ['ORGCHART', 'HIERARCHY', 'MINDMAP'].includes(t);
    if (tree && !n.data.items.some((x: DiagramItem) => x.parentId)) {
      const order: DiagramItem[] = n.data.items;
      for (const it of order) {
        const c = n.data.connections.find((x: DiagramConnection) => x.to === it.id && order.indexOf(order.find((y) => y.id === x.from)!) < order.indexOf(it));
        if (c) it.parentId = c.from;
      }
      n.data.connections = n.data.connections.filter((c: DiagramConnection) => !order.some((it) => it.id === c.to && it.parentId === c.from));
    }
    n.data.diagramType = t;
    delete n.data.layoutOptions?.algorithm;
    delete n.data.autoLayout;
    commit(n);
    return t;
  },
  /** DIAGRAM_FROM_TEXT { text, diagramType? } — tópicos com recuo viram a hierarquia (substitui os itens). */
  DIAGRAM_FROM_TEXT: (e, op) => {
    const n = host(e, op.targetId);
    const items = itemsFromOutline(e, String(op.payload?.text ?? ''));
    if (!items.length) fail('VALIDATION', 'Escreva ao menos um tópico.');
    n.data.items = items;
    n.data.connections = [];
    if (op.payload?.diagramType) n.data.diagramType = op.payload.diagramType;
    delete n.data.autoLayout;
    commit(n);
    return items.map((x) => x.id);
  },
  DIAGRAM_TO_TEXT: (e, op) => outlineFromItems(host(e, op.targetId, false).data.items),
};
