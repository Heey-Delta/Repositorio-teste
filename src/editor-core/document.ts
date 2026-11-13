// Documentos novos: mesma estrutura para as três aplicações; o que muda é a superfície inicial.
//   Documento:     SECTION → BLOCK (fluxo vertical; as páginas são calculadas pelo layout, não armazenadas)
//   Apresentação:  SECTION → SURFACE (SLIDE, posicionamento livre)
//   Planilha:      SECTION → SURFACE (SHEET, células esparsas)
import type { Application, DocumentModel, EditorNode, NodeType, Theme } from './types.ts';
import { ID_PREFIX } from './schema.ts';

export const DEFAULT_THEME: Theme = {
  id: 'THEME_001',
  name: 'Padrão',
  colors: { primary: '#2563EB', secondary: '#64748B', accent: '#FBBF00', background: '#FFFFFF', text: '#1E293B', border: '#CBD5E1' },
  fonts: { heading: 'Arial', body: 'Arial' },
  defaults: {
    '*': { opacity: 1 },
    TEXT: { fontFamily: 'theme:font.body', fontSize: 12, color: 'theme:text', lineHeight: 1.4, align: 'LEFT' },
    SHAPE: { fill: 'theme:primary', stroke: 'theme:border', strokeWidth: 1 },
    LINE: { stroke: 'theme:text', strokeWidth: 1 },
    TABLE: { fontFamily: 'theme:font.body', fontSize: 11, color: 'theme:text', stroke: 'theme:border', strokeWidth: 1 },
    CHART: { fontFamily: 'theme:font.body', fontSize: 11, color: 'theme:text', fill: 'theme:background' },
    SURFACE: { fill: 'theme:background' },
  },
};

export function emptyNode(id: string, type: NodeType, parentId: string | null, order = 0): EditorNode {
  return { id, type, parentId, children: [], order, data: {}, styleId: null, styleOverrides: {}, layout: {}, metadata: {} };
}

/** Novo identificador "PREFIXO_000001": sequencial dentro do documento. */
export function nextId(doc: DocumentModel, type: NodeType | string): string {
  doc.document.seq += 1;
  const prefix = (ID_PREFIX as Record<string, string>)[type] ?? type;
  return `${prefix}_${String(doc.document.seq).padStart(6, '0')}`;
}

export function createDocument(application: Application = 'DOCUMENT_EDITOR', name = 'Sem título', now = new Date()): DocumentModel {
  const iso = now.toISOString();
  const doc: DocumentModel = {
    document: {
      id: 'DOC_000001', type: 'DOCUMENT', name, application, rootId: '', themeId: DEFAULT_THEME.id,
      createdAt: iso, updatedAt: iso, seq: 1,
      settings: { grid: { enabled: false, size: 10, snap: true }, guides: [], names: {} },
    },
    nodes: {}, assets: {}, styles: {}, themes: { [DEFAULT_THEME.id]: structuredClone(DEFAULT_THEME) }, comments: {}, revisions: {},
  };
  const root = emptyNode(nextId(doc, 'SECTION'), 'SECTION', null);
  root.layout = { mode: 'FLOW', direction: 'VERTICAL' };
  doc.nodes[root.id] = root;
  doc.document.rootId = root.id;

  let first: EditorNode;
  if (application === 'DOCUMENT_EDITOR') {
    doc.document.settings.page = { width: 794, height: 1123, orientation: 'PORTRAIT', margins: { top: 96, right: 96, bottom: 96, left: 96 } };   // A4 a 96 dpi
    first = emptyNode(nextId(doc, 'BLOCK'), 'BLOCK', root.id);
    first.layout = { mode: 'FLOW', direction: 'VERTICAL', gap: 12 };
  } else if (application === 'PRESENTATION_EDITOR') {
    doc.document.settings.slide = { width: 1280, height: 720 };
    first = emptyNode(nextId(doc, 'SURFACE'), 'SURFACE', root.id);
    first.data = { surfaceType: 'SLIDE', title: 'Slide 1' };
    first.layout = { mode: 'ABSOLUTE', width: 1280, height: 720 };
  } else {
    first = emptyNode(nextId(doc, 'SURFACE'), 'SURFACE', root.id);
    first.data = { surfaceType: 'SHEET', name: 'Planilha1', cells: {}, rowHeights: {}, colWidths: {}, merges: [], filter: null };
    first.layout = { mode: 'GRID' };
  }
  doc.nodes[first.id] = first;
  root.children.push(first.id);
  return doc;
}
