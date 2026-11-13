// Layout e posicionamento (Camada 7). Dois sistemas no mesmo motor:
//   FLOW (documentos): o elemento acompanha a sequência do conteúdo, sem x/y.
//   ABSOLUTE (slides, desenhos): posição e tamanho próprios. Planilhas usam GRID (linhas e colunas).
// Operações: SET_POSITION · RESIZE · TRANSFORM · ALIGN · DISTRIBUTE · SET_LAYOUT · UPDATE_LAYOUT · SET_CONSTRAINT ·
// SET_GRID · ADD_GUIDE · MOVE_GUIDE · REMOVE_GUIDE · SNAP (sugestão de encaixe na grade, guias e outros objetos).
import type { EditorNode, Guide } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { bounds, box, refreshGroups, translate } from './basic.ts';
import { targetsOf } from './selection.ts';
import { fail, merge } from '../util.ts';

const needsAbsolute = (n: EditorNode) => {
  if (n.layout.mode !== 'ABSOLUTE') fail('INVALID_OPERATION', `${n.id} acompanha o fluxo; mude o layout para ABSOLUTE para posicionar livremente.`);
};

/** Área de referência do pai (superfície/slide/grupo) para alinhar um objeto sozinho. */
function parentArea(e: Engine, n: EditorNode) {
  const p = e.get(n.parentId);
  const slide = e.doc.document.settings.slide;
  const width = typeof p.layout.width === 'number' ? p.layout.width : slide?.width ?? 0;
  const height = typeof p.layout.height === 'number' ? p.layout.height : slide?.height ?? 0;
  return p.type === 'GROUP' ? box(p) : { x: 0, y: 0, width, height };
}

/** Limita ao mínimo/máximo das restrições. */
function clampSize(n: EditorNode, w: number, h: number) {
  const c = n.layout.constraints ?? {};
  const cw = Math.min(c.maxWidth ?? Infinity, Math.max(c.minWidth ?? 1, w));
  const ch = Math.min(c.maxHeight ?? Infinity, Math.max(c.minHeight ?? 1, h));
  return { width: cw, height: ch };
}

/** Sugestão de encaixe: grade, guias, bordas e centros dos irmãos e da área do pai (limite em px). */
export function snap(e: Engine, id: string, x: number, y: number, threshold = 6) {
  const n = e.get(id);
  const b = box(n);
  const s = e.doc.document.settings;
  const xs: number[] = [], ys: number[] = [];
  const area = parentArea(e, n);
  xs.push(area.x, area.x + area.width / 2, area.x + area.width);
  ys.push(area.y, area.y + area.height / 2, area.y + area.height);
  for (const g of s.guides) (g.orientation === 'VERTICAL' ? xs : ys).push(g.position);
  for (const sid of e.get(n.parentId).children) {
    if (sid === id) continue;
    const o = e.doc.nodes[sid];
    if (o.layout.mode !== 'ABSOLUTE') continue;
    const ob = box(o);
    xs.push(ob.x, ob.x + ob.width / 2, ob.x + ob.width);
    ys.push(ob.y, ob.y + ob.height / 2, ob.y + ob.height);
  }
  const best = (pos: number, size: number, lines: number[], grid: number | null) => {
    let out = { value: pos, line: null as number | null, dist: threshold + 1 };
    for (const edge of [0, size / 2, size]) {
      for (const l of lines) { const d = Math.abs(pos + edge - l); if (d < out.dist) out = { value: l - edge, line: l, dist: d }; }
    }
    if (out.line === null && grid) { const g = Math.round(pos / grid) * grid; if (Math.abs(g - pos) <= threshold) out = { value: g, line: null, dist: 0 }; }
    return out;
  };
  const grid = s.grid.enabled && s.grid.snap ? s.grid.size : null;
  const bx = best(x, b.width, xs, grid), by = best(y, b.height, ys, grid);
  return { x: bx.value, y: by.value, guides: { vertical: bx.line, horizontal: by.line } };
}

const guides = (e: Engine) => (e.touch('document', 'info') as any).settings.guides as Guide[];

export const layoutHandlers: Record<string, Handler> = {
  /** SET_POSITION { x, y, snap? } — com snap, encaixa na grade/guias/objetos próximos. */
  SET_POSITION: (e, op) => {
    const id = op.targetId ?? fail('INVALID_PAYLOAD', 'Informe targetId.');
    e.assertEditable(id!);
    const n = e.get(id);
    if (n.type !== 'GROUP') needsAbsolute(n);
    let { x, y } = op.payload ?? {};
    if (typeof x !== 'number' || typeof y !== 'number') fail('INVALID_PAYLOAD', 'Informe x e y numéricos.');
    if (op.payload?.snap) ({ x, y } = snap(e, id!, x, y, op.payload.threshold));
    const b = box(n);
    translate(e, id!, x - b.x, y - b.y);
    refreshGroups(e, id!);
    return { x, y };
  },

  /**
   * RESIZE { width?, height?, keepRatio?, from? }. Com proporção travada (layout.lockAspectRatio ou keepRatio),
   * mudar só a largura ajusta a altura. `from: 'CENTER'` cresce para os dois lados. Grupo escala os filhos junto.
   */
  RESIZE: (e, op) => targetsOf(e, op).map((id) => {
    e.assertEditable(id);
    const n = e.get(id);
    if (n.type !== 'GROUP') needsAbsolute(n);
    const b = box(n);
    let { width = b.width, height = b.height } = op.payload ?? {};
    if (width <= 0 || height <= 0) fail('VALIDATION', 'Largura e altura precisam ser maiores que zero.');
    const ratio = b.height ? b.width / b.height : 1;
    const locked = (n.layout.lockAspectRatio || op.payload?.keepRatio) && b.width && b.height;
    if (locked) {
      if (op.payload?.width !== undefined && op.payload?.height === undefined) height = width / ratio;
      else if (op.payload?.height !== undefined && op.payload?.width === undefined) width = height * ratio;
    }
    ({ width, height } = clampSize(n, width, height));
    if (locked) {   // o limite cortou um lado: o outro acompanha para manter a proporção
      if (Math.abs(width / height - ratio) > 1e-9) {
        if (width / ratio <= height) height = width / ratio; else width = height * ratio;
        ({ width, height } = clampSize(n, width, height));
      }
    }
    const x = op.payload?.from === 'CENTER' ? b.x - (width - b.width) / 2 : b.x;
    const y = op.payload?.from === 'CENTER' ? b.y - (height - b.height) / 2 : b.y;
    if (n.type === 'GROUP' && b.width && b.height) {
      const sx = width / b.width, sy = height / b.height;
      for (const cid of e.descendants(id)) {
        const c = e.doc.nodes[cid];
        if (c.layout.mode !== 'ABSOLUTE') continue;
        const cb = box(c), t = e.touchNode(cid);
        Object.assign(t.layout, { x: x + (cb.x - b.x) * sx, y: y + (cb.y - b.y) * sy, width: cb.width * sx, height: cb.height * sy });
      }
    }
    const t = e.touchNode(id);
    Object.assign(t.layout, { x, y, width, height });
    refreshGroups(e, id);
    return { id, width, height };
  }),

  /** TRANSFORM { rotation?, scaleX?, scaleY?, flipH?, flipV? } — girar, escalar e inverter. */
  TRANSFORM: (e, op) => targetsOf(e, op).map((id) => {
    e.assertEditable(id);
    const p = op.payload ?? {};
    const t = e.touchNode(id);
    if (p.rotation !== undefined) t.layout.rotation = ((Number(p.rotation) % 360) + 360) % 360;
    if (p.scaleX !== undefined) t.layout.scaleX = Number(p.scaleX);
    if (p.scaleY !== undefined) t.layout.scaleY = Number(p.scaleY);
    if (p.flipH !== undefined) t.layout.flipH = p.flipH === 'TOGGLE' ? !t.layout.flipH : Boolean(p.flipH);
    if (p.flipV !== undefined) t.layout.flipV = p.flipV === 'TOGGLE' ? !t.layout.flipV : Boolean(p.flipV);
    return id;
  }),

  /** ALIGN { alignment: LEFT|CENTER|RIGHT|TOP|MIDDLE|BOTTOM }: entre os selecionados; um só alinha ao pai (slide). */
  ALIGN: (e, op) => {
    const ids = targetsOf(e, op);
    ids.forEach((id) => { e.assertEditable(id); const n = e.get(id); if (n.type !== 'GROUP') needsAbsolute(n); });
    const ref = ids.length === 1 || op.payload?.relativeTo === 'PARENT' ? parentArea(e, e.get(ids[0])) : bounds(e, ids);
    const a = op.payload?.alignment;
    for (const id of ids) {
      const b = box(e.get(id));
      let dx = 0, dy = 0;
      if (a === 'LEFT') dx = ref.x - b.x;
      else if (a === 'CENTER') dx = ref.x + ref.width / 2 - (b.x + b.width / 2);
      else if (a === 'RIGHT') dx = ref.x + ref.width - (b.x + b.width);
      else if (a === 'TOP') dy = ref.y - b.y;
      else if (a === 'MIDDLE') dy = ref.y + ref.height / 2 - (b.y + b.height / 2);
      else if (a === 'BOTTOM') dy = ref.y + ref.height - (b.y + b.height);
      else fail('INVALID_PAYLOAD', 'Alinhamento: LEFT, CENTER, RIGHT, TOP, MIDDLE ou BOTTOM.');
      translate(e, id, dx, dy);
      refreshGroups(e, id);
    }
    return ids;
  },

  /** DISTRIBUTE { axis: HORIZONTAL|VERTICAL }: 3+ objetos com espaços iguais entre eles. */
  DISTRIBUTE: (e, op) => {
    const ids = targetsOf(e, op);
    if (ids.length < 3) fail('INVALID_PAYLOAD', 'Selecione pelo menos três objetos para distribuir.');
    const horizontal = (op.payload?.axis ?? 'HORIZONTAL') === 'HORIZONTAL';
    const items = ids.map((id) => ({ id, b: box(e.get(id)) })).sort((p, q) => (horizontal ? p.b.x - q.b.x : p.b.y - q.b.y));
    const first = items[0].b, last = items[items.length - 1].b;
    const span = horizontal ? last.x + last.width - first.x : last.y + last.height - first.y;
    const used = items.reduce((s, i) => s + (horizontal ? i.b.width : i.b.height), 0);
    const gap = (span - used) / (items.length - 1);
    let cursor = horizontal ? first.x : first.y;
    for (const { id, b } of items) {
      e.assertEditable(id);
      translate(e, id, horizontal ? cursor - b.x : 0, horizontal ? 0 : cursor - b.y);
      refreshGroups(e, id);
      cursor += (horizontal ? b.width : b.height) + gap;
    }
    return { gap };
  },

  /** SET_LAYOUT { mode, ... }: troca o modo (FLOW/ABSOLUTE/GRID). UPDATE_LAYOUT só ajusta propriedades. */
  SET_LAYOUT: (e, op) => targetsOf(e, op).map((id) => {
    e.assertEditable(id);
    const { mode, ...rest } = op.payload ?? {};
    if (!['FLOW', 'ABSOLUTE', 'GRID'].includes(mode)) fail('INVALID_PAYLOAD', 'Modo de layout: FLOW, ABSOLUTE ou GRID.');
    const t = e.touchNode(id);
    t.layout = mode === 'FLOW' ? merge({ mode, zIndex: undefined, direction: t.layout.direction, gap: t.layout.gap, padding: t.layout.padding }, rest) : merge({ ...t.layout, mode }, rest);
    if (mode === 'FLOW') { delete t.layout.x; delete t.layout.y; delete t.layout.zIndex; }
    return id;
  }),

  UPDATE_LAYOUT: (e, op) => targetsOf(e, op).map((id) => {
    e.assertEditable(id);
    const p = op.payload ?? {};
    if ('mode' in p) fail('INVALID_PAYLOAD', 'Para trocar o modo, use SET_LAYOUT.');
    for (const k of ['gap', 'padding', 'marginTop', 'marginBottom', 'columns']) if (k in p && p[k] !== null && (typeof p[k] !== 'number' || p[k] < 0)) fail('VALIDATION', `${k} precisa ser um número maior ou igual a zero.`);
    const t = e.touchNode(id);
    t.layout = merge(t.layout, p);
    return id;
  }),

  SET_CONSTRAINT: (e, op) => targetsOf(e, op).map((id) => {
    e.assertEditable(id);
    const c = op.payload ?? {};
    if (c.minWidth && c.maxWidth && c.minWidth > c.maxWidth) fail('VALIDATION', 'Largura mínima maior que a máxima.');
    if (c.minHeight && c.maxHeight && c.minHeight > c.maxHeight) fail('VALIDATION', 'Altura mínima maior que a máxima.');
    const t = e.touchNode(id);
    const { lockAspectRatio, ...rest } = c;
    t.layout.constraints = merge(t.layout.constraints ?? {}, rest);
    if (lockAspectRatio !== undefined) t.layout.lockAspectRatio = Boolean(lockAspectRatio);
    return id;
  }),

  SET_GRID: (e, op) => {
    const s = (e.touch('document', 'info') as any).settings;
    s.grid = merge(s.grid, op.payload ?? {});
    if (s.grid.size <= 0) fail('VALIDATION', 'O tamanho da grade precisa ser maior que zero.');
    return { ...s.grid };
  },

  ADD_GUIDE: (e, op) => {
    const { orientation, position } = op.payload ?? {};
    if (!['VERTICAL', 'HORIZONTAL'].includes(orientation) || typeof position !== 'number') fail('INVALID_PAYLOAD', 'Guia: orientation VERTICAL/HORIZONTAL e position numérica.');
    const id = e.newId('GUIDE');
    guides(e).push({ id, orientation, position });
    return id;
  },
  MOVE_GUIDE: (e, op) => {
    const g = guides(e).find((x) => x.id === op.targetId) ?? fail('NOT_FOUND', `Guia ${op.targetId} não existe.`);
    g.position = Number(op.payload?.position);
    return g.id;
  },
  REMOVE_GUIDE: (e, op) => {
    const s = (e.touch('document', 'info') as any).settings;
    s.guides = s.guides.filter((g: Guide) => g.id !== op.targetId);
    return op.targetId;
  },

  /** Consulta: onde o objeto encaixaria se fosse solto em (x, y). Não altera nada. */
  SNAP: (e, op) => snap(e, op.targetId ?? fail('INVALID_PAYLOAD', 'Informe targetId.'), op.payload?.x, op.payload?.y, op.payload?.threshold),
};
