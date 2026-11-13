// Automação e extensibilidade (F17). Nada aqui executa código vindo do documento: tudo é declarativo
// (operações do próprio motor, variáveis, repetição e condições), então um arquivo recebido não roda nada perigoso.
//
//   Funções do usuário   DEFINE_FUNCTION { name, params, body } → IMPOSTO(x) = x*0,15 vira função das fórmulas
//   Macros               START_RECORDING → (ações) → STOP_RECORDING → RUN_MACRO
//   Scripts              RUN_SCRIPT { steps } — op, set, repeat, forEach, if, macro; com {{variáveis}}
//   Automações           "quando <evento> e <condição>, faça <passos>" — rodam na MESMA transação de quem as
//                        disparou (um desfazer leva tudo) e passam pela checagem de permissão
//   Atalhos              SET_SHORTCUT { keys, operation | macro | command } (preferência da sessão)
//   Extensões            INSTALL_EXTENSION { manifest } — funções, macros, operações compostas, atalhos e
//                        automações; installCodeExtension() para extensões do próprio sistema (código confiável)
//   Serviços externos    ADD_WEBHOOK (avisa por HTTPS a cada evento) · CALL_SERVICE (consulta e usa a resposta)
import type { Change, EditorNode, Operation } from '../types.ts';
import type { CommitHook, Engine, Handler } from '../engine.ts';
import { formulas, isSheet } from '../formula/service.ts';
import { collectRefs, parse, parseRange, parseAddress, type Ast } from '../formula/parse.ts';
import { evaluate, type EvalContext } from '../formula/evaluate.ts';
import { err, normalizeName, type FunctionDef } from '../formula/functions.ts';
import { clone, equal, fail } from '../util.ts';

// ---------------------------------------------------------------- funções do usuário

export interface UserFunction { name: string; params: string[]; body: string; description?: string }
const IDENT = /^[\p{L}_][\p{L}\p{N}_.]*$/u;
const settings = (e: Engine) => e.doc.document.settings;
const info = (e: Engine) => e.touch('document', 'info') as any;

function compileFunction(e: Engine, def: UserFunction): FunctionDef {
  const ast = parse(def.body.replace(/^=/, ''));
  const params = def.params.map(normalizeName);
  let depth = 0;
  return {
    name: def.name, category: 'CUSTOM', min: params.length, max: params.length, description: def.description ?? `${def.name}(${def.params.join('; ')}) = ${def.body.replace(/^=/, '')}`,
    fn: (args, fctx) => {
      if (depth > 32) return err('#NUM!');   // recursão sem fim
      depth++;
      try {
        const bind = new Map(params.map((p, i) => [p, args[i]]));
        const ctx: EvalContext = {
          getCell: () => err('#REF!'), getRange: () => [[err('#REF!')]],
          getName: (n) => (bind.has(normalizeName(n)) ? ({ k: 'val', v: bind.get(normalizeName(n)) } as Ast) : null),
          functions: formulas(e).registry, now: fctx.now,
        };
        return evaluate(ast, ctx);
      } finally { depth--; }
    },
  };
}

function validateFunction(e: Engine, def: UserFunction, mine: Set<string>) {
  if (!IDENT.test(def.name ?? '')) fail('VALIDATION', 'Nome da função: letras, números, "_" ou "." (sem espaços).');
  const builtin = formulas(e).registry.get(def.name);
  if (builtin && !mine.has(normalizeName(def.name))) fail('VALIDATION', `${def.name} já é uma função do sistema.`);
  if (!Array.isArray(def.params) || def.params.length > 30) fail('VALIDATION', 'params: lista de até 30 nomes.');
  const seen = new Set<string>();
  for (const p of def.params) {
    if (!IDENT.test(p) || /^[A-Z]{1,3}\d+$/i.test(p)) fail('VALIDATION', `Parâmetro inválido: ${p} (não pode parecer endereço de célula).`);
    if (seen.has(normalizeName(p))) fail('VALIDATION', `Parâmetro repetido: ${p}.`);
    seen.add(normalizeName(p));
  }
  let ast: Ast;
  try { ast = parse(String(def.body ?? '').replace(/^=/, '')); } catch (x) { return fail('VALIDATION', `Fórmula inválida: ${(x as Error).message}`); }
  for (const r of collectRefs(ast)) {
    if (r.k !== 'name') fail('VALIDATION', 'A função só usa os próprios parâmetros (sem referências a células).');
    else if (!seen.has(normalizeName(r.name))) fail('VALIDATION', `"${r.name}" não é parâmetro da função.`);
  }
}

/** Todas as funções do usuário + das extensões ativas. */
const userFunctions = (e: Engine): UserFunction[] => [
  ...((settings(e).functions as UserFunction[]) ?? []),
  ...extensions(e).filter((x) => x.enabled).flatMap((x) => x.manifest.functions ?? []),
];

/** Deixa o registro de funções igual ao documento (vale depois de desfazer, abrir, ativar extensão…). */
export function syncFunctions(e: Engine) {
  const reg = formulas(e).registry;
  const prev: Set<string> = e.services.userFunctionNames ?? new Set();
  const next = userFunctions(e);
  const sig = JSON.stringify(next);
  if (sig === e.services.userFunctionSig) return false;
  for (const n of prev) reg.unregister(n);
  const names = new Set<string>();
  for (const f of next) { try { reg.register(compileFunction(e, f)); names.add(normalizeName(f.name)); } catch { /* fórmula inválida num arquivo antigo: ignora */ } }
  e.services.userFunctionNames = names;
  e.services.userFunctionSig = sig;
  return true;
}

// ---------------------------------------------------------------- scripts

export type Step =
  | { op: Operation; saveAs?: string }
  | { set: string; value: unknown }
  | { repeat: number | string; as?: string; steps: Step[] }
  | { forEach: unknown; as: string; steps: Step[] }
  | { if: Cond; then: Step[]; else?: Step[] }
  | { macro: string }
  | { stop: true };
export interface Cond { var: string; equals?: unknown; notEquals?: unknown; greaterThan?: number; lessThan?: number; exists?: boolean; contains?: unknown }

const LIMIT = { steps: 10000, repeat: 1000, depth: 20 };
const getPath = (vars: Record<string, unknown>, path: string) => path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), vars);
function interpolate(v: unknown, vars: Record<string, unknown>): unknown {
  if (typeof v === 'string') {
    const whole = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(v);
    if (whole) return clone(getPath(vars, whole[1]));
    return v.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => { const x = getPath(vars, p); return x == null ? '' : String(x); });
  }
  if (Array.isArray(v)) return v.map((x) => interpolate(x, vars));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, interpolate(x, vars)]));
  return v;
}
function test(c: Cond, vars: Record<string, unknown>) {
  const v = getPath(vars, c.var);
  if (c.exists !== undefined) return (v !== undefined && v !== null) === c.exists;
  if ('equals' in c) return equal(v, interpolate(c.equals, vars));
  if ('notEquals' in c) return !equal(v, interpolate(c.notEquals, vars));
  if (c.greaterThan !== undefined) return Number(v) > Number(interpolate(c.greaterThan, vars));
  if (c.lessThan !== undefined) return Number(v) < Number(interpolate(c.lessThan, vars));
  if ('contains' in c) return Array.isArray(v) ? v.some((x) => equal(x, interpolate(c.contains, vars))) : String(v ?? '').includes(String(interpolate(c.contains, vars)));
  return Boolean(v);
}

class Stop { }
/** Executa passos dentro da transação aberta (ou abre uma). Devolve as variáveis no fim. */
export function runScript(e: Engine, steps: Step[], variables: Record<string, unknown> = {}) {
  const vars: Record<string, unknown> = clone(variables);
  let count = 0;
  const exec = (list: Step[], depth: number) => {
    if (depth > LIMIT.depth) fail('VALIDATION', 'Script aninhado demais.');
    if (!Array.isArray(list)) fail('VALIDATION', 'steps precisa ser uma lista.');
    for (const s of list) {
      if (++count > LIMIT.steps) fail('VALIDATION', `Script passou de ${LIMIT.steps} passos.`);
      if ('op' in s) {
        const op = interpolate(s.op, vars) as Operation;
        if (!op?.type || typeof op.type !== 'string') fail('VALIDATION', 'Passo "op" precisa de type.');
        if (['RUN_SCRIPT', 'RUN_MACRO'].includes(op.type) && depth > 5) fail('VALIDATION', 'Scripts chamando scripts demais.');
        const r = e.run(op);
        vars.last = clone(r) as unknown;
        if (s.saveAs) vars[s.saveAs] = clone(r) as unknown;
      } else if ('set' in s) vars[s.set] = interpolate(s.value, vars);
      else if ('repeat' in s) {
        const n = Number(interpolate(s.repeat, vars));
        if (!Number.isInteger(n) || n < 0 || n > LIMIT.repeat) fail('VALIDATION', `repeat: inteiro de 0 a ${LIMIT.repeat}.`);
        for (let i = 0; i < n; i++) { vars[s.as ?? 'i'] = i; exec(s.steps, depth + 1); }
      } else if ('forEach' in s) {
        const list2 = interpolate(s.forEach, vars) as unknown[];
        if (!Array.isArray(list2) || list2.length > LIMIT.repeat) fail('VALIDATION', `forEach: lista de até ${LIMIT.repeat} itens.`);
        for (const item of list2) { vars[s.as] = item; exec(s.steps, depth + 1); }
      } else if ('if' in s) exec(test(s.if, vars) ? s.then : s.else ?? [], depth + 1);
      else if ('macro' in s) exec(macroSteps(e, String(interpolate(s.macro, vars))), depth + 1);
      else if ('stop' in s) throw new Stop();
      else fail('VALIDATION', `Passo desconhecido: ${JSON.stringify(s).slice(0, 60)}.`);
    }
  };
  try { exec(steps, 0); } catch (x) { if (!(x instanceof Stop)) throw x; }
  return { variables: vars, steps: count };
}

// ---------------------------------------------------------------- macros

interface Macro { id: string; name: string; steps: Operation[]; createdAt?: string }
const NOT_RECORDED = new Set(['UNDO', 'REDO', 'REPEAT', 'START_RECORDING', 'STOP_RECORDING', 'CANCEL_RECORDING', 'RUN_MACRO', 'SET_USER', 'SET_PRESENCE']);
const macros = (e: Engine): Macro[] => [...((settings(e).macros as Macro[]) ?? []), ...extensions(e).filter((x) => x.enabled).flatMap((x) => (x.manifest.macros ?? []).map((m, i) => ({ id: `${x.manifest.id}/${i}`, name: m.name, steps: m.steps })))];
const findMacro = (e: Engine, key: string) => macros(e).find((m) => m.id === key || m.name.toLowerCase() === String(key).toLowerCase()) ?? fail('NOT_FOUND', `Macro ${key} não existe.`);
const macroSteps = (e: Engine, key: string): Step[] => findMacro(e, key)!.steps.map((op) => ({ op }));

function installRecorder(e: Engine) {
  e.on('operation', ({ op, changed }: { op: Operation; changed: boolean }) => {
    const rec = e.services.recorder as { name: string; steps: Operation[] } | undefined;
    if (!rec || !changed || NOT_RECORDED.has(op.type)) return;
    rec.steps.push(clone(op));
  });
}

// ---------------------------------------------------------------- automações

export const EVENTS = ['ANY_CHANGE', 'NODE_CREATED', 'NODE_DELETED', 'NODE_CHANGED', 'CELL_CHANGED', 'COMMENT_ADDED'];
interface Automation { id: string; name: string; event: string; condition?: { nodeType?: string; sheet?: string; range?: string; when?: Cond }; steps: Step[]; enabled: boolean }
const automations = (e: Engine): (Automation & { source?: string })[] => [
  ...((settings(e).automations as Automation[]) ?? []),
  ...extensions(e).filter((x) => x.enabled).flatMap((x) => (x.manifest.automations ?? []).map((a, i) => ({ ...a, id: `${x.manifest.id}/${i}`, enabled: true, source: x.manifest.id }))),
];
const SELF = new Set(['ADD_AUTOMATION', 'REMOVE_AUTOMATION', 'UPDATE_AUTOMATION', 'INSTALL_EXTENSION', 'UNINSTALL_EXTENSION', 'ENABLE_EXTENSION', 'DISABLE_EXTENSION', 'ADD_WEBHOOK', 'REMOVE_WEBHOOK']);

/** Eventos que uma lista de mudanças representa (também usados pelos webhooks). */
export function eventsOf(e: Engine, type: string, changes: Change[]) {
  const out: { event: string; vars: Record<string, unknown> }[] = [{ event: 'ANY_CHANGE', vars: { type } }];
  for (const c of changes) {
    if (c.collection === 'comments' && !c.before && c.after) { const t = c.after as any; out.push({ event: 'COMMENT_ADDED', vars: { commentId: c.id, text: t.messages?.[0]?.text, authorId: t.messages?.[0]?.authorId, targetId: t.anchor?.targetId } }); continue; }
    if (c.collection !== 'nodes') continue;
    const b = c.before as EditorNode | null, a = c.after as EditorNode | null;
    if (!b && a) { out.push({ event: 'NODE_CREATED', vars: { nodeId: c.id, nodeType: a.type } }); continue; }
    if (b && !a) { out.push({ event: 'NODE_DELETED', vars: { nodeId: c.id, nodeType: b.type } }); continue; }
    if (!a || !b) continue;
    if (isSheet(a)) {
      const input = (x: any) => (x ? x.formula ?? x.value ?? null : null);
      for (const addr of new Set([...Object.keys(b.data.cells ?? {}), ...Object.keys(a.data.cells ?? {})])) {
        const x = b.data.cells?.[addr], y = a.data.cells?.[addr];
        if (equal(input(x), input(y))) continue;
        out.push({ event: 'CELL_CHANGED', vars: { sheetId: a.id, sheet: a.data.name, cell: addr, value: y ? y.calculatedValue ?? y.value ?? null : null, oldValue: x ? x.calculatedValue ?? x.value ?? null : null } });
      }
    }
    if (!equal(a.data, b.data) || !equal(a.styleOverrides, b.styleOverrides) || !equal(a.layout, b.layout)) out.push({ event: 'NODE_CHANGED', vars: { nodeId: c.id, nodeType: a.type } });
  }
  return out;
}

function matches(e: Engine, a: Automation, ev: { event: string; vars: Record<string, unknown> }) {
  if (a.event !== ev.event) return false;
  const c = a.condition ?? {};
  if (c.nodeType && ev.vars.nodeType !== c.nodeType) return false;
  if (c.sheet && ev.vars.sheet !== c.sheet && ev.vars.sheetId !== c.sheet) return false;
  if (c.range && ev.vars.cell) {
    const r = parseRange(c.range), p = parseAddress(String(ev.vars.cell));
    if (p.row < r.r1 || p.row > r.r2 || p.col < r.c1 || p.col > r.c2) return false;
  }
  if (c.when && !test(c.when, ev.vars)) return false;
  return true;
}

export const automationHook: CommitHook = (e, { type, changes, remote }) => {
  if (remote || e.services.automationDepth || SELF.has(type)) return;
  const list = automations(e).filter((a) => a.enabled);
  if (!list.length) return;
  const evs = eventsOf(e, type, changes);
  let runs = 0;
  e.services.automationDepth = 1;   // o que as automações mudam não dispara outras automações
  try {
    for (const a of list) for (const ev of evs) {
      if (!matches(e, a, ev)) continue;
      if (++runs > 200) fail('VALIDATION', 'Automações demais para uma única ação (limite: 200).');
      try { runScript(e, a.steps, { ...ev.vars, event: ev.event, automation: a.name }); }
      catch (x) { fail('VALIDATION', `A automação "${a.name}" falhou: ${(x as Error).message} Desative-a para continuar.`); }
    }
  } finally { e.services.automationDepth = 0; }
};

// ---------------------------------------------------------------- atalhos

export interface Binding { operation?: Operation; macro?: string; command?: string }
const DEFAULT_SHORTCUTS: Record<string, Binding> = {
  'Ctrl+Z': { operation: { type: 'UNDO' } }, 'Ctrl+Y': { operation: { type: 'REDO' } }, 'Ctrl+Shift+Z': { operation: { type: 'REDO' } },
  'Ctrl+C': { operation: { type: 'COPY' } }, 'Ctrl+X': { operation: { type: 'CUT' } }, 'Ctrl+V': { operation: { type: 'PASTE' } },
  'Ctrl+A': { operation: { type: 'SELECT_ALL' } }, 'Ctrl+D': { operation: { type: 'DUPLICATE' } }, Delete: { operation: { type: 'DELETE' } },
  'Ctrl+G': { operation: { type: 'GROUP' } }, 'Ctrl+Shift+G': { operation: { type: 'UNGROUP' } }, F4: { operation: { type: 'REPEAT' } },
  'Ctrl+F': { command: 'FIND' }, 'Ctrl+H': { command: 'REPLACE' }, 'Ctrl+S': { command: 'SAVE' }, 'Ctrl+P': { command: 'PRINT' }, F5: { command: 'PRESENT' }, F7: { command: 'REVIEW' },
};
/** "cmd+shift+b" → "Ctrl+Shift+B" (Cmd vale como Ctrl, para o mesmo atalho servir no Mac). */
export function normalizeKeys(keys: string) {
  const parts = String(keys).split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) fail('VALIDATION', 'Informe as teclas, ex.: Ctrl+Shift+B.');
  const mods = new Set<string>();
  let key = '';
  for (const p of parts) {
    const l = p.toLowerCase();
    if (['ctrl', 'control', 'cmd', 'command', 'meta', 'mod'].includes(l)) mods.add('Ctrl');
    else if (['alt', 'option', 'opt'].includes(l)) mods.add('Alt');
    else if (l === 'shift') mods.add('Shift');
    else if (key) fail('VALIDATION', `Atalho com duas teclas principais: ${keys}.`);
    else key = p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1).toLowerCase();
  }
  if (!key) fail('VALIDATION', 'Falta a tecla principal.');
  return [...['Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m)), key].join('+');
}
const shortcuts = (e: Engine): Map<string, Binding> => (e.services.shortcuts ??= new Map(Object.entries(DEFAULT_SHORTCUTS)));

// ---------------------------------------------------------------- extensões

interface Manifest {
  id: string; name: string; version: string; description?: string;
  functions?: UserFunction[]; macros?: { name: string; steps: Operation[] }[];
  operations?: { type: string; description?: string; params?: string[]; steps: Step[] }[];
  shortcuts?: { keys: string; operation?: Operation; macro?: string; command?: string }[];
  automations?: Omit<Automation, 'id' | 'enabled'>[];
}
interface Installed { manifest: Manifest; enabled: boolean; installedAt: string }
const extensions = (e: Engine): Installed[] => (settings(e).extensions as Installed[]) ?? [];

function validateManifest(e: Engine, m: Manifest) {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(m?.id ?? '')) fail('VALIDATION', 'id da extensão: minúsculas, números e "-" (ex.: notas-fiscais).');
  if (!m.name || !/^\d+\.\d+\.\d+$/.test(m.version ?? '')) fail('VALIDATION', 'Informe name e version (ex.: 1.0.0).');
  const prefix = m.id.toUpperCase().replace(/-/g, '_') + '.';
  for (const o of m.operations ?? []) {
    if (!o.type?.startsWith(prefix) || !/^[A-Z0-9_]+\.[A-Z0-9_]+$/.test(o.type)) fail('VALIDATION', `Operação da extensão precisa começar com ${prefix} (ex.: ${prefix}GERAR).`);
    if (!Array.isArray(o.steps)) fail('VALIDATION', `Operação ${o.type} sem steps.`);
  }
  const mine = new Set([...(e.services.userFunctionNames ?? [])] as string[]);
  for (const f of m.functions ?? []) validateFunction(e, f, mine);
  for (const s of m.shortcuts ?? []) normalizeKeys(s.keys);
  for (const a of m.automations ?? []) if (!EVENTS.includes(a.event)) fail('VALIDATION', `Evento: ${EVENTS.join(', ')}.`);
}

/** Registra operações e atalhos das extensões ativas (sessão), conforme o documento. */
export function syncExtensions(e: Engine) {
  const prev: string[] = e.services.extensionOps ?? [];
  for (const t of prev) e.unregisterHandler(t);
  const ops: string[] = [];
  for (const x of extensions(e).filter((i) => i.enabled)) {
    for (const o of x.manifest.operations ?? []) {
      if (e.has(o.type)) continue;
      e.registerHandler(o.type, (eng, op) => runScript(eng, o.steps, { ...(op.payload ?? {}), targetId: op.targetId ?? null }).variables.result ?? null);
      ops.push(o.type);
    }
    for (const s of x.manifest.shortcuts ?? []) { const k = normalizeKeys(s.keys); if (!shortcuts(e).has(k) || shortcuts(e).get(k)?.command === undefined) shortcuts(e).set(k, { ...(s.operation ? { operation: s.operation } : {}), ...(s.macro ? { macro: s.macro } : {}), ...(s.command ? { command: s.command } : {}) }); }
  }
  e.services.extensionOps = ops;
  syncFunctions(e);
}

/** Extensão do próprio sistema (código confiável, nunca vindo de documento). */
export function installCodeExtension(e: Engine, ext: { id: string; handlers?: Record<string, Handler>; functions?: FunctionDef[] }) {
  for (const [type, h] of Object.entries(ext.handlers ?? {})) e.registerHandler(type, h);
  for (const f of ext.functions ?? []) formulas(e).registry.register({ ...f, category: f.category ?? 'CUSTOM' });
  (e.services.codeExtensions ??= []).push(ext.id);
}

// ---------------------------------------------------------------- serviços externos

interface Webhook { id: string; url: string; events: string[]; enabled: boolean }
type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
const http = (e: Engine): Http => e.services.http ?? ((globalThis as any).fetch as Http);
const httpsOnly = (url: unknown) => { let u: URL; try { u = new URL(String(url)); } catch { return fail('VALIDATION', 'Endereço inválido.'); } if (u.protocol !== 'https:') fail('VALIDATION', 'Só endereços https://.'); return u.toString(); };

function installWebhooks(e: Engine) {
  e.on('change', ({ transaction, source }: any) => {
    if (source !== 'execute') return;
    const hooks = ((settings(e).webhooks as Webhook[]) ?? []).filter((w) => w.enabled);
    if (!hooks.length) return;
    const evs = eventsOf(e, transaction.type, transaction.changes);
    for (const w of hooks) for (const ev of evs) {
      if (!w.events.includes(ev.event) && !(w.events.includes('CHANGE') && ev.event === 'ANY_CHANGE')) continue;
      const body = JSON.stringify({ event: ev.event, documentId: e.doc.document.id, documentName: e.doc.document.name, transactionId: transaction.id, userId: transaction.userId ?? null, data: ev.vars, at: new Date(transaction.timestamp).toISOString() });
      const log: any[] = (e.services.webhookLog ??= []);
      const entry = { webhookId: w.id, url: w.url, event: ev.event, ok: false as boolean, status: 0, error: '' };
      log.push(entry);
      if (log.length > 200) log.shift();
      const p = http(e)(w.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hallan-event': ev.event }, body })
        .then((r) => { entry.ok = r.ok; entry.status = r.status; })
        .catch((x) => { entry.error = String(x?.message ?? x); });
      (e.services.pendingDeliveries ??= []).push(p);
    }
  });
}

/** Chama um serviço externo e, se pedido, roda passos com a resposta (numa transação nova). */
export async function callService(e: Engine, req: { url: string; method?: string; headers?: Record<string, string>; body?: unknown; then?: Step[] }) {
  const url = httpsOnly(req.url);
  const method = (req.method ?? 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fail('VALIDATION', 'Método HTTP inválido.');
  const r = await http(e)(url, { method, headers: { accept: 'application/json', ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(req.headers ?? {}) }, ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}) });
  const text = await r.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* texto puro */ }
  const result = { ok: r.ok, status: r.status, data };
  if (req.then?.length) result.data = e.run({ type: 'RUN_SCRIPT', payload: { steps: req.then, variables: { response: data, status: r.status, ok: r.ok } } }).variables.response ?? data;
  return result;
}

// ---------------------------------------------------------------- instalação e operações

export function installAutomation(e: Engine) {
  e.commitHooks.unshift(automationHook);   // antes da permissão e do controle de alterações: eles veem o que a automação fez
  installRecorder(e);
  installWebhooks(e);
  e.on('change', () => { if (e.services.extensionSig !== JSON.stringify(extensions(e))) { e.services.extensionSig = JSON.stringify(extensions(e)); syncExtensions(e); } else syncFunctions(e); });
  e.services.extensionSig = JSON.stringify(extensions(e));
  syncExtensions(e);
}

const recalcSheets = (e: Engine) => { if (Object.values(e.doc.nodes).some(isSheet)) formulas(e).recalc([], true); };

export const automationHandlers: Record<string, Handler> = {
  /** DEFINE_FUNCTION { name, params, body, description? } — redefinir substitui. */
  DEFINE_FUNCTION: (e, op) => {
    const p = op.payload ?? {};
    const def: UserFunction = { name: String(p.name ?? '').toUpperCase(), params: (p.params ?? []).map(String), body: String(p.body ?? ''), ...(p.description ? { description: String(p.description) } : {}) };
    validateFunction(e, def, new Set(e.services.userFunctionNames ?? []));
    const inf = info(e);
    inf.settings.functions = [...((inf.settings.functions as UserFunction[]) ?? []).filter((f) => normalizeName(f.name) !== normalizeName(def.name)), def];
    syncFunctions(e);
    recalcSheets(e);
    return def.name;
  },
  DELETE_FUNCTION: (e, op) => {
    const inf = info(e);
    const before = (inf.settings.functions ?? []).length;
    inf.settings.functions = (inf.settings.functions ?? []).filter((f: UserFunction) => normalizeName(f.name) !== normalizeName(String(op.payload?.name ?? '')));
    if (inf.settings.functions.length === before) fail('NOT_FOUND', `Função ${op.payload?.name} não existe.`);
    syncFunctions(e);
    recalcSheets(e);
    return op.payload?.name;
  },
  LIST_FUNCTIONS: (e) => userFunctions(e).map((f) => ({ ...f })),

  START_RECORDING: (e, op) => {
    if (e.services.recorder) fail('INVALID_OPERATION', 'Já há uma gravação em andamento.');
    const name = String(op.payload?.name ?? '').trim();
    if (!name) fail('VALIDATION', 'Dê um nome à macro.');
    e.services.recorder = { name, steps: [] };
    return name;
  },
  STOP_RECORDING: (e) => {
    const rec = e.services.recorder ?? fail('INVALID_OPERATION', 'Nenhuma gravação em andamento.');
    e.services.recorder = undefined;
    if (!rec.steps.length) fail('VALIDATION', 'Nada foi gravado.');
    const inf = info(e);
    const id = e.newId('MACRO');
    inf.settings.macros = [...((inf.settings.macros as Macro[]) ?? []).filter((m) => m.name.toLowerCase() !== rec.name.toLowerCase()), { id, name: rec.name, steps: rec.steps }];
    return { id, name: rec.name, steps: rec.steps.length };
  },
  CANCEL_RECORDING: (e) => { const had = Boolean(e.services.recorder); e.services.recorder = undefined; return had; },
  /** RUN_MACRO { name | macroId, applyToSelection? } — tudo numa ação só (um desfazer). */
  RUN_MACRO: (e, op) => {
    const m = findMacro(e, op.payload?.macroId ?? op.payload?.name)!;
    const sel = e.state.selection.selectedIds;
    const steps = m.steps.map((s) => { const o = clone(s); if (op.payload?.applyToSelection && sel.length && (o.targetId || o.targetIds)) { delete o.targetId; o.targetIds = [...sel]; } return { op: o }; });
    return runScript(e, steps).steps;
  },
  DELETE_MACRO: (e, op) => { const inf = info(e); const m = findMacro(e, op.payload?.macroId ?? op.payload?.name)!; inf.settings.macros = (inf.settings.macros ?? []).filter((x: Macro) => x.id !== m.id); return m.id; },
  LIST_MACROS: (e) => macros(e).map((m) => ({ id: m.id, name: m.name, steps: m.steps.length })),

  /** RUN_SCRIPT { steps, variables? } → { variables, steps } */
  RUN_SCRIPT: (e, op) => runScript(e, op.payload?.steps ?? fail('INVALID_PAYLOAD', 'Informe steps.'), op.payload?.variables ?? {}),

  /** ADD_AUTOMATION { name, event, condition?, steps } */
  ADD_AUTOMATION: (e, op) => {
    const p = op.payload ?? {};
    if (!String(p.name ?? '').trim()) fail('VALIDATION', 'Dê um nome à automação.');
    if (!EVENTS.includes(p.event)) fail('VALIDATION', `Evento: ${EVENTS.join(', ')}.`);
    if (!Array.isArray(p.steps) || !p.steps.length) fail('VALIDATION', 'Informe os passos (steps).');
    if (p.condition?.range) { try { parseRange(p.condition.range); } catch { fail('VALIDATION', `Intervalo inválido: ${p.condition.range}.`); } }
    const inf = info(e);
    const id = e.newId('AUTO');
    inf.settings.automations = [...((inf.settings.automations as Automation[]) ?? []), { id, name: String(p.name), event: p.event, ...(p.condition ? { condition: clone(p.condition) } : {}), steps: clone(p.steps), enabled: p.enabled !== false }];
    return id;
  },
  UPDATE_AUTOMATION: (e, op) => {
    const inf = info(e);
    const a = (inf.settings.automations ?? []).find((x: Automation) => x.id === op.payload?.automationId) ?? fail('NOT_FOUND', 'Automação não existe.');
    for (const k of ['name', 'enabled', 'condition', 'steps'] as const) if (op.payload?.[k] !== undefined) (a as any)[k] = clone(op.payload[k]);
    return a.id;
  },
  REMOVE_AUTOMATION: (e, op) => {
    const inf = info(e);
    const before = (inf.settings.automations ?? []).length;
    inf.settings.automations = (inf.settings.automations ?? []).filter((x: Automation) => x.id !== op.payload?.automationId);
    if (inf.settings.automations.length === before) fail('NOT_FOUND', 'Automação não existe.');
    return op.payload?.automationId;
  },
  LIST_AUTOMATIONS: (e) => automations(e).map((a) => ({ id: a.id, name: a.name, event: a.event, enabled: a.enabled, ...(a.source ? { source: a.source } : {}) })),

  /** SET_SHORTCUT { keys, operation | macro | command | null } — null apaga. Preferência da sessão. */
  SET_SHORTCUT: (e, op) => {
    const p = op.payload ?? {};
    const k = normalizeKeys(p.keys);
    const prev = shortcuts(e).get(k) ?? null;
    if (p.operation === null || (!p.operation && !p.macro && !p.command)) { shortcuts(e).delete(k); return { keys: k, previous: prev }; }
    if (p.operation && (!p.operation.type || !e.has(p.operation.type))) fail('VALIDATION', `Operação ${p.operation?.type} não existe.`);
    if (p.macro) findMacro(e, p.macro);
    shortcuts(e).set(k, { ...(p.operation ? { operation: clone(p.operation) } : {}), ...(p.macro ? { macro: String(p.macro) } : {}), ...(p.command ? { command: String(p.command) } : {}) });
    return { keys: k, previous: prev };
  },
  RESOLVE_SHORTCUT: (e, op) => clone(shortcuts(e).get(normalizeKeys(op.payload?.keys)) ?? null),
  LIST_SHORTCUTS: (e) => [...shortcuts(e).entries()].map(([keys, b]) => ({ keys, ...clone(b) })).sort((a, b) => a.keys.localeCompare(b.keys)),
  RESET_SHORTCUTS: (e) => { e.services.shortcuts = new Map(Object.entries(DEFAULT_SHORTCUTS)); syncExtensions(e); return e.services.shortcuts.size; },

  /** INSTALL_EXTENSION { manifest } — declarativa; fica no documento. */
  INSTALL_EXTENSION: (e, op) => {
    const m = clone(op.payload?.manifest ?? fail('INVALID_PAYLOAD', 'Informe manifest.')) as Manifest;
    validateManifest(e, m);
    const inf = info(e);
    const list: Installed[] = inf.settings.extensions ?? [];
    for (const o of m.operations ?? []) if (e.has(o.type) && !list.some((x) => x.manifest.id === m.id && x.manifest.operations?.some((y) => y.type === o.type))) fail('VALIDATION', `A operação ${o.type} já existe.`);
    inf.settings.extensions = [...list.filter((x) => x.manifest.id !== m.id), { manifest: m, enabled: true, installedAt: new Date().toISOString() }];
    syncExtensions(e);
    recalcSheets(e);
    return m.id;
  },
  LIST_EXTENSIONS: (e) => extensions(e).map((x) => ({ id: x.manifest.id, name: x.manifest.name, version: x.manifest.version, enabled: x.enabled, operations: (x.manifest.operations ?? []).map((o) => o.type), functions: (x.manifest.functions ?? []).map((f) => f.name) })),
  ENABLE_EXTENSION: (e, op) => toggleExt(e, op.payload?.id, true),
  DISABLE_EXTENSION: (e, op) => toggleExt(e, op.payload?.id, false),
  UNINSTALL_EXTENSION: (e, op) => {
    const inf = info(e);
    const before = (inf.settings.extensions ?? []).length;
    inf.settings.extensions = (inf.settings.extensions ?? []).filter((x: Installed) => x.manifest.id !== op.payload?.id);
    if (inf.settings.extensions.length === before) fail('NOT_FOUND', `Extensão ${op.payload?.id} não está instalada.`);
    syncExtensions(e);
    recalcSheets(e);
    return op.payload?.id;
  },

  /** ADD_WEBHOOK { url (https), events: ['CHANGE' | evento…] } */
  ADD_WEBHOOK: (e, op) => {
    const url = httpsOnly(op.payload?.url);
    const events: string[] = op.payload?.events ?? ['CHANGE'];
    for (const ev of events) if (ev !== 'CHANGE' && !EVENTS.includes(ev)) fail('VALIDATION', `Evento: CHANGE, ${EVENTS.join(', ')}.`);
    const inf = info(e);
    const id = e.newId('HOOK');
    inf.settings.webhooks = [...((inf.settings.webhooks as Webhook[]) ?? []), { id, url, events, enabled: true }];
    return id;
  },
  REMOVE_WEBHOOK: (e, op) => { const inf = info(e); const before = (inf.settings.webhooks ?? []).length; inf.settings.webhooks = (inf.settings.webhooks ?? []).filter((w: Webhook) => w.id !== op.payload?.webhookId); if (inf.settings.webhooks.length === before) fail('NOT_FOUND', 'Webhook não existe.'); return op.payload?.webhookId; },
  LIST_WEBHOOKS: (e) => clone((settings(e).webhooks as Webhook[]) ?? []),
  /** CALL_SERVICE { url, method?, body?, then? } — assíncrono: devolve o id; o resultado chega no evento 'service-result'. */
  CALL_SERVICE: (e, op) => {
    const p = op.payload ?? {};
    httpsOnly(p.url);
    const requestId = `REQ_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    e.afterCommit(() => {
      const pr = callService(e, p as any).then((r) => { e.emit('service-result', { requestId, ...r }); return r; }, (x) => { const r = { ok: false, status: 0, error: String(x?.message ?? x) }; e.emit('service-result', { requestId, ...r }); return r; });
      (e.services.pendingRequests ??= new Map()).set(requestId, pr);
    });
    return { requestId };
  },
};

function toggleExt(e: Engine, id: string, on: boolean) {
  const inf = info(e);
  const x = (inf.settings.extensions ?? []).find((i: Installed) => i.manifest.id === id) ?? fail('NOT_FOUND', `Extensão ${id} não está instalada.`);
  x.enabled = on;
  syncExtensions(e);
  recalcSheets(e);
  return on;
}
