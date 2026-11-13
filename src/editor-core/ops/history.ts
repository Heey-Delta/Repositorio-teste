// Histórico (Camada 4): UNDO · REDO · REPEAT · CREATE_VERSION · RESTORE_VERSION · LIST_VERSIONS.
// O registro em si é feito pelo Engine (transações com antes/depois); aqui ficam só as operações da interface.
import type { Handler } from '../engine.ts';
import { clone, fail } from '../util.ts';

export const historyHandlers: Record<string, Handler> = {
  UNDO: (e) => { const t = e.undo(); return { id: t.id, type: t.type, label: t.label }; },
  REDO: (e) => { const t = e.redo(); return { id: t.id, type: t.type, label: t.label }; },

  /** Repete a última ação; se ela tinha alvos, aplica na seleção atual (ex.: a mesma formatação em outro objeto). */
  REPEAT: (e) => {
    const last = e.lastOperation ?? fail('INVALID_OPERATION', 'Nenhuma ação para repetir.');
    const op = clone(last!);
    const sel = e.state.selection.selectedIds;
    if (sel.length && (op.targetId || op.targetIds)) { delete op.targetId; op.targetIds = [...sel]; }
    return e.run(op);
  },

  CREATE_VERSION: (e, op) => { const s = e.snapshot(op.payload?.label); e.afterCommit(() => e.emit('version', { id: s.id, label: s.label, timestamp: s.timestamp })); return { id: s.id, label: s.label, timestamp: s.timestamp }; },
  RESTORE_VERSION: (e, op) => { e.restoreSnapshot(op.targetId ?? fail('INVALID_PAYLOAD', 'Informe a versão (targetId).')); return true; },
  LIST_VERSIONS: (e) => e.snapshots.map((s) => ({ id: s.id, label: s.label, timestamp: s.timestamp })),
  LIST_HISTORY: (e) => ({
    past: e.history.past.map((t) => ({ id: t.id, type: t.type, label: t.label, timestamp: t.timestamp, changes: t.changes.length })),
    future: e.history.future.map((t) => ({ id: t.id, type: t.type, label: t.label, timestamp: t.timestamp, changes: t.changes.length })),
  }),
};
