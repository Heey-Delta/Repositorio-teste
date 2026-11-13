// Interação (Camada 3): SELECT · DESELECT · SELECT_ALL · SELECT_AREA · CLEAR_SELECTION · COPY · CUT · PASTE · PASTE_TEXT.
// Seleção e área de transferência ficam no EDITOR_STATE (não mudam o documento, não vão para o histórico).
// Regras: COPY guarda uma cópia (não cria nada); DUPLICATE cria na hora; PASTE cria com IDs novos e relações
// internas remapeadas; arquivos (assets) não são duplicados, a cópia aponta para o mesmo assetId.
import type { EditorNode, Operation } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { attach as attachNode, box, cloneSubtree, createNode, detach as detachNode, insertSubtree, removeSubtree, subtreeOf, translate } from './basic.ts';
import { canContain } from '../schema.ts';
import { remapReferences } from '../refs.ts';
import { clone, fail } from '../util.ts';

function setSelection(e: Engine, ids: string[], primary?: string | null) {
  const uniq = [...new Set(ids)];
  e.state.selection = {
    selectedIds: uniq,
    primaryId: primary ?? uniq.at(-1) ?? null,
    mode: uniq.length === 0 ? 'NONE' : uniq.length === 1 ? 'SINGLE' : 'MULTIPLE',
  };
  e.emit('selection', clone(e.state.selection));
  return clone(e.state.selection);
}

/** Clicar num objeto dentro de um grupo seleciona o grupo inteiro, a não ser no modo "deep" (duplo clique). */
function selectable(e: Engine, id: string, deep: boolean) {
  if (deep) return id;
  let pick = id;
  for (const a of e.ancestors(id)) { if (e.get(a).type === 'GROUP') pick = a; else break; }
  return pick;
}

/** Alvos de uma operação: os informados ou, na falta, a seleção atual. */
export function targetsOf(e: Engine, op: Operation): string[] {
  const list = op.targetIds?.length ? op.targetIds : op.targetId ? [op.targetId] : e.state.selection.selectedIds;
  if (!list.length) fail('INVALID_PAYLOAD', 'Nada selecionado.');
  list.forEach((id) => e.get(id));
  return list.filter((id, _, all) => !e.ancestors(id).some((a) => all.includes(a)));   // pai e filho juntos: fica o pai
}

/** Contexto para "selecionar tudo"/"colar": o informado, o pai do objeto principal ou a superfície ativa. */
function contextParent(e: Engine, explicit?: string) {
  if (explicit) return explicit;
  const primary = e.find(e.state.selection.primaryId);
  if (primary?.parentId) return primary.parentId;
  return e.state.activeSurface ?? e.doc.document.rootId;
}

function copyItems(e: Engine, ids: string[]) {
  return ids.map((id) => ({ rootId: id, nodes: clone(subtreeOf(e, id)) as Record<string, EditorNode> }));
}

export const selectionHandlers: Record<string, Handler> = {
  SELECT: (e, op) => {
    const id = selectable(e, e.get(op.targetId).id, Boolean(op.payload?.deep));
    const current = e.state.selection.selectedIds;
    if (!op.payload?.additive) return setSelection(e, [id], id);
    if (current.includes(id) && op.payload?.toggle) return setSelection(e, current.filter((x) => x !== id));
    return setSelection(e, [...current, id], id);
  },

  DESELECT: (e, op) => {
    const s = e.state.selection;
    const remaining = s.selectedIds.filter((x) => x !== op.targetId);
    return setSelection(e, remaining, s.primaryId === op.targetId ? remaining.at(-1) : s.primaryId);
  },

  CLEAR_SELECTION: (e) => setSelection(e, []),

  /** Seleciona tudo no contexto atual (bloco, slide…), sem entrar nos grupos. */
  SELECT_ALL: (e, op) => {
    const parent = e.get(contextParent(e, op.payload?.parentId));
    return setSelection(e, parent.children.filter((id) => e.doc.nodes[id]?.metadata.visible !== false), parent.children[0] ?? null);
  },

  /** Seleção por área (arrastar o mouse): objetos posicionados inteiramente dentro do retângulo. */
  SELECT_AREA: (e, op) => {
    const { x, y, width, height, parentId, additive, touch } = op.payload ?? {};
    const parent = e.get(contextParent(e, parentId));
    const hit = parent.children.filter((id) => {
      const n = e.doc.nodes[id];
      if (n.layout.mode !== 'ABSOLUTE' && n.type !== 'GROUP') return false;
      const b = box(n);
      return touch
        ? b.x < x + width && b.x + b.width > x && b.y < y + height && b.y + b.height > y
        : b.x >= x && b.y >= y && b.x + b.width <= x + width && b.y + b.height <= y + height;
    });
    return setSelection(e, additive ? [...e.state.selection.selectedIds, ...hit] : hit);
  },

  COPY: (e, op) => {
    const ids = targetsOf(e, op);
    e.state.clipboard = { operation: 'COPY', sourceParentId: e.get(ids[0]).parentId, items: copyItems(e, ids) };
    e.emit('clipboard', { operation: 'COPY', count: ids.length });
    return ids.length;
  },

  /** Recorta: a cópia completa fica na área de transferência e os originais saem (dá para desfazer). */
  CUT: (e, op) => {
    const ids = targetsOf(e, op);
    ids.forEach((id) => e.assertEditable(id));
    e.state.clipboard = { operation: 'CUT', sourceParentId: e.get(ids[0]).parentId, items: copyItems(e, ids) };
    for (const id of ids) removeSubtree(e, id);
    setSelection(e, []);
    e.emit('clipboard', { operation: 'CUT', count: ids.length });
    return ids.length;
  },

  /**
   * PASTE { parentId?, index?, mode? }. mode: 'ALL' (padrão), 'TEXT_ONLY' (só o texto, sem formatação),
   * 'FORMAT_ONLY' (aplica a formatação do primeiro item copiado na seleção atual — "colar formatação").
   */
  PASTE: (e, op) => {
    const cb = e.state.clipboard;
    // cópia de células (planilha/tabela): colar normal, só valores, fórmulas, formatação, transposto ou vínculo
    if (cb?.cells) return e.run({ type: 'PASTE_CELLS', targetId: op.targetId ?? op.payload?.targetId, payload: op.payload });
    if (!cb?.items.length) fail('EMPTY_CLIPBOARD', 'A área de transferência está vazia.');
    const mode = op.payload?.mode ?? 'ALL';
    if (mode === 'VALUES' || op.payload?.transpose) fail('INVALID_OPERATION', 'Colar só valores ou transposto vale para células de planilha ou tabela.');
    if (mode === 'LINK') {
      // colar como vínculo: um link para cada original (que precisa continuar existindo)
      const parentId = contextParent(e, op.payload?.parentId);
      const created = cb!.items.map((item) => {
        const src = e.find(item.rootId) ?? fail('NOT_FOUND', 'O original não existe mais; não dá para colar como vínculo.');
        const label = Array.isArray(src!.data.runs) ? src!.data.runs.map((r: any) => r.text).join('') : `${src!.type} ${src!.id}`;
        return createNode(e, { parentId, nodeType: 'LINK', data: { url: null, targetId: src!.id, title: label, runs: [{ id: e.newId('RUN'), text: label, format: {} }] }, layout: e.get(parentId).layout.mode === 'ABSOLUTE' ? { mode: 'ABSOLUTE', x: 40, y: 40, width: 240, height: 30 } : { mode: 'FLOW' }, index: op.payload?.index }).id;
      });
      setSelection(e, created);
      return created;
    }
    if (mode === 'FORMAT_ONLY') {
      const src = cb!.items[0].nodes[cb!.items[0].rootId];
      return targetsOf(e, op).map((id) => {
        e.assertEditable(id);
        const t = e.touchNode(id);
        t.styleId = src.styleId;
        t.styleOverrides = clone(src.styleOverrides);
        return id;
      });
    }
    const parentId = contextParent(e, op.payload?.parentId);
    const created: string[] = [];
    let index: number | undefined = op.payload?.index;
    // clona tudo antes de inserir: um conector copiado junto com as formas passa a ligar as cópias
    const subs = mode === 'TEXT_ONLY' ? [] : cb!.items.map((item) => {
      const root = item.nodes[item.rootId];
      if (!canContain(e.get(parentId).type, root.type)) fail('INVALID_PARENT', `${root.type} não pode ser colado dentro de ${e.get(parentId).type}.`);
      return cloneSubtree(e, item.nodes, item.rootId);
    });
    const all = new Map(subs.flatMap((s) => [...s.map]));
    for (const s of subs) for (const n of s.nodes) remapReferences(n, all);
    for (const [i, item] of cb!.items.entries()) {
      if (mode === 'TEXT_ONLY') {
        const text = Object.values(item.nodes).filter((n) => n.type === 'TEXT').map((n) => (n.data.runs ?? []).map((r: any) => r.text).join('')).join('\n');
        if (!text) continue;
        created.push(createNode(e, { parentId, nodeType: 'TEXT', data: { textType: 'PARAGRAPH', runs: [{ id: e.newId('RUN'), text, format: {} }] }, index }).id);
      } else {
        const placed = insertSubtree(e, subs[i], parentId, index);
        // colando no mesmo lugar de onde copiou: desloca um pouco para não ficar exatamente por cima
        if (placed.layout.mode === 'ABSOLUTE' && cb!.operation === 'COPY' && parentId === cb!.sourceParentId) translate(e, placed.id, 10, 10);
        created.push(placed.id);
      }
      if (index !== undefined) index++;
    }
    if (cb!.operation === 'CUT') e.state.clipboard = null;   // recorte só se conclui depois de colar com sucesso
    setSelection(e, created);
    return created;
  },

  /**
   * Arrastar e soltar: DROP { destinationId, index?, x?, y?, copy?, files? }.
   * - Elementos (targetIds ou seleção): mudam de contêiner (e de ordem) e/ou de posição; com copy: true, solta uma cópia.
   *   Vários objetos mantêm a distância entre eles: o primeiro vai para (x, y) e os outros acompanham.
   * - Arquivos (files): entram na biblioteca do documento e viram imagem, vídeo ou áudio no ponto onde foram soltos.
   */
  DROP: (e, op) => {
    const p = op.payload ?? {};
    const dest = e.get(p.destinationId ?? fail('INVALID_PAYLOAD', 'Informe destinationId (onde soltar).'));
    e.assertEditable(dest.id);
    const spatial = dest.layout.mode === 'ABSOLUTE' || dest.type === 'GROUP';
    if (Array.isArray(p.files) && p.files.length) {
      const kinds: Record<string, string> = { image: 'IMAGE', video: 'VIDEO', audio: 'AUDIO' };
      const created = p.files.map((f: any, i: number) => {
        const kind = kinds[String(f.mimeType ?? '').split('/')[0]];
        if (!kind) fail('VALIDATION', `Não dá para soltar "${f.name}" aqui: use imagem, vídeo ou áudio.`);
        const assetId = e.run({ type: 'IMPORT_ASSET', payload: { ...f, type: kind } });
        const layout = spatial ? { x: (p.x ?? 40) + i * 20, y: (p.y ?? 40) + i * 20 } : undefined;
        return e.run({ type: 'INSERT_CONTENT', payload: { contentType: kind, parentId: dest.id, index: p.index, layout, data: kind === 'IMAGE' ? { assetId, alt: f.alt ?? '' } : { assetId } } }).id;
      });
      setSelection(e, created);
      return created;
    }
    const ids = targetsOf(e, op);
    const first = box(e.get(ids[0]));
    let index: number | undefined = p.index;
    const result = ids.map((id) => {
      e.assertEditable(id);
      let nid = id;
      const before = box(e.get(id));
      if (p.copy) {
        const sub = cloneSubtree(e, subtreeOf(e, id), id);
        nid = insertSubtree(e, sub, dest.id, index).id;
      } else if (e.get(id).parentId !== dest.id || index !== undefined) {
        if (id === dest.id || e.descendants(id).includes(dest.id)) fail('INVALID_PARENT', 'Não dá para soltar um elemento dentro dele mesmo.');
        if (!canContain(dest.type, e.get(id).type)) fail('INVALID_PARENT', `${e.get(id).type} não pode ficar dentro de ${dest.type}.`);
        detachNode(e, id);
        const moved = e.touchNode(id);
        moved.layout.zIndex = undefined;
        attachNode(e, moved, dest.id, index);
      }
      const n = e.get(nid);
      if (spatial && p.x !== undefined && p.y !== undefined) {
        if (n.layout.mode !== 'ABSOLUTE' && n.type !== 'GROUP') {
          const t = e.touchNode(nid);
          t.layout = { ...t.layout, mode: 'ABSOLUTE', width: typeof t.layout.width === 'number' ? t.layout.width : 400, height: typeof t.layout.height === 'number' ? t.layout.height : 60 };
        }
        const cur = box(e.get(nid));
        translate(e, nid, p.x + (before.x - first.x) - cur.x, p.y + (before.y - first.y) - cur.y);
      } else if (!spatial && e.get(nid).layout.mode === 'ABSOLUTE') {
        const t = e.touchNode(nid);   // entrou num fluxo de texto: passa a acompanhar o fluxo
        t.layout = { mode: 'FLOW', width: t.layout.width, height: t.layout.height };
      }
      if (index !== undefined) index++;
      return nid;
    });
    setSelection(e, result);
    return result;
  },

  /** Cola texto puro vindo de fora do editor: cada linha vira um parágrafo. */
  PASTE_TEXT: (e, op) => {
    const parentId = contextParent(e, op.payload?.parentId);
    const lines = String(op.payload?.text ?? '').replace(/\r\n?/g, '\n').split('\n');
    let index: number | undefined = op.payload?.index;
    const created = lines.map((line) => {
      const n = createNode(e, { parentId, nodeType: 'TEXT', data: { textType: 'PARAGRAPH', runs: [{ id: e.newId('RUN'), text: line, format: {} }] }, index });
      if (index !== undefined) index++;
      return n.id;
    });
    setSelection(e, created);
    return created;
  },
};

export { setSelection };
