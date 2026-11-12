// Biblioteca de mídia: arquivos no Vercel Blob, dados (texto alternativo, legenda, tamanho) na tabela `media`.
// As imagens chegam já otimizadas pelo navegador (WebP, até 2000 px); aqui só conferimos tipo, tamanho e o texto alternativo.
import { put } from '@vercel/blob';
import { desc, eq, inArray } from 'drizzle-orm';
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

export async function mediaUsage(ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await db().select({ id: s.posts.coverMediaId }).from(s.posts).where(inArray(s.posts.coverMediaId, ids));
  const m = new Map<string, number>();
  for (const r of rows) if (r.id) m.set(r.id, (m.get(r.id) ?? 0) + 1);
  return m;
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
