// Documentos do editor unificado no banco (Neon): criar, abrir, gravar com concorrência otimista, versões e o relé
// da colaboração. O conteúdo é o JSON do motor (src/editor-core); aqui só se confere a forma e a integridade.
import { and, desc, eq, gt, isNull, max, ne, sql } from 'drizzle-orm';
import { db, schema as s } from '../db/client';
import { SaveError } from './posts';
import { createDocument } from '../editor-core/document.ts';
import { checkIntegrity } from '../editor-core/ops/versions.ts';
import type { Application, DocumentModel } from '../editor-core/types.ts';

const MAX_BYTES = 4 * 1024 * 1024;   // o Vercel aceita corpos de até 4,5 MB nas funções
const APPS: Application[] = ['DOCUMENT_EDITOR', 'PRESENTATION_EDITOR', 'SPREADSHEET_EDITOR'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Confere tamanho, forma e árvore antes de gravar (o banco nunca recebe documento quebrado). */
export function validDoc(doc: unknown): DocumentModel {
  const d = doc as DocumentModel;
  if (!d || typeof d !== 'object' || !d.document || typeof d.nodes !== 'object') throw new SaveError('Documento inválido.');
  if (!APPS.includes(d.document.application)) throw new SaveError('Aplicação do documento inválida.');
  if (JSON.stringify(d).length > MAX_BYTES) throw new SaveError('Documento grande demais (máx. 4 MB). Imagens grandes devem ir para a biblioteca de mídia.', undefined, 413);
  const problems = checkIntegrity(d);
  if (problems.length) throw new SaveError(`Estrutura do documento com problema: ${problems[0].message}`);
  return d;
}
const notFound = () => new SaveError('Documento não encontrado.', undefined, 404);
const idOk = (id: string) => { if (!UUID.test(id)) throw notFound(); return id; };
const row = (r: { id: string; doc: unknown; version: number; updatedAt: Date }) => ({ id: r.id, doc: r.doc as DocumentModel, version: r.version, updatedAt: r.updatedAt.toISOString() });

export async function listDocuments() {
  const rows = await db().select({ id: s.editorDocuments.id, name: s.editorDocuments.name, application: s.editorDocuments.application, version: s.editorDocuments.version, updatedAt: s.editorDocuments.updatedAt })
    .from(s.editorDocuments).where(isNull(s.editorDocuments.deletedAt)).orderBy(desc(s.editorDocuments.updatedAt)).limit(500);
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export async function createEditorDocument(input: { doc?: unknown; application?: string; name?: string }, owner: string) {
  const doc = input.doc ? validDoc(input.doc) : createDocument((APPS.includes(input.application as Application) ? input.application : 'DOCUMENT_EDITOR') as Application, String(input.name ?? 'Sem título').slice(0, 200));
  const [r] = await db().insert(s.editorDocuments).values({ name: doc.document.name, application: doc.document.application, doc, owner }).returning();
  const withId = { ...doc, document: { ...doc.document, id: r.id } };
  await db().update(s.editorDocuments).set({ doc: withId }).where(eq(s.editorDocuments.id, r.id));
  return row({ ...r, doc: withId });
}

export async function loadEditorDocument(id: string) {
  const [r] = await db().select().from(s.editorDocuments).where(and(eq(s.editorDocuments.id, idOk(id)), isNull(s.editorDocuments.deletedAt)));
  if (!r) throw notFound();
  return row(r);
}

/** Grava se ninguém gravou depois de `baseVersion`; senão devolve a versão atual (conflito, 409). */
export async function saveEditorDocument(id: string, input: { doc: unknown; baseVersion: number; actions?: unknown[] }, login: string) {
  const doc = validDoc(input.doc);
  const [r] = await db().update(s.editorDocuments)
    .set({ doc: { ...doc, document: { ...doc.document, id } }, name: doc.document.name, version: sql`${s.editorDocuments.version} + 1`, updatedAt: new Date() })
    .where(and(eq(s.editorDocuments.id, idOk(id)), eq(s.editorDocuments.version, input.baseVersion), isNull(s.editorDocuments.deletedAt)))
    .returning({ version: s.editorDocuments.version, updatedAt: s.editorDocuments.updatedAt });
  if (!r) return { conflict: true as const, current: await loadEditorDocument(id) };
  const entries = JSON.stringify(input.actions ?? []).length < 1024 * 1024 ? input.actions ?? [] : [{ truncated: true, count: (input.actions ?? []).length }];
  await db().insert(s.editorActions).values({ documentId: id, kind: 'save', version: r.version, entries, login });
  return { conflict: false as const, version: r.version, updatedAt: r.updatedAt.toISOString() };
}

export async function deleteEditorDocument(id: string) {
  const r = await db().update(s.editorDocuments).set({ deletedAt: new Date() }).where(and(eq(s.editorDocuments.id, idOk(id)), isNull(s.editorDocuments.deletedAt))).returning({ id: s.editorDocuments.id });
  if (!r.length) throw notFound();
}

export async function listEditorVersions(id: string) {
  await loadEditorDocument(id);
  const rows = await db().select({ id: s.editorVersions.id, label: s.editorVersions.label, createdAt: s.editorVersions.createdAt, createdBy: s.editorVersions.createdBy })
    .from(s.editorVersions).where(eq(s.editorVersions.documentId, id)).orderBy(desc(s.editorVersions.createdAt)).limit(200);
  return rows.map((v) => ({ id: String(v.id), label: v.label, createdAt: v.createdAt.toISOString(), createdBy: v.createdBy }));
}

export async function createEditorVersion(id: string, input: { label?: string; doc: unknown }, login: string) {
  await loadEditorDocument(id);
  const doc = validDoc(input.doc);
  const [v] = await db().insert(s.editorVersions).values({ documentId: id, label: String(input.label ?? 'Versão').slice(0, 120), doc, createdBy: login }).returning();
  return { id: String(v.id), label: v.label, createdAt: v.createdAt.toISOString(), createdBy: v.createdBy };
}

export async function getEditorVersion(id: string, versionId: string) {
  idOk(id);
  if (!/^\d+$/.test(versionId)) throw new SaveError('Versão não encontrada.', undefined, 404);
  const [v] = await db().select().from(s.editorVersions).where(and(eq(s.editorVersions.documentId, id), eq(s.editorVersions.id, Number(versionId))));
  if (!v) throw new SaveError('Versão não encontrada.', undefined, 404);
  return { info: { id: String(v.id), label: v.label, createdAt: v.createdAt.toISOString(), createdBy: v.createdBy }, doc: v.doc as DocumentModel };
}

/** Relé: grava as transações deste cliente e devolve as dos outros depois de `since` (em ordem). */
export async function syncEditorDocument(id: string, input: { clientId: string; since: number; transactions: unknown[] }, login: string) {
  await loadEditorDocument(id);
  const clientId = String(input.clientId).slice(0, 80);
  if (!Array.isArray(input.transactions) || input.transactions.length > 200) throw new SaveError('Transações demais de uma vez (máx. 200).');
  if (input.transactions.length) await db().insert(s.editorActions).values(input.transactions.map((tx) => ({ documentId: id, kind: 'sync', clientId, entries: tx as object, login })));
  const incoming = await db().select({ seq: s.editorActions.seq, entries: s.editorActions.entries }).from(s.editorActions)
    .where(and(eq(s.editorActions.documentId, id), eq(s.editorActions.kind, 'sync'), gt(s.editorActions.seq, Number(input.since) || 0), ne(s.editorActions.clientId, clientId)))
    .orderBy(s.editorActions.seq).limit(500);
  const [{ top }] = await db().select({ top: max(s.editorActions.seq) }).from(s.editorActions).where(and(eq(s.editorActions.documentId, id), eq(s.editorActions.kind, 'sync')));
  const seq = incoming.length === 500 ? incoming[499].seq : Math.max(Number(input.since) || 0, Number(top ?? 0));
  return { seq, incoming: incoming.map((r) => r.entries) };
}
