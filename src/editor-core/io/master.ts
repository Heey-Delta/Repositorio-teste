// Slide mestre: o que aparece por baixo de todos os slides (elementos fixos e rodapé com texto, número e data).
import type { DocumentModel, EditorNode } from '../types.ts';

export const masterOf = (doc: DocumentModel) => Object.values(doc.nodes).find((n) => n.type === 'SURFACE' && n.data.surfaceType === 'MASTER') ?? null;

/** Itens do rodapé do mestre (texto, número do slide, data) para um slide, na ordem da apresentação. */
export function footerItems(doc: DocumentModel, s: EditorNode, index: number, date = new Date()) {
  const f = masterOf(doc)?.data.footer;
  if (!f || s.data.hideMaster || (f.hideOnTitleSlide && index === 0)) return [];
  const size = doc.document.settings.slide ?? { width: 1280, height: 720 };
  const y = size.height - 48, out: { text: string; x: number; width: number; align: 'LEFT' | 'CENTER' | 'RIGHT' }[] = [];
  if (f.date) out.push({ text: f.dateText ?? date.toLocaleDateString('pt-BR'), x: 48, width: 280, align: 'LEFT' });
  if (f.text) out.push({ text: String(f.text), x: size.width / 2 - 300, width: 600, align: 'CENTER' });
  if (f.slideNumber) out.push({ text: String(index + 1 + (f.startAt ? f.startAt - 1 : 0)), x: size.width - 168, width: 120, align: 'RIGHT' });
  return out.map((o) => ({ ...o, y, height: 28 }));
}


/** Todos os slides na ordem da apresentação (para numerar mesmo quando se exporta um só). */
export function slideOrder(doc: DocumentModel) {
  const out: EditorNode[] = [];
  const walk = (id: string) => { const n = doc.nodes[id]; if (!n) return; if (n.type === 'SURFACE' && n.data.surfaceType === 'SLIDE') out.push(n); n.children.forEach(walk); };
  walk(doc.document.rootId);
  return out;
}
