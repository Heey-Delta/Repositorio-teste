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
  | 'UNKNOWN_OPERATION' | 'INTEGRITY' | 'VALIDATION' | 'EMPTY_CLIPBOARD' | 'NOTHING_TO_UNDO' | 'NOTHING_TO_REDO' | 'PERMISSION_DENIED';

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

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Lista de IDs (ex.: children): junta inserções e remoções dos dois lados, na ordem de "theirs". */
export function mergeList(base: string[], ours: string[], theirs: string[]): string[] {
  const b = new Set(base), o = new Set(ours), t = new Set(theirs);
  const res = theirs.filter((x) => !(b.has(x) && !o.has(x)));   // tira o que "ours" removeu
  ours.forEach((x, i) => {
    if (b.has(x) || t.has(x) || res.includes(x)) return;        // só o que "ours" inseriu
    let at = 0;
    for (let k = i - 1; k >= 0; k--) { const j = res.indexOf(ours[k]); if (j >= 0) { at = j + 1; break; } }
    res.splice(at, 0, x);
  });
  return res;
}

/**
 * Mescla em três vias: o que só um lado mudou é mantido; quando os dois mudaram o mesmo campo de jeitos
 * diferentes, vence "theirs" e o caminho entra em `conflicts`. Objetos são mesclados campo a campo;
 * listas de IDs, item a item; outras listas, inteiras.
 */
export function merge3(base: unknown, ours: unknown, theirs: unknown, path = '', conflicts: string[] = []): { value: unknown; conflicts: string[] } {
  if (equal(ours, theirs)) return { value: clone(theirs), conflicts };
  if (equal(base, ours)) return { value: clone(theirs), conflicts };
  if (equal(base, theirs)) return { value: clone(ours), conflicts };
  if (isPlain(base) && isPlain(ours) && isPlain(theirs)) {
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
      const v = merge3(base[k], ours[k], theirs[k], path ? `${path}.${k}` : k, conflicts).value;
      if (v !== undefined) out[k] = v;
    }
    return { value: out, conflicts };
  }
  if (isIdList(base) && isIdList(ours) && isIdList(theirs)) return { value: mergeList(base, ours, theirs), conflicts };
  conflicts.push(path || '(raiz)');
  return { value: clone(theirs), conflicts };
}
