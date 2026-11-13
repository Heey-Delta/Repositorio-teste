// Organização (Camada 5): GROUP · UNGROUP · REORDER · camadas (BRING_FORWARD, SEND_BACKWARD, BRING_TO_FRONT,
// SEND_TO_BACK) · LOCK · UNLOCK · HIDE · SHOW · COLLAPSE · EXPAND.
// Duas coisas diferentes: hierarquia (parentId/children/order = quem está dentro de quem) e ordem visual
// (layout.zIndex = quem aparece na frente, só entre irmãos). Mudar a camada não muda a hierarquia.
import type { Engine, Handler } from '../engine.ts';
import { attach, bounds, detach } from './basic.ts';
import { setSelection, targetsOf } from './selection.ts';
import { fail } from '../util.ts';
import { emptyNode } from '../document.ts';

/** Irmãos posicionados livremente, do fundo para a frente. */
function stack(e: Engine, parentId: string) {
  return e.get(parentId).children
    .map((id) => e.doc.nodes[id])
    .filter((n) => n && (n.layout.mode === 'ABSOLUTE' || n.type === 'GROUP'))
    .sort((a, b) => (a.layout.zIndex ?? 0) - (b.layout.zIndex ?? 0) || a.order - b.order)
    .map((n) => n.id);
}

function writeStack(e: Engine, ids: string[]) {
  ids.forEach((id, i) => { if (e.doc.nodes[id].layout.zIndex !== i) e.touchNode(id).layout.zIndex = i; });
}

function restack(e: Engine, id: string, move: (list: string[], i: number) => string[]) {
  e.assertEditable(id);
  const n = e.get(id);
  if (!n.parentId) fail('INVALID_OPERATION', 'A raiz não tem camada.');
  const list = stack(e, n.parentId!);
  const i = list.indexOf(id);
  if (i < 0) fail('INVALID_OPERATION', `${id} acompanha o fluxo do texto; camadas valem para objetos posicionados livremente.`);
  writeStack(e, move(list, i));
  return e.get(id).layout.zIndex;
}

const swap = (list: string[], a: number, b: number) => { const l = [...list]; if (b < 0 || b >= l.length) return l; [l[a], l[b]] = [l[b], l[a]]; return l; };

const each = (e: Engine, op: any, fn: (id: string) => unknown) => targetsOf(e, op).map(fn);

export const organizeHandlers: Record<string, Handler> = {
  /** Agrupa 2+ objetos do mesmo pai num GROUP novo, no lugar do primeiro deles. */
  GROUP: (e, op) => {
    const ids = targetsOf(e, op);
    if (ids.length < 2) fail('INVALID_PAYLOAD', 'Selecione pelo menos dois objetos para agrupar.');
    const parents = new Set(ids.map((id) => e.get(id).parentId));
    if (parents.size !== 1) fail('INVALID_OPERATION', 'Só dá para agrupar objetos que estão no mesmo lugar (mesmo pai).');
    ids.forEach((id) => e.assertEditable(id));
    const parentId = [...parents][0]!;
    const ordered = [...ids].sort((a, b) => e.get(a).order - e.get(b).order);
    const spatial = ordered.every((id) => e.get(id).layout.mode === 'ABSOLUTE' || e.get(id).type === 'GROUP');
    const index = e.get(ordered[0]).order;
    const z = Math.max(...ordered.map((id) => e.get(id).layout.zIndex ?? 0));
    for (const id of ordered) detach(e, id);
    const g = emptyNode(e.newId('GROUP'), 'GROUP', parentId);
    g.layout = spatial ? { mode: 'ABSOLUTE', ...bounds(e, ordered), zIndex: z } : { mode: 'FLOW' };
    attach(e, g, parentId, index);
    const group = e.touchNode(g.id);
    for (const id of ordered) {
      const c = e.touchNode(id);
      c.parentId = group.id;
      group.children.push(id);
    }
    e.normalizeOrder(group.id);
    if (spatial) writeStack(e, stack(e, parentId));
    setSelection(e, [group.id]);
    return group.id;
  },

  /** Desfaz o grupo: os filhos voltam para o pai, no lugar do grupo, com a mesma identidade. */
  UNGROUP: (e, op) => {
    const out: string[] = [];
    for (const gid of targetsOf(e, op)) {
      const g = e.get(gid);
      if (g.type !== 'GROUP') fail('INVALID_OPERATION', `${gid} não é um grupo.`);
      e.assertEditable(gid);
      const parentId = g.parentId!, at = g.order, z = g.layout.zIndex ?? 0;
      const kids = [...g.children];
      detach(e, gid);
      const p = e.touchNode(parentId);
      kids.forEach((cid, i) => {
        const c = e.touchNode(cid);
        c.parentId = parentId;
        if (c.layout.mode === 'ABSOLUTE') c.layout.zIndex = z + i / 1000;   // mantém a ordem entre eles, no lugar do grupo
        p.children.splice(at + i, 0, cid);
      });
      e.del('nodes', gid);
      e.normalizeOrder(parentId);
      writeStack(e, stack(e, parentId));
      out.push(...kids);
    }
    setSelection(e, out);
    return out;
  },

  /** Muda a posição na estrutura (ordem de leitura): REORDER { newOrder }. */
  REORDER: (e, op) => {
    const id = op.targetId ?? fail('INVALID_PAYLOAD', 'Informe targetId.');
    e.assertEditable(id!);
    const n = e.get(id);
    const p = e.touchNode(n.parentId ?? fail('INVALID_OPERATION', 'A raiz não pode ser reordenada.'));
    const to = Math.max(0, Math.min(Number(op.payload?.newOrder ?? 0), p.children.length - 1));
    p.children = p.children.filter((c: string) => c !== id);
    p.children.splice(to, 0, id);
    e.normalizeOrder(p.id);
    return to;
  },

  BRING_FORWARD: (e, op) => each(e, op, (id) => restack(e, id, (l, i) => swap(l, i, i + 1))),
  SEND_BACKWARD: (e, op) => each(e, op, (id) => restack(e, id, (l, i) => swap(l, i, i - 1))),
  BRING_TO_FRONT: (e, op) => each(e, op, (id) => restack(e, id, (l, i) => [...l.slice(0, i), ...l.slice(i + 1), l[i]])),
  SEND_TO_BACK: (e, op) => each(e, op, (id) => restack(e, id, (l, i) => [l[i], ...l.slice(0, i), ...l.slice(i + 1)])),

  LOCK: (e, op) => each(e, op, (id) => { e.touchNode(id).metadata.locked = true; return id; }),
  UNLOCK: (e, op) => each(e, op, (id) => { delete e.touchNode(id).metadata.locked; return id; }),
  HIDE: (e, op) => each(e, op, (id) => { e.assertEditable(id); e.touchNode(id).metadata.visible = false; return id; }),
  SHOW: (e, op) => each(e, op, (id) => { e.assertEditable(id); delete e.touchNode(id).metadata.visible; return id; }),
  COLLAPSE: (e, op) => each(e, op, (id) => { e.touchNode(id).metadata.collapsed = true; return id; }),
  EXPAND: (e, op) => each(e, op, (id) => { delete e.touchNode(id).metadata.collapsed; return id; }),
};
