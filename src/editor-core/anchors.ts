// Âncoras de comentários em trechos de texto: quando o texto muda, o trecho comentado acompanha.
import type { Engine } from './engine.ts';

/** Ajusta as âncoras do nó depois de inserir (delta > 0) ou apagar (delta < 0) a partir de `at`. */
export function shiftAnchors(e: Engine, nodeId: string, at: number, delta: number) {
  if (!delta) return;
  const move = (p: number, isStart: boolean) => {
    if (delta > 0) return isStart ? (p >= at ? p + delta : p) : p > at ? p + delta : p;   // texto colado na borda fica de fora
    const end = at - delta;
    return p <= at ? p : p >= end ? p + delta : at;
  };
  for (const t of Object.values(e.doc.comments ?? {})) {
    const a = t.anchor;
    if (a.targetId !== nodeId || a.start === undefined || a.end === undefined || a.cell) continue;
    const s = move(a.start, true), en = move(a.end, false);
    if (s === a.start && en === a.end) continue;
    const live = e.touch('comments', t.id).anchor;
    live.start = s; live.end = Math.max(s, en);
  }
}
