// Biblioteca de mídia: arquivos no Vercel Blob, dados (texto alternativo, legenda, tamanho) na tabela `media`.
// As imagens chegam já otimizadas pelo navegador (WebP, até 2000 px); aqui só conferimos tipo, tamanho e o texto alternativo.
import { put, del } from '@vercel/blob';
import { desc, eq } from 'drizzle-orm';
import { db, schema as s } from '../db/client';
import { SaveError, slugify } from './posts';

export const MAX_BYTES = 4 * 1024 * 1024;   // as funções do Vercel aceitam até 4,5 MB por requisição

// Tipo real do arquivo pelos primeiros bytes (não confia na extensão nem no que o navegador declarou).
// SVG fica de fora de propósito: pode carregar script.
function sniff(b: Uint8Array): { mime: string; kind: 'image' | 'pdf' } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', kind: 'image' };
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return { mime: 'image/png', kind: 'image' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', kind: 'image' };
  if (ascii(0, 4) === 'GIF8') return { mime: 'image/gif', kind: 'image' };
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return { mime: 'image/avif', kind: 'image' };
  if (ascii(0, 5) === '%PDF-') return { mime: 'application/pdf', kind: 'pdf' };
  return null;
}

export async function uploadMedia(opts: { file: File; alt: string; caption: string; width: number | null; height: number | null; login: string }) {
  const { file, login } = opts;
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new SaveError('O armazenamento de arquivos ainda não está ligado a este ambiente.', undefined, 503);
  if (file.size === 0) throw new SaveError('O arquivo está vazio.');
  if (file.size > MAX_BYTES) throw new SaveError('Arquivo acima de 4 MB. Para imagens, o próprio admin reduz antes de enviar; PDFs precisam ser menores.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes.subarray(0, 16));
  if (!type) throw new SaveError('Formato não aceito. Use JPG, PNG, WebP, AVIF, GIF ou PDF.');
  const alt = opts.alt.trim(), caption = opts.caption.trim();
  if (type.kind === 'image' && alt.length < 3) throw new SaveError('Descreva a imagem no texto alternativo (quem não enxerga a imagem e o Google leem esse texto).', 'alt');
  if (alt.length > 300 || caption.length > 500) throw new SaveError('Texto alternativo até 300 caracteres e legenda até 500.');

  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'application/pdf': 'pdf' }[type.mime];
  const base = slugify(file.name.replace(/\.[a-z0-9]+$/i, '')) || 'arquivo';
  const now = new Date();
  const blob = await put(`lab/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${base}.${ext}`, Buffer.from(bytes), {
    access: 'public', addRandomSuffix: true, contentType: type.mime, cacheControlMaxAge: 31536000,
  });
  const dim = (n: number | null) => (n && Number.isFinite(n) && n > 0 && n < 20000 ? Math.round(n) : null);
  const [row] = await db().insert(s.media).values({
    url: blob.url, pathname: blob.pathname, kind: type.kind, mime: type.mime, size: bytes.length,
    width: dim(opts.width), height: dim(opts.height), alt: alt || null, caption: caption || null,
  }).returning();
  await db().insert(s.adminLog).values({ login, action: 'media.upload', target: row.id });
  return row;
}

export function listMedia(limit = 60) {
  return db().select().from(s.media).orderBy(desc(s.media.createdAt)).limit(limit);
}

// Onde cada arquivo é usado: capa, imagem de compartilhamento, anexo ou dentro do texto de alguma publicação
export async function mediaUsage(items: { id: string; url: string }[]) {
  const usage = new Map<string, string[]>();
  if (!items.length) return usage;
  const [posts, seo, att] = await Promise.all([
    db().select({ id: s.posts.id, title: s.posts.title, cover: s.posts.coverMediaId, body: s.posts.body }).from(s.posts),
    db().select({ postId: s.seoMetadata.postId, og: s.seoMetadata.ogMediaId }).from(s.seoMetadata),
    db().select({ postId: s.postMedia.postId, mediaId: s.postMedia.mediaId }).from(s.postMedia),
  ]);
  const title = new Map(posts.map((p) => [p.id, p.title || 'Sem título']));
  for (const m of items) {
    const where = new Set<string>();
    for (const p of posts) {
      if (p.cover === m.id) where.add(`capa de "${p.title || 'Sem título'}"`);
      else if (p.body.includes(m.url)) where.add(`texto de "${p.title || 'Sem título'}"`);
    }
    for (const r of seo) if (r.og === m.id) where.add(`compartilhamento de "${title.get(r.postId)}"`);
    for (const r of att) if (r.mediaId === m.id) where.add(`anexo de "${title.get(r.postId)}"`);
    if (where.size) usage.set(m.id, [...where]);
  }
  return usage;
}

// Exclui só o que não está em uso, para nenhuma página ficar com imagem ou link quebrado
export async function deleteMedia(id: string, login: string) {
  const [m] = await db().select().from(s.media).where(eq(s.media.id, id));
  if (!m) throw new SaveError('Arquivo não encontrado.', undefined, 404);
  const used = (await mediaUsage([m])).get(id);
  if (used) throw new SaveError(`Esse arquivo está em uso (${used.join(', ')}). Tire de lá antes de excluir.`, undefined, 409);
  await del(m.url);
  await db().batch([
    db().delete(s.media).where(eq(s.media.id, id)),
    db().insert(s.adminLog).values({ login, action: 'media.delete', target: m.pathname }),
  ]);
  return { ok: true };
}

export async function updateMedia(id: string, data: { alt: string; caption: string }, login: string) {
  const alt = data.alt.trim(), caption = data.caption.trim();
  const [cur] = await db().select().from(s.media).where(eq(s.media.id, id));
  if (!cur) throw new SaveError('Arquivo não encontrado.', undefined, 404);
  if (cur.kind === 'image' && alt.length < 3) throw new SaveError('O texto alternativo é obrigatório nas imagens.', 'alt');
  if (alt.length > 300 || caption.length > 500) throw new SaveError('Texto alternativo até 300 caracteres e legenda até 500.');
  const [row] = await db().update(s.media).set({ alt: alt || null, caption: caption || null }).where(eq(s.media.id, id)).returning();
  await db().insert(s.adminLog).values({ login, action: 'media.update', target: id });
  return row;
}
