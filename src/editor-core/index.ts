// Ponto de entrada do motor: junta as operações de todos os módulos num único Engine.
//   import { createEngine, createDocument } from '../editor-core/index.ts';
//   const e = createEngine(createDocument('PRESENTATION_EDITOR'));
//   e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'SHAPE', parentId: e.state.activeSurface, data: { shapeType: 'CIRCLE' } } });
import type { DocumentModel } from './types.ts';
import type { EngineOptions, Handler } from './engine.ts';
import { Engine } from './engine.ts';
import { basicHandlers } from './ops/basic.ts';
import { historyHandlers } from './ops/history.ts';
import { selectionHandlers } from './ops/selection.ts';
import { organizeHandlers } from './ops/organize.ts';
import { formatHandlers } from './ops/format.ts';
import { layoutHandlers } from './ops/layout.ts';
import { textHandlers } from './ops/text.ts';
import { contentHandlers } from './ops/content.ts';
import { tableHandlers } from './ops/table.ts';
import { chartHandlers, watchCharts } from './charts/chart.ts';
import { pageHandlers } from './ops/page.ts';
import { referenceHandlers } from './ops/reference.ts';
import { conditionalHandlers } from './ops/conditional.ts';
import { templateHandlers } from './ops/template.ts';
import { diagramHandlers } from './ops/diagram.ts';
import { animationHandlers } from './ops/animation.ts';
import { reviewHandlers } from './ops/review.ts';
import { collabHandlers, installCollaboration } from './ops/collab.ts';
import { formulas } from './formula/service.ts';
import type { FunctionDef } from './formula/functions.ts';

export * from './types.ts';
export { Engine } from './engine.ts';
export { createDocument, DEFAULT_THEME } from './document.ts';
export { EditorError } from './util.ts';
export { documentFromTemplate, MemoryTemplateLibrary } from './ops/template.ts';
export type { Template, TemplateLibrary } from './ops/template.ts';
export { motionPath } from './ops/animation.ts';
export { review, documentStats, translateContent, contrastRatio, COMMON_MISSPELLINGS } from './ops/review.ts';
export type { Issue, SpellProvider, TranslateProvider } from './ops/review.ts';
export { SyncSession, roleOf } from './ops/collab.ts';
export type { RemoteTransaction, Role } from './ops/collab.ts';
export { merge3, mergeList } from './util.ts';
export { layoutDiagram, itemsFromOutline, outlineFromItems } from './ops/diagram.ts';

export const MODULES: Record<string, Record<string, Handler>> = {
  basic: basicHandlers,
  history: historyHandlers,
  selection: selectionHandlers,
  organize: organizeHandlers,
  format: formatHandlers,
  layout: layoutHandlers,
  text: textHandlers,
  content: contentHandlers,
  table: tableHandlers,
  chart: chartHandlers,
  page: pageHandlers,
  reference: referenceHandlers,
  conditional: conditionalHandlers,
  template: templateHandlers,
  diagram: diagramHandlers,
  animation: animationHandlers,
  review: reviewHandlers,
  collab: collabHandlers,
};

export function createEngine(doc: DocumentModel, options?: EngineOptions) {
  const handlers: Record<string, Handler> = {};
  for (const [mod, list] of Object.entries(MODULES)) {
    for (const [name, h] of Object.entries(list)) {
      if (handlers[name]) throw new Error(`Operação ${name} registrada duas vezes (${mod}).`);
      handlers[name] = h;
    }
  }
  const engine = new Engine(doc, handlers, options);
  watchCharts(engine);
  installCollaboration(engine);
  return engine;
}

/** Função personalizada para as fórmulas (código do próprio sistema, nunca vindo do documento). */
export function registerFunction(engine: Engine, def: FunctionDef) {
  formulas(engine).registry.register({ ...def, category: def.category ?? 'CUSTOM' });
}

export { chartData } from './charts/chart.ts';
export { resolveStyle } from './ops/format.ts';
export { formulas } from './formula/service.ts';
export { paginate, estimateMeasure } from './ops/page.ts';
export { fieldText, formatCitation, formatReference } from './ops/reference.ts';
