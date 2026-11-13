// Referências entre nós (um elemento apontando para outro pelo ID):
//   LINE (conector)  data.start.targetId / data.end.targetId
//   CHART            data.source.targetId (planilha ou tabela de onde vêm os dados)
//   LINK interno     data.targetId
//   CAPTION / NOTE   data.targetId (elemento legendado / anotado)
//   FIELD            data.targetId (ex.: referência cruzada)
// Usado para: remapear IDs ao colar/duplicar (a cópia aponta para as cópias) e tratar exclusões.
import type { EditorNode } from './types.ts';

type Slot = { get: () => string | undefined; set: (v: string | undefined) => void };

export function referenceSlots(node: EditorNode): Slot[] {
  const d = node.data as any;
  const slots: Slot[] = [];
  const add = (obj: any, key: string) => { if (obj && typeof obj[key] === 'string') slots.push({ get: () => obj[key], set: (v) => { if (v === undefined) delete obj[key]; else obj[key] = v; } }); };
  if (node.type === 'LINE') { add(d.start, 'targetId'); add(d.end, 'targetId'); }
  if (node.type === 'CHART') add(d.source, 'targetId');
  if (['LINK', 'CAPTION', 'NOTE', 'FIELD'].includes(node.type)) add(d, 'targetId');
  return slots;
}

export const referencesOf = (node: EditorNode) => referenceSlots(node).map((s) => s.get()).filter((v): v is string => Boolean(v));

/** Troca os IDs referenciados conforme o mapa antigo → novo (só os que estão no mapa). */
export function remapReferences(node: EditorNode, map: Map<string, string>) {
  for (const s of referenceSlots(node)) { const v = s.get(); if (v && map.has(v)) s.set(map.get(v)); }
}
