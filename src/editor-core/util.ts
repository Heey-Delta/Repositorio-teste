// Utilitários do motor: cópia profunda, comparação e erros padronizados.

export const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => equal((a as any)[k], (b as any)[k]));
}

/** Junta propriedades: `undefined` mantém o valor atual, `null` remove a propriedade. */
export function merge<T extends Record<string, any>>(base: T, patch: Record<string, any>): T {
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out as T;
}

export type ErrorCode =
  | 'NOT_FOUND' | 'INVALID_OPERATION' | 'INVALID_PAYLOAD' | 'INVALID_PARENT' | 'LOCKED'
  | 'UNKNOWN_OPERATION' | 'INTEGRITY' | 'VALIDATION' | 'EMPTY_CLIPBOARD' | 'NOTHING_TO_UNDO' | 'NOTHING_TO_REDO';

/** Erro do motor: código estável (para a interface decidir o que mostrar) e mensagem em português. */
export class EditorError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'EditorError';
  }
}

export const fail = (code: ErrorCode, message: string): never => { throw new EditorError(code, message); };
