// Comentários e colaboração (F13).
//
//   Usuário da sessão:  engine.user (SET_USER) — autoria das transações, dos comentários e das revisões.
//   Permissões:         settings.permissions = { ownerId, members: { id: { role, name, email } }, linkAccess }
//                       Papéis: OWNER (tudo) · EDITOR (tudo menos permissões) · COMMENTER (só comentários) · VIEWER.
//                       A checagem é feita sobre o EFEITO da operação (o que mudou), não sobre o nome dela — então
//                       nenhuma operação nova escapa. Sem permissões configuradas, quem usa é dono (uso local).
//   Comentários:        coleção `comments`: fios ancorados num elemento, trecho de texto (start/end) ou célula;
//                       respostas, edição pelo autor, resolver/reabrir, @menções (evento 'mention').
//   Presença:           quem está no documento e o que selecionou (temporário, fora do documento e do histórico).
//   Controle de alterações: com settings.trackChanges, cada ação de conteúdo vira uma revisão (coleção
//                       `revisions`, com autor) que pode ser aceita ou rejeitada — rejeitar desfaz só aquela ação.
//   Edição simultânea:  APPLY_REMOTE aplica transações de outros colaboradores (fora do desfazer local) com mesclagem
//                       em três vias; SyncSession junta o que sai e o que chega.
import type { Change, CommentMessage, CommentThread, EditorNode, Revision, User } from '../types.ts';
import type { CommitHook, Engine, Handler } from '../engine.ts';
import { textOf } from './text.ts';
import { clone, equal, fail, merge3 } from '../util.ts';

export const ROLES = ['OWNER', 'EDITOR', 'COMMENTER', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number] | 'NONE';
interface Member { role: Role; name: string; email?: string }
interface Permissions { ownerId: string; members: Record<string, Member>; linkAccess: Role }

const RANK: Record<Role, number> = { NONE: 0, VIEWER: 1, COMMENTER: 2, EDITOR: 3, OWNER: 4 };
const CONTENT = ['nodes', 'styles', 'themes', 'assets'];

const nowIso = (e: Engine) => (e.services.now?.() ?? new Date()).toISOString();
const nowMs = (e: Engine) => (e.services.now?.() ?? new Date()).getTime();
export const currentUser = (e: Engine): User => e.user ?? { id: 'local', name: 'Você' };
const perms = (e: Engine) => e.doc.document.settings.permissions as Permissions | undefined;

/** Papel de um usuário neste documento. */
export function roleOf(e: Engine, userId = e.user?.id, p: Permissions | undefined = perms(e)): Role {
  if (!p) return 'OWNER';
  if (!userId) return p.linkAccess ?? 'NONE';
  return p.members[userId]?.role ?? p.linkAccess ?? 'NONE';
}
const can = (e: Engine, min: Role) => RANK[roleOf(e)] >= RANK[min];

/** Bloqueia o que o papel não permite, olhando o que a transação mudou. */
export const permissionHook: CommitHook = (e, { changes, remote }) => {
  if (remote) return;
  // o papel vale como era ANTES da operação (quem deixa de ser dono no meio dela ainda era dono)
  const doc = changes.find((c) => c.collection === 'document');
  const role = roleOf(e, e.user?.id, doc ? (doc.before as any)?.settings?.permissions : perms(e));
  if (role === 'OWNER') return;
  if (role === 'NONE' || role === 'VIEWER') fail('PERMISSION_DENIED', role === 'NONE' ? 'Você não tem acesso a este documento.' : 'Você só pode visualizar este documento.');
  if (role === 'COMMENTER') {
    if (changes.some((c) => c.collection !== 'comments')) fail('PERMISSION_DENIED', 'Você só pode comentar neste documento.');
    return;
  }
  if (doc && !equal((doc.before as any)?.settings?.permissions, (doc.after as any)?.settings?.permissions)) fail('PERMISSION_DENIED', 'Só o dono muda o compartilhamento.');
};

const UNTRACKED = new Set(['ACCEPT_CHANGE', 'REJECT_CHANGE', 'SET_TRACK_CHANGES', 'APPLY_REMOTE']);
/** No modo revisão, guarda cada ação de conteúdo como revisão (na mesma transação: desfazer leva junto). */
export const trackChangesHook: CommitHook = (e, { type, changes, remote }) => {
  if (remote || !e.doc.document.settings.trackChanges || UNTRACKED.has(type)) return;
  const content = changes.filter((c) => CONTENT.includes(c.collection));
  if (!content.length) return;
  const u = currentUser(e);
  const id = e.newId('REV');
  e.put('revisions', id, { id, userId: u.id, userName: u.name, type, timestamp: nowMs(e), status: 'PENDING', changes: clone(content) } satisfies Revision);
};

export function installCollaboration(e: Engine) {
  e.commitHooks.push(permissionHook, trackChangesHook);
}

// ---------------------------------------------------------------- comentários

const thread = (e: Engine, id: string): CommentThread => (e.doc.comments?.[id] as CommentThread) ?? fail('NOT_FOUND', `Comentário ${id} não existe.`);
const editThread = (e: Engine, id: string): CommentThread => { thread(e, id); if (!can(e, 'COMMENTER')) fail('PERMISSION_DENIED', 'Você não pode comentar neste documento.'); return e.touch('comments', id); };

function mentionsIn(e: Engine, text: string): string[] {
  const p = perms(e);
  const people = Object.entries(p?.members ?? {}).map(([id, m]) => ({ id, keys: [id, m.name, m.email, m.email?.split('@')[0]].filter(Boolean) as string[] }));
  const low = text.toLowerCase();
  return people.filter((x) => x.keys.some((k) => low.includes('@' + k.toLowerCase()))).map((x) => x.id);
}

function message(e: Engine, text: unknown): CommentMessage {
  const t = String(text ?? '').trim();
  if (!t) fail('VALIDATION', 'Escreva o comentário.');
  if (t.length > 10000) fail('VALIDATION', 'Comentário longo demais (máx. 10.000 caracteres).');
  const u = currentUser(e);
  return { id: e.newId('MSG'), authorId: u.id, authorName: u.name, text: t, mentions: mentionsIn(e, t), createdAt: nowIso(e) };
}

const notify = (e: Engine, threadId: string, m: CommentMessage) => {
  for (const userId of m.mentions) if (userId !== m.authorId) e.afterCommit(() => e.emit('mention', { userId, threadId, messageId: m.id, by: m.authorId, text: m.text }));
};

// ---------------------------------------------------------------- revisões

function textDiff(a: string, b: string) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { at: p, deleted: a.slice(p, a.length - s), inserted: b.slice(p, b.length - s) };
}

function summarize(r: Revision) {
  return {
    id: r.id, userId: r.userId, userName: r.userName, type: r.type, timestamp: r.timestamp,
    items: r.changes.filter((c) => c.collection === 'nodes').map((c) => {
      const b = c.before as EditorNode | null, a = c.after as EditorNode | null;
      const kind = !b ? 'INSERTED' : !a ? 'DELETED' : 'MODIFIED';
      const tb = b && Array.isArray(b.data.runs) ? textOf(b) : undefined, ta = a && Array.isArray(a.data.runs) ? textOf(a) : undefined;
      return { nodeId: c.id, nodeType: (a ?? b)!.type, kind, ...(tb !== undefined || ta !== undefined ? { text: textDiff(tb ?? '', ta ?? '') } : {}) };
    }),
  };
}

/** Rejeitar: volta só o que a revisão mudou; o que mudou depois dela (no mesmo campo) é preservado. */
function revert(e: Engine, r: Revision) {
  for (const c of [...r.changes].reverse()) {
    const col = c.collection as 'nodes' | 'styles' | 'themes' | 'assets';
    const current = clone((e.doc as any)[col]?.[c.id]) ?? null;
    let value: unknown;
    if (equal(current, c.after)) value = c.before;
    else if (current === null) value = c.after === null ? c.before : null;            // apagado depois: só ressuscita se a revisão apagou
    else if (c.before === null) value = null;                                          // revisão criou: remove
    else value = merge3(c.after, c.before, current).value;                             // conflito: vale o mais recente
    if (equal(current, value)) continue;
    if (value === null) e.del(col, c.id); else e.put(col, c.id, clone(value));
  }
  e.del('revisions', r.id);
}

// ---------------------------------------------------------------- edição simultânea

export interface RemoteTransaction { id: string; userId?: string; changes: Change[] }

/** Junta as transações locais para enviar e aplica as que chegam (sem reenviar o próprio eco). */
export class SyncSession {
  outbox: RemoteTransaction[] = [];
  private n = 0;
  private off: () => void;
  engine: Engine;
  clientId: string;
  constructor(engine: Engine, clientId: string = engine.user?.id ?? 'local') {
    this.engine = engine;
    this.clientId = clientId;
    engine.ensureIdSuffix(clientId);
    this.off = engine.on('change', (ev: any) => {
      if (ev.source === 'remote') return;
      const changes: Change[] | undefined = ev.source === 'execute' ? ev.transaction.changes : ev.applied;
      if (!changes?.length) return;
      this.outbox.push({ id: `${this.clientId}:${++this.n}:${ev.transaction.id}`, userId: this.engine.user?.id, changes: clone(changes) });
    });
  }
  /** O que precisa ir para o servidor (e esvazia a fila). */
  drain() { const o = this.outbox; this.outbox = []; return o; }
  /** Aplica o que veio do servidor; devolve conflitos resolvidos (vale a versão que chegou). */
  receive(list: RemoteTransaction[]) {
    const mine = list.filter((t) => !t.id.startsWith(`${this.clientId}:`));
    if (!mine.length) return { applied: 0, conflicts: [] };
    return this.engine.run({ type: 'APPLY_REMOTE', payload: { transactions: mine } });
  }
  close() { this.off(); }
}

// ---------------------------------------------------------------- operações

const PALETTE = ['#E11D48', '#2563EB', '#16A34A', '#9333EA', '#EA580C', '#0891B2', '#CA8A04', '#DB2777'];
const colorFor = (id: string) => PALETTE[[...id].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const presence = (e: Engine): Map<string, any> => (e.services.presence ??= new Map());

function touchPerms(e: Engine): Permissions {
  const info = e.touch('document', 'info') as any;
  if (!info.settings.permissions) {
    if (!e.user) fail('INVALID_OPERATION', 'Defina o usuário da sessão (SET_USER) antes de compartilhar.');
    info.settings.permissions = { ownerId: e.user!.id, members: { [e.user!.id]: { role: 'OWNER', name: e.user!.name, ...(e.user!.email ? { email: e.user!.email } : {}) } }, linkAccess: 'NONE' };
  }
  return info.settings.permissions;
}
const validRole = (r: unknown, allowNone = false): Role => {
  if (!(ROLES as readonly string[]).includes(r as string) && !(allowNone && r === 'NONE')) fail('VALIDATION', `Papel: ${ROLES.join(', ')}${allowNone ? ' ou NONE' : ''}.`);
  return r as Role;
};

export const collabHandlers: Record<string, Handler> = {
  /** Usuário desta sessão (não altera o documento). */
  SET_USER: (e, op) => {
    const p = op.payload ?? {};
    if (p.id === null) { e.user = null; return null; }
    if (!p.id || !p.name) fail('VALIDATION', 'Informe id e name.');
    e.user = { id: String(p.id), name: String(p.name), ...(p.email ? { email: String(p.email) } : {}) };
    return clone(e.user);
  },
  MY_ROLE: (e) => roleOf(e),

  /** SHARE { userId, name, email?, role } — convida (só o dono). */
  SHARE: (e, op) => {
    const p = op.payload ?? {};
    const role = validRole(p.role ?? 'VIEWER');
    if (role === 'OWNER') fail('VALIDATION', 'Para passar a posse use SET_PERMISSION com OWNER.');
    const id = String(p.userId ?? p.email ?? '').trim();
    if (!id) fail('VALIDATION', 'Informe userId ou email.');
    const pm = touchPerms(e);
    if (pm.members[id]?.role === 'OWNER') fail('INVALID_OPERATION', 'Esta pessoa já é dona do documento.');
    pm.members[id] = { role, name: String(p.name ?? p.email ?? id), ...(p.email ? { email: String(p.email) } : {}) };
    return id;
  },
  UNSHARE: (e, op) => {
    const pm = touchPerms(e);
    const id = op.payload?.userId;
    if (!pm.members[id]) fail('NOT_FOUND', `${id} não tem acesso.`);
    if (id === pm.ownerId) fail('INVALID_OPERATION', 'O dono não pode ser removido.');
    delete pm.members[id];
    presence(e).delete(id);
    return id;
  },
  /** SET_PERMISSION { userId, role } — OWNER passa a posse (o dono anterior vira editor). */
  SET_PERMISSION: (e, op) => {
    const pm = touchPerms(e);
    const { userId } = op.payload ?? {};
    const role = validRole(op.payload?.role);
    const m = pm.members[userId] ?? fail('NOT_FOUND', `${userId} não tem acesso; use SHARE.`);
    if (userId === pm.ownerId && role !== 'OWNER') fail('INVALID_OPERATION', 'Passe a posse para outra pessoa antes de mudar o papel do dono.');
    if (role === 'OWNER' && userId !== pm.ownerId) { pm.members[pm.ownerId].role = 'EDITOR'; pm.ownerId = userId; }
    m!.role = role;
    return role;
  },
  SET_LINK_ACCESS: (e, op) => { const pm = touchPerms(e); const r = validRole(op.payload?.access, true); if (r === 'OWNER') fail('VALIDATION', 'O link não pode dar posse.'); pm.linkAccess = r; return r; },
  LIST_MEMBERS: (e) => { const p = perms(e); return p ? Object.entries(p.members).map(([userId, m]) => ({ userId, ...m, owner: userId === p.ownerId })) : []; },

  /** ADD_COMMENT (targetId = elemento) { text, start?, end?, cell? } */
  ADD_COMMENT: (e, op) => {
    if (!can(e, 'COMMENTER')) fail('PERMISSION_DENIED', 'Você não pode comentar neste documento.');
    const n = e.get(op.targetId);
    const p = op.payload ?? {};
    const anchor: CommentThread['anchor'] = { targetId: n.id };
    if (p.start !== undefined || p.end !== undefined) {
      if (!Array.isArray(n.data.runs)) fail('VALIDATION', 'Trecho (start/end) só em elementos de texto.');
      const len = textOf(n).length, s = Number(p.start ?? 0), en = Number(p.end ?? len);
      if (!(s >= 0 && en <= len && s < en)) fail('VALIDATION', `Trecho inválido: de 0 a ${len}.`);
      Object.assign(anchor, { start: s, end: en, quote: textOf(n).slice(s, en) });
    }
    if (p.cell) anchor.cell = String(p.cell).toUpperCase();
    const m = message(e, p.text);
    const id = e.newId('CMT');
    e.put('comments', id, { id, anchor, status: 'OPEN', messages: [m], createdAt: m.createdAt } satisfies CommentThread);
    notify(e, id, m);
    return id;
  },
  REPLY_COMMENT: (e, op) => {
    const t = editThread(e, op.payload?.commentId);
    const m = message(e, op.payload?.text);
    t.messages.push(m);
    if (t.status === 'RESOLVED' && op.payload?.reopen !== false) { t.status = 'OPEN'; delete t.resolvedBy; delete t.resolvedAt; }
    notify(e, t.id, m);
    return m.id;
  },
  /** EDIT_COMMENT { commentId, messageId? (padrão: o primeiro), text } — só quem escreveu. */
  EDIT_COMMENT: (e, op) => {
    const t = editThread(e, op.payload?.commentId);
    const m = (op.payload?.messageId ? t.messages.find((x) => x.id === op.payload!.messageId) : t.messages[0]) ?? fail('NOT_FOUND', 'Mensagem não existe.');
    if (m!.authorId !== currentUser(e).id) fail('PERMISSION_DENIED', 'Só quem escreveu pode editar o comentário.');
    const next = message(e, op.payload?.text);
    const fresh = next.mentions.filter((x) => !m!.mentions.includes(x));
    Object.assign(m!, { text: next.text, mentions: next.mentions, editedAt: next.createdAt });
    notify(e, t.id, { ...m!, mentions: fresh });
    return m!.id;
  },
  /** DELETE_COMMENT { commentId, messageId? } — sem messageId (ou o primeiro) apaga o fio. Autor ou dono. */
  DELETE_COMMENT: (e, op) => {
    const t = editThread(e, op.payload?.commentId);
    const mid = op.payload?.messageId ?? t.messages[0].id;
    const m = t.messages.find((x) => x.id === mid) ?? fail('NOT_FOUND', 'Mensagem não existe.');
    if (m!.authorId !== currentUser(e).id && roleOf(e) !== 'OWNER') fail('PERMISSION_DENIED', 'Só o autor ou o dono apagam um comentário.');
    if (mid === t.messages[0].id) { e.del('comments', t.id); return t.id; }
    t.messages = t.messages.filter((x) => x.id !== mid);
    return mid;
  },
  RESOLVE_COMMENT: (e, op) => {
    const t = editThread(e, op.payload?.commentId);
    if (t.status === 'RESOLVED') return t.id;
    Object.assign(t, { status: 'RESOLVED', resolvedBy: currentUser(e).id, resolvedAt: nowIso(e) });
    return t.id;
  },
  REOPEN_COMMENT: (e, op) => { const t = editThread(e, op.payload?.commentId); t.status = 'OPEN'; delete t.resolvedBy; delete t.resolvedAt; return t.id; },
  /** LIST_COMMENTS { targetId?, status?, mentioning? (userId) } — na ordem em que foram criados. */
  LIST_COMMENTS: (e, op) => {
    const p = op.payload ?? {};
    const inside = op.targetId ? new Set([op.targetId, ...e.descendants(op.targetId)]) : null;
    return Object.values(e.doc.comments ?? {})
      .filter((t) => (!inside || inside.has(t.anchor.targetId)) && (!p.status || t.status === p.status) && (!p.mentioning || t.messages.some((m) => m.mentions.includes(p.mentioning))))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(clone);
  },

  /** SET_PRESENCE { userId?, name?, surfaceId?, selection?, cursor? } — padrão: o usuário da sessão. */
  SET_PRESENCE: (e, op) => {
    const p = op.payload ?? {};
    const u = p.userId ? { id: String(p.userId), name: String(p.name ?? p.userId) } : currentUser(e);
    const prev = presence(e).get(u.id) ?? {};
    const entry = { ...prev, userId: u.id, name: p.name ?? prev.name ?? u.name, color: prev.color ?? colorFor(u.id), surfaceId: p.surfaceId ?? prev.surfaceId ?? e.state.activeSurface, selection: clone(p.selection ?? prev.selection ?? (p.userId ? [] : e.state.selection.selectedIds)), ...(p.cursor ? { cursor: clone(p.cursor) } : {}), lastSeen: nowMs(e) };
    presence(e).set(u.id, entry);
    e.emit('presence', clone(entry));
    return clone(entry);
  },
  REMOVE_PRESENCE: (e, op) => { const id = op.payload?.userId ?? currentUser(e).id; const had = presence(e).delete(id); if (had) e.emit('presence', { userId: id, left: true }); return had; },
  /** LIST_PRESENCE { maxAgeMs? (60 s), includeSelf? } */
  LIST_PRESENCE: (e, op) => {
    const max = op.payload?.maxAgeMs ?? 60000, now = nowMs(e), self = currentUser(e).id;
    return [...presence(e).values()].filter((x) => now - x.lastSeen <= max && (op.payload?.includeSelf || x.userId !== self)).map(clone);
  },

  SET_TRACK_CHANGES: (e, op) => { const info = e.touch('document', 'info') as any; info.settings.trackChanges = Boolean(op.payload?.enabled); return info.settings.trackChanges; },
  /** Revisões pendentes, da mais antiga para a mais nova, com o que mudou em cada elemento. */
  LIST_CHANGES: (e, op) => Object.values(e.doc.revisions ?? {})
    .filter((r) => !op.payload?.userId || r.userId === op.payload.userId)
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id, 'en', { numeric: true }))
    .map(summarize),
  /** ACCEPT_CHANGE { changeId } | { all: true } — mantém a alteração e tira a marca. */
  ACCEPT_CHANGE: (e, op) => {
    const ids = op.payload?.all ? Object.keys(e.doc.revisions ?? {}) : [op.payload?.changeId];
    for (const id of ids) { if (!e.doc.revisions?.[id]) fail('NOT_FOUND', `Alteração ${id} não existe.`); e.del('revisions', id); }
    return ids.length;
  },
  /** REJECT_CHANGE { changeId } | { all: true } — desfaz a alteração (das mais novas para as mais antigas). */
  REJECT_CHANGE: (e, op) => {
    const list = op.payload?.all
      ? Object.values(e.doc.revisions ?? {}).sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id, 'en', { numeric: true }))
      : [e.doc.revisions?.[op.payload?.changeId] ?? fail('NOT_FOUND', `Alteração ${op.payload?.changeId} não existe.`)];
    for (const r of list) revert(e, r as Revision);
    return list.length;
  },

  /** APPLY_REMOTE { transactions: [{ id, userId?, changes }] } — de outros colaboradores; não entra no desfazer local. */
  APPLY_REMOTE: (e, op) => {
    e.markRemote();
    const seen: Set<string> = (e.services.remoteSeen ??= new Set());
    const conflicts: { id: string; collection: string; itemId: string; paths: string[] }[] = [];
    let applied = 0;
    const done: string[] = [];
    for (const tx of (op.payload?.transactions ?? []) as RemoteTransaction[]) {
      if (seen.has(tx.id)) continue;
      for (const c of tx.changes) {
        const current = c.collection === 'document' ? clone(e.doc.document) : clone((e.doc as any)[c.collection]?.[c.id]) ?? null;
        if (equal(current, c.after)) continue;
        let value = c.after;
        if (!equal(current, c.before) && current !== null && c.after !== null && c.before !== null) {
          const m = merge3(c.before, current, c.after);
          value = m.value;
          if (m.conflicts.length) conflicts.push({ id: tx.id, collection: c.collection, itemId: c.id, paths: m.conflicts });
        }
        if (c.collection === 'document') {
          const info = e.touch('document', 'info') as any;
          const seq = info.seq;
          for (const k of Object.keys(info)) delete info[k];
          Object.assign(info, clone(value), { seq: Math.max(seq, (value as any).seq ?? 0) });
        } else if (value === null) { if (current !== null) e.del(c.collection, c.id); }
        else e.put(c.collection, c.id, clone(value));
      }
      applied++;
      done.push(tx.id);
    }
    e.afterCommit(() => { for (const id of done) seen.add(id); });
    return { applied, conflicts };
  },
};
