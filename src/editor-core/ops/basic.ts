// Operações básicas (Camada 2): CREATE · GET · UPDATE · MOVE · DUPLICATE · DELETE.
// Todas as outras (colar, agrupar, inserir conteúdo…) são compostas a partir das funções exportadas aqui.
import type { EditorNode, NodeType, Operation } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { CONTENT_TYPES, STRUCTURAL_TYPES } from '../types.ts';
import { canContain } from '../schema.ts';
import { emptyNode } from '../document.ts';
import { clone, fail, merge } from '../util.ts';
import { referenceSlots, remapReferences } from '../refs.ts';

const ALL_TYPES = new Set<string>([...STRUCTURAL_TYPES, ...CONTENT_TYPES]);

export interface CreateInput {
  parentId: string;
  nodeType: NodeType;
  data?: Record<string, any>;
  layout?: EditorNode['layout'];
  styleId?: string | null;
  styleOverrides?: Record<string, unknown>;
  metadata?: EditorNode['metadata'];
  /** posição entre os irmãos (padrão: no fim) */
  index?: number;
}

const isAbsolute = (n: EditorNode) => n.layout.mode === 'ABSOLUTE';

export function siblingsMaxZ(e: Engine, parentId: string): number {
  return Math.max(-1, ...e.get(parentId).children.map((id) => e.doc.nodes[id]?.layout.zIndex ?? -1));
}

/** Coloca um nó já montado dentro do pai (valida hierarquia, ordem e camada). */
export function attach(e: Engine, node: EditorNode, parentId: string, index?: number) {
  const parent = e.get(parentId);
  if (!canContain(parent.type, node.type)) fail('INVALID_PARENT', `${node.type} não pode ficar dentro de ${parent.type}.`);
  e.assertEditable(parentId);
  const p = e.touchNode(parentId);
  const at = index === undefined || index < 0 || index > p.children.length ? p.children.length : index;
  node.parentId = parentId;
  if (isAbsolute(node) && node.layout.zIndex === undefined) node.layout.zIndex = siblingsMaxZ(e, parentId) + 1;
  e.put('nodes', node.id, node);
  p.children.splice(at, 0, node.id);
  e.normalizeOrder(parentId);
}

export function createNode(e: Engine, input: CreateInput): EditorNode {
  if (!ALL_TYPES.has(input.nodeType)) fail('INVALID_PAYLOAD', `Tipo desconhecido: ${input.nodeType}.`);
  if (input.styleId && !e.doc.styles[input.styleId]) fail('NOT_FOUND', `Estilo ${input.styleId} não existe.`);
  const node = emptyNode(e.newId(input.nodeType), input.nodeType, input.parentId);
  node.data = clone(input.data ?? {});
  node.layout = clone(input.layout ?? {});
  node.styleId = input.styleId ?? null;
  node.styleOverrides = clone(input.styleOverrides ?? {});
  node.metadata = clone(input.metadata ?? {});
  attach(e, node, input.parentId, input.index);
  return node;
}

/** Tira o nó da lista de filhos do pai (sem apagar o nó). */
export function detach(e: Engine, id: string) {
  const n = e.get(id);
  if (!n.parentId) fail('INVALID_OPERATION', 'A raiz do documento não pode ser movida nem excluída.');
  const p = e.touchNode(n.parentId!);
  p.children = p.children.filter((c: string) => c !== id);
  e.normalizeOrder(n.parentId!);
}

/** Caixa do elemento em coordenadas da superfície (só para posicionamento livre). */
export function box(n: EditorNode) {
  const l = n.layout;
  return { x: l.x ?? 0, y: l.y ?? 0, width: typeof l.width === 'number' ? l.width : 0, height: typeof l.height === 'number' ? l.height : 0 };
}

/** Caixa que envolve vários objetos. */
export function bounds(e: Engine, ids: string[]) {
  const bs = ids.map((id) => box(e.get(id)));
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, width: Math.max(...bs.map((b) => b.x + b.width)) - x, height: Math.max(...bs.map((b) => b.y + b.height)) - y };
}

export function refreshGroupBox(e: Engine, groupId: string) {
  const g = e.get(groupId);
  if (g.type !== 'GROUP' || g.layout.mode !== 'ABSOLUTE' || !g.children.length) return;
  const b = bounds(e, g.children);
  const t = e.touchNode(groupId);
  Object.assign(t.layout, b);
}

/** Desloca um nó (e, se for grupo, todos os descendentes posicionados) por dx, dy. */
export function translate(e: Engine, id: string, dx: number, dy: number) {
  for (const nid of [id, ...e.descendants(id)]) {
    const n = e.doc.nodes[nid];
    if (!n || !isAbsolute(n)) continue;
    const t = e.touchNode(nid);
    t.layout.x = (t.layout.x ?? 0) + dx;
    t.layout.y = (t.layout.y ?? 0) + dy;
  }
}

/** Remove um nó e toda a subárvore, tratando quem apontava para eles. */
export function removeSubtree(e: Engine, id: string) {
  const n = e.get(id);
  const doomed = new Set([id, ...e.descendants(id)]);
  const centers = new Map<string, { x: number; y: number }>();
  for (const did of doomed) { const b = box(e.doc.nodes[did]); centers.set(did, { x: b.x + b.width / 2, y: b.y + b.height / 2 }); }
  if (n.parentId) detach(e, id);
  for (const did of [...doomed].reverse()) e.del('nodes', did);
  // comentários do que foi apagado ficam soltos (continuam visíveis na lista, sem âncora)
  for (const t of Object.values(e.doc.comments ?? {})) if (doomed.has(t.anchor.targetId) && !t.anchor.detached) e.touch('comments', t.id).anchor.detached = true;
  // referências quebradas: conector vira ponto solto; gráfico/legenda/link marcam a fonte como perdida
  for (const other of Object.values(e.doc.nodes)) {
    const slots = referenceSlots(other).filter((s) => doomed.has(s.get()!));
    if (!slots.length) continue;
    const t = e.touchNode(other.id);
    if (t.type === 'SURFACE') {   // animações do elemento apagado somem; gatilho por objeto apagado vira "ao clicar"
      t.data.animations = (t.data.animations ?? []).filter((a: any) => !doomed.has(a.targetId));
      for (const a of t.data.animations) if (a.triggerId && doomed.has(a.triggerId)) { a.trigger = 'ON_CLICK'; delete a.triggerId; }
      continue;
    }
    if (t.type === 'LINE') {
      for (const k of ['start', 'end']) {
        const end = t.data[k];
        if (end?.targetId && doomed.has(end.targetId)) { end.point = centers.get(end.targetId); delete end.targetId; }
      }
      continue;
    }
    for (const s of referenceSlots(t)) {
      if (!doomed.has(s.get()!)) continue;
      s.set(undefined);
      if (t.type === 'CHART') t.data.source = { ...t.data.source, missing: true };
      else t.data.broken = true;
    }
  }
  e.cleanSelection();
}

/** Copia uma subárvore com IDs novos (relações internas passam a apontar para as cópias). */
export function cloneSubtree(e: Engine, nodes: Record<string, EditorNode>, rootId: string): { rootId: string; nodes: EditorNode[]; map: Map<string, string> } {
  const map = new Map<string, string>();
  const order: string[] = [];
  const walk = (id: string) => { order.push(id); for (const c of nodes[id]?.children ?? []) walk(c); };
  walk(rootId);
  for (const id of order) map.set(id, e.newId(nodes[id].type));
  const out = order.map((id) => {
    const c = clone(nodes[id]);
    c.id = map.get(id)!;
    c.children = c.children.map((x) => map.get(x)!);
    c.parentId = c.parentId && map.has(c.parentId) ? map.get(c.parentId)! : c.parentId;
    return c;
  });
  for (const c of out) remapReferences(c, map);
  for (const c of out) if (Array.isArray(c.data.animations)) c.data.animations = c.data.animations.map((a: any) => ({ ...a, id: e.newId('ANIM') }));   // slide duplicado: animações com IDs próprios
  return { rootId: map.get(rootId)!, nodes: out, map };
}

/** Insere uma subárvore já clonada: a raiz entra no pai; os descendentes entram direto na coleção. */
export function insertSubtree(e: Engine, sub: { rootId: string; nodes: EditorNode[] }, parentId: string, index?: number) {
  const root = sub.nodes.find((n) => n.id === sub.rootId)!;
  for (const n of sub.nodes) if (n.id !== root.id) e.put('nodes', n.id, n);
  root.layout = { ...root.layout, zIndex: undefined };
  attach(e, root, parentId, index);
  return root;
}

const subtreeOf = (e: Engine, id: string) => Object.fromEntries([id, ...e.descendants(id)].map((nid) => [nid, e.doc.nodes[nid]]));

export function duplicate(e: Engine, id: string, offset = 10) {
  const n = e.get(id);
  if (!n.parentId) fail('INVALID_OPERATION', 'A raiz do documento não pode ser duplicada.');
  const sub = cloneSubtree(e, subtreeOf(e, id), id);
  const root = insertSubtree(e, sub, n.parentId!, n.order + 1);
  if (isAbsolute(root) && offset) translate(e, root.id, offset, offset);
  return root;
}

export { subtreeOf };

/** Depois de mover/redimensionar um filho, a caixa dos grupos acima dele acompanha. */
export function refreshGroups(e: Engine, id: string) {
  for (const a of e.ancestors(id)) { if (e.get(a).type !== 'GROUP') break; refreshGroupBox(e, a); }
}

const ids = (op: Operation) => (op.targetIds?.length ? op.targetIds : op.targetId ? [op.targetId] : fail('INVALID_PAYLOAD', 'Informe targetId ou targetIds.'));

export const basicHandlers: Record<string, Handler> = {
  CREATE: (e, op) => clone(createNode(e, op.payload as CreateInput)),

  GET: (e, op) => clone(e.get(op.targetId)),
  /** Nome do documento (vai para o título das exportações e da lista). */
  RENAME_DOCUMENT: (e, op) => {
    const name = String(op.payload?.name ?? '').trim();
    if (!name || name.length > 200) fail('VALIDATION', 'Nome: de 1 a 200 caracteres.');
    (e.touch('document', 'info') as any).name = name;
    return name;
  },

  /** Altera dados, layout, formatação individual, estilo ou metadados. `null` remove uma propriedade. */
  UPDATE: (e, op) => {
    const p = op.payload ?? {};
    const forbidden = ['id', 'type', 'parentId', 'children', 'order'].filter((k) => k in p);
    if (forbidden.length) fail('INVALID_PAYLOAD', `Use MOVE/REORDER para alterar ${forbidden.join(', ')}.`);
    return ids(op).map((id) => {
      e.assertEditable(id);
      const n = e.touchNode(id);
      if (p.data) n.data = merge(n.data, p.data);
      if (p.layout) n.layout = merge(n.layout, p.layout);
      if (p.styleOverrides) n.styleOverrides = merge(n.styleOverrides, p.styleOverrides);
      if (p.metadata) n.metadata = merge(n.metadata, p.metadata);
      if ('styleId' in p) {
        if (p.styleId && !e.doc.styles[p.styleId]) fail('NOT_FOUND', `Estilo ${p.styleId} não existe.`);
        n.styleId = p.styleId;
      }
      return clone(n);
    });
  },

  /**
   * MOVE com { x, y } ou { dx, dy }: move visualmente (posicionamento livre; grupo leva os filhos junto).
   * MOVE com { newParentId, newOrder? }: move na estrutura (outro bloco, seção, slide…).
   */
  MOVE: (e, op) => {
    const p = op.payload ?? {};
    return ids(op).map((id) => {
      e.assertEditable(id);
      const n = e.get(id);
      if (p.newParentId !== undefined) {
        if (p.newParentId === id || e.descendants(id).includes(p.newParentId)) fail('INVALID_PARENT', 'Um elemento não pode ir para dentro dele mesmo.');
        const target = e.get(p.newParentId);
        if (!canContain(target.type, n.type)) fail('INVALID_PARENT', `${n.type} não pode ficar dentro de ${target.type}.`);
        detach(e, id);
        const moved = e.touchNode(id);
        moved.layout.zIndex = undefined;
        attach(e, moved, p.newParentId, p.newOrder);
      }
      if (p.x !== undefined || p.y !== undefined || p.dx !== undefined || p.dy !== undefined) {
        if (!isAbsolute(n) && n.type !== 'GROUP') fail('INVALID_OPERATION', `${id} acompanha o fluxo do texto; para mudar de lugar, use newParentId/newOrder.`);
        const b = box(n);
        const dx = p.dx ?? (p.x !== undefined ? p.x - b.x : 0);
        const dy = p.dy ?? (p.y !== undefined ? p.y - b.y : 0);
        translate(e, id, dx, dy);
        refreshGroups(e, id);
      }
      return clone(e.get(id));
    });
  },

  DUPLICATE: (e, op) => {
    const created = ids(op).map((id) => duplicate(e, id, op.payload?.offset ?? 10).id);
    e.state.selection = { selectedIds: created, primaryId: created.at(-1) ?? null, mode: created.length > 1 ? 'MULTIPLE' : 'SINGLE' };
    return created;
  },

  DELETE: (e, op) => {
    const list = ids(op).filter((id, i, all) => !e.ancestors(id).some((a) => all.includes(a)));   // filho de quem já vai sair
    for (const id of list) {
      if (!e.get(id).parentId) fail('INVALID_OPERATION', 'A raiz do documento não pode ser excluída.');
      e.assertEditable(id);
      removeSubtree(e, id);
    }
    return list;
  },
};
