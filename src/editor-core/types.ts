// Motor do editor unificado (documentos, apresentações e planilhas): estruturas de dados.
// Registro Mestre 1.0 (docs/editor/ARQUITETURA.md): DOCUMENT · NODES · ASSETS · STYLES · EDITOR_STATE · HISTORY.
// Regra 1 (universalidade): todo conteúdo é um nó da coleção NODES. Regra 2 (especialização): o que é específico
// (células, fórmulas, séries) fica em `data`. Regra 3 (não duplicação): negrito, mover, copiar etc. são propriedades
// ou operações, nunca novas estruturas.

/** Aplicação que abriu o documento: muda a superfície inicial e as ferramentas, não o formato dos dados. */
export type Application = 'DOCUMENT_EDITOR' | 'PRESENTATION_EDITOR' | 'SPREADSHEET_EDITOR';

/** Tipos estruturais: organizam o documento. */
export const STRUCTURAL_TYPES = ['SECTION', 'BLOCK', 'GROUP', 'SURFACE', 'REGION', 'LIST', 'LIST_ITEM', 'BREAK'] as const;
/** Tipos de conteúdo: o que a pessoa insere. */
export const CONTENT_TYPES = [
  'TEXT', 'IMAGE', 'SHAPE', 'LINE', 'TABLE', 'CHART', 'DIAGRAM', 'LINK', 'SYMBOL', 'EQUATION',
  'AUDIO', 'VIDEO', 'FIELD', 'NOTE', 'CAPTION', 'CITATION',
] as const;
export type StructuralType = (typeof STRUCTURAL_TYPES)[number];
export type ContentType = (typeof CONTENT_TYPES)[number];
export type NodeType = StructuralType | ContentType;

export type LayoutMode = 'FLOW' | 'ABSOLUTE' | 'GRID';

/** Onde o nó está e quanto espaço ocupa. Fluxo (documentos) não usa x/y; espacial (slides) usa. */
export interface Layout {
  mode?: LayoutMode;
  x?: number; y?: number;
  width?: number | 'AUTO'; height?: number | 'AUTO';
  rotation?: number; scaleX?: number; scaleY?: number;
  flipH?: boolean; flipV?: boolean;
  /** ordem visual dentro do mesmo contexto de empilhamento (irmãos); não muda a hierarquia */
  zIndex?: number;
  lockAspectRatio?: boolean;
  constraints?: Constraints;
  // contêineres
  direction?: 'VERTICAL' | 'HORIZONTAL';
  gap?: number; padding?: number;
  alignment?: 'START' | 'CENTER' | 'END' | 'STRETCH';
  distribution?: 'START' | 'CENTER' | 'END' | 'SPACE_BETWEEN';
  columns?: number;
  // fluxo
  marginTop?: number; marginBottom?: number;
}

export interface Constraints {
  minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number;
  anchor?: { left?: number; top?: number; right?: number; bottom?: number; centerX?: boolean; centerY?: boolean };
}

export interface NodeMetadata {
  locked?: boolean;
  visible?: boolean;
  name?: string;
  [key: string]: unknown;
}

/** Nó universal (NODES). `data` guarda o que é específico do tipo. */
export interface EditorNode<D = Record<string, any>> {
  id: string;
  type: NodeType;
  parentId: string | null;
  children: string[];
  order: number;
  data: D;
  styleId: string | null;
  styleOverrides: Record<string, unknown>;
  layout: Layout;
  metadata: NodeMetadata;
}

export interface Asset {
  id: string;
  type: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE';
  name: string;
  source: string;
  mimeType: string;
  size: number;
  width?: number; height?: number;
}

export interface Style {
  id: string;
  name: string;
  /** tipo de nó a que se aplica; null = qualquer um */
  type: NodeType | null;
  properties: Record<string, unknown>;
}

export interface Theme {
  id: string;
  name: string;
  colors: Record<string, string>;
  fonts: { heading: string; body: string; [k: string]: string };
  /** valores padrão por tipo de nó (o primeiro nível da aparência final) */
  defaults: Partial<Record<NodeType | '*', Record<string, unknown>>>;
}

export interface Guide { id: string; orientation: 'VERTICAL' | 'HORIZONTAL'; position: number }

export interface DocumentSettings {
  grid: { enabled: boolean; size: number; snap: boolean };
  guides: Guide[];
  /** intervalos nomeados das planilhas: NOME -> "Planilha1!A1:B10" */
  names: Record<string, string>;
  page?: { width: number; height: number; orientation: 'PORTRAIT' | 'LANDSCAPE'; margins: { top: number; right: number; bottom: number; left: number } };
  slide?: { width: number; height: number };
  [key: string]: unknown;
}

export interface DocumentInfo {
  id: string;
  type: 'DOCUMENT';
  name: string;
  application: Application;
  rootId: string;
  themeId: string | null;
  createdAt: string;
  updatedAt: string;
  /** contador dos identificadores gerados (não entra no histórico) */
  seq: number;
  settings: DocumentSettings;
}

/** O que é salvo: o documento permanente. */
export interface DocumentModel {
  document: DocumentInfo;
  nodes: Record<string, EditorNode>;
  assets: Record<string, Asset>;
  styles: Record<string, Style>;
  themes: Record<string, Theme>;
}

/** Estado temporário da interface: não é salvo junto com o documento. */
export interface EditorState {
  selection: { selectedIds: string[]; primaryId: string | null; mode: 'NONE' | 'SINGLE' | 'MULTIPLE' };
  clipboard: Clipboard | null;
  activeSurface: string | null;
  mode: 'EDIT' | 'READ' | 'PRESENT';
  zoom: number;
  activeTool: string;
}

export interface ClipboardItem {
  rootId: string;
  /** a subárvore inteira (o nó copiado e todos os descendentes), já clonada */
  nodes: Record<string, EditorNode>;
}

/** Cópia de um intervalo de células (planilha ou tabela): valores, fórmulas e formatação, linha × coluna. */
export interface CellClipboard {
  sourceId: string;
  origin: { row: number; col: number };
  matrix: { value: unknown; formula: string | null; display: unknown; styleOverrides?: Record<string, unknown> }[][];
}

export interface Clipboard {
  operation: 'COPY' | 'CUT';
  sourceParentId: string | null;
  items: ClipboardItem[];
  cells?: CellClipboard;
}

/** Operação universal: tudo o que muda (ou consulta) o documento passa por aqui. */
export interface Operation {
  type: string;
  targetId?: string | null;
  targetIds?: string[];
  payload?: Record<string, any>;
}

/** Uma mudança registrada no histórico: estado anterior e posterior de um item de uma coleção. */
export interface Change {
  collection: 'nodes' | 'styles' | 'themes' | 'assets' | 'document';
  id: string;
  before: unknown;
  after: unknown;
}

/** Transação: o que a pessoa entende como UMA ação (desfaz e refaz de uma vez). */
export interface Transaction {
  id: string;
  type: string;
  label: string;
  changes: Change[];
  timestamp: number;
}

export interface HistoryState {
  past: Transaction[];
  future: Transaction[];
  limit: number;
}
