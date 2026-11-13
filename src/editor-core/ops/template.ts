// Modelos e layouts (F10.08–10).
//   Modelo (TEMPLATE): fotografia de um documento (tema, estilos, página, estrutura e conteúdo-base) guardada numa
//   biblioteca fora do documento — serve para criar documentos novos e para aplicar a identidade num documento
//   existente. A biblioteca padrão fica na memória; a persistência (Etapa 14) troca por uma no banco.
//   Layout: um slide/página/bloco salvo DENTRO do documento (como os layouts de slide), para criar novos iguais.
import type { DocumentModel, EditorNode } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { cloneSubtree, insertSubtree, subtreeOf } from './basic.ts';
import { clone, fail } from '../util.ts';

export interface Template {
  id: string;
  name: string;
  description: string;
  application: DocumentModel['document']['application'];
  createdAt: string;
  /** documento-base, sem histórico e sem seleção */
  document: DocumentModel;
}

export interface TemplateLibrary {
  list(): Template[];
  get(id: string): Template | undefined;
  save(t: Template): void;
  remove(id: string): boolean;
}

export class MemoryTemplateLibrary implements TemplateLibrary {
  private items = new Map<string, Template>();
  list() { return [...this.items.values()].map(clone); }
  get(id: string) { const t = this.items.get(id); return t ? clone(t) : undefined; }
  save(t: Template) { this.items.set(t.id, clone(t)); }
  remove(id: string) { return this.items.delete(id); }
}

/** Biblioteca de modelos do engine (a aplicação pode trocar por uma ligada ao banco). */
export const templateLibrary = (e: Engine): TemplateLibrary => (e.services.templates ??= new MemoryTemplateLibrary());

/** Documento novo a partir de um modelo (novo identificador, datas atuais). */
export function documentFromTemplate(t: Template, name = t.name, now = new Date()): DocumentModel {
  const doc = clone(t.document);
  const iso = now.toISOString();
  doc.document = { ...doc.document, id: `DOC_${now.getTime().toString(36).toUpperCase()}`, name, createdAt: iso, updatedAt: iso };
  return doc;
}

type Layout = { id: string; name: string; surfaceType: string | null; root: string; nodes: Record<string, EditorNode> };
const layouts = (e: Engine): Layout[] => (e.doc.document.settings.layouts as Layout[]) ?? [];

export const templateHandlers: Record<string, Handler> = {
  /** Salva o documento atual como modelo: CREATE_TEMPLATE { name, description?, keepContent? (padrão: true) }. */
  CREATE_TEMPLATE: (e, op) => {
    const name = String(op.payload?.name ?? '').trim();
    if (!name) fail('VALIDATION', 'Dê um nome ao modelo.');
    const doc = clone(e.doc);
    doc.comments = {}; doc.revisions = {};   // modelo não leva conversa nem revisões
    if (op.payload?.keepContent === false) {   // só identidade: tema, estilos, página e a estrutura vazia
      const root = doc.nodes[doc.document.rootId];
      const keep = new Set([root.id, ...root.children.filter((c) => ['BLOCK', 'SURFACE', 'REGION'].includes(doc.nodes[c].type))]);
      for (const id of Object.keys(doc.nodes)) if (!keep.has(id)) delete doc.nodes[id];
      for (const id of keep) doc.nodes[id].children = doc.nodes[id].children.filter((c) => keep.has(c));
      root.children = root.children.filter((c) => keep.has(c));
      for (const id of keep) if (doc.nodes[id].data.cells) doc.nodes[id].data.cells = {};
    }
    const t: Template = { id: `TPL_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`, name, description: String(op.payload?.description ?? ''), application: e.doc.document.application, createdAt: new Date().toISOString(), document: doc };
    templateLibrary(e).save(t);
    return t.id;
  },
  LIST_TEMPLATES: (e, op) => templateLibrary(e).list().filter((t) => !op.payload?.application || t.application === op.payload.application).map(({ document: _d, ...meta }) => meta),
  DELETE_TEMPLATE: (e, op) => { if (!templateLibrary(e).remove(op.targetId ?? '')) fail('NOT_FOUND', `Modelo ${op.targetId} não existe.`); return op.targetId; },

  /**
   * Aplica a identidade de um modelo no documento atual: tema, estilos, configuração de página/slide e layouts.
   * O conteúdo do documento não é tocado. Pode desfazer.
   */
  APPLY_TEMPLATE: (e, op) => {
    const t = templateLibrary(e).get(op.targetId ?? op.payload?.templateId) ?? fail('NOT_FOUND', 'Modelo não existe.');
    const src = t!.document;
    for (const [id, th] of Object.entries(src.themes)) e.put('themes', id, clone(th));
    for (const [id, st] of Object.entries(src.styles)) e.put('styles', id, clone(st));
    const info = e.touch('document', 'info') as any;
    info.themeId = src.document.themeId;
    for (const k of ['page', 'slide', 'layouts', 'citationStyle']) if (src.document.settings[k] !== undefined) info.settings[k] = clone(src.document.settings[k]);
    return { themeId: info.themeId, styles: Object.keys(src.styles).length };
  },

  /** Salva um slide (ou página/bloco) como layout reutilizável deste documento: SAVE_LAYOUT { name }. */
  SAVE_LAYOUT: (e, op) => {
    const n = e.get(op.targetId);
    if (!['SURFACE', 'BLOCK', 'SECTION', 'GROUP'].includes(n.type)) fail('INVALID_OPERATION', 'Layout é salvo a partir de um slide, página, bloco, seção ou grupo.');
    const name = String(op.payload?.name ?? '').trim();
    if (!name) fail('VALIDATION', 'Dê um nome ao layout.');
    if (layouts(e).some((l) => l.name.toLowerCase() === name.toLowerCase())) fail('VALIDATION', `Já existe o layout "${name}".`);
    const info = e.touch('document', 'info') as any;
    const id = e.newId('LAYOUT');
    info.settings.layouts = [...layouts(e), { id, name, surfaceType: n.data.surfaceType ?? null, root: n.id, nodes: clone(subtreeOf(e, n.id)) }];
    return id;
  },
  LIST_LAYOUTS: (e) => layouts(e).map(({ id, name, surfaceType }) => ({ id, name, surfaceType })),
  DELETE_LAYOUT: (e, op) => {
    const info = e.touch('document', 'info') as any;
    const before = layouts(e).length;
    info.settings.layouts = layouts(e).filter((l) => l.id !== op.targetId);
    if (info.settings.layouts.length === before) fail('NOT_FOUND', `Layout ${op.targetId} não existe.`);
    return op.targetId;
  },
  /** Cria um novo slide/página a partir de um layout: APPLY_LAYOUT { layoutId | name, parentId?, index? }. */
  APPLY_LAYOUT: (e, op) => {
    const p = op.payload ?? {};
    const l = layouts(e).find((x) => x.id === (p.layoutId ?? op.targetId) || x.name === p.name) ?? fail('NOT_FOUND', 'Layout não existe.');
    const root = l!.nodes[l!.root];
    const parentId = p.parentId ?? (root.parentId && e.find(root.parentId) ? root.parentId : e.doc.document.rootId);
    const sub = cloneSubtree(e, l!.nodes, l!.root);
    const placed = insertSubtree(e, sub, parentId, p.index);
    if (placed.type === 'SURFACE') e.state.activeSurface = placed.id;
    return placed.id;
  },
};
