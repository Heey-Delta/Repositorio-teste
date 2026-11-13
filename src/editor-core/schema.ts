// Regras estruturais: prefixo dos identificadores e quem pode ficar dentro de quem (integridade da árvore).
import type { NodeType } from './types.ts';
import { CONTENT_TYPES } from './types.ts';

export const ID_PREFIX: Record<NodeType, string> = {
  SECTION: 'SEC', BLOCK: 'BLK', GROUP: 'GRP', SURFACE: 'SRF', REGION: 'RGN', LIST: 'LIST', LIST_ITEM: 'ITEM', BREAK: 'BRK',
  TEXT: 'TXT', IMAGE: 'IMG', SHAPE: 'SHP', LINE: 'LIN', TABLE: 'TBL', CHART: 'CHT', DIAGRAM: 'DGM', LINK: 'LNK',
  SYMBOL: 'SYM', EQUATION: 'EQN', AUDIO: 'AUD', VIDEO: 'VID', FIELD: 'FLD', NOTE: 'NOTE', CAPTION: 'CAP', CITATION: 'CIT',
};

const CONTENT = [...CONTENT_TYPES] as NodeType[];

/** Filhos permitidos por tipo. Tipos de conteúdo não têm filhos (o que é interno fica em `data`). */
export const ALLOWED_CHILDREN: Partial<Record<NodeType, NodeType[]>> = {
  SECTION: ['SECTION', 'BLOCK', 'SURFACE', 'REGION', 'BREAK', 'LIST', ...CONTENT],
  SURFACE: ['BLOCK', 'REGION', 'GROUP', 'LIST', ...CONTENT],
  REGION: ['BLOCK', 'GROUP', 'LIST', 'BREAK', ...CONTENT],
  BLOCK: ['BLOCK', 'GROUP', 'LIST', 'BREAK', ...CONTENT],
  GROUP: ['GROUP', ...CONTENT],
  LIST: ['LIST_ITEM'],
  LIST_ITEM: ['LIST', 'TEXT', 'LINK', 'SYMBOL', 'EQUATION', 'FIELD', 'IMAGE'],
};

export const canContain = (parent: NodeType, child: NodeType) => (ALLOWED_CHILDREN[parent] ?? []).includes(child);
export const isContainer = (type: NodeType) => Boolean(ALLOWED_CHILDREN[type]);
