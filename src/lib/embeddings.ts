// Busca por significado: cada publicação e volume vira um vetor (embedding) guardado no Postgres (pgvector).
// Os vetores vêm do AI Gateway da Vercel (modelo openai/text-embedding-3-small, 512 dimensões), autenticado pelo
// token OIDC que a própria Vercel entrega ao site: sem chave de API para guardar. Fora da Vercel, AI_GATEWAY_API_KEY.
// Se o gateway não responder, nada quebra: a busca continua por palavras, tags e sinônimos (src/lib/lab-search.ts).
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as s from '../db/schema.ts';

export const EMBED_MODEL = 'openai/text-embedding-3-small';
export const EMBED_DIM = 512;
type AnyDb = any;   // neon-http no site, node-postgres nos testes

async function gatewayToken(): Promise<string | null> {
  if (process.env.AI_GATEWAY_API_KEY) return process.env.AI_GATEWAY_API_KEY;
  try { const { getVercelOidcToken } = await import('@vercel/oidc'); return await getVercelOidcToken(); } catch { return process.env.VERCEL_OIDC_TOKEN ?? null; }
}

/** Vetores de vários textos. `null` quando o gateway não está disponível (a busca cai para palavras). */
export async function embed(texts: string[], timeoutMs = 8000): Promise<number[][] | null> {
  if (!texts.length) return [];
  if (process.env.EMBED_FAKE === '1') return texts.map(fakeEmbedding);   // testes locais, sem rede
  const token = await gatewayToken();
  if (!token) return null;
  try {
    const res = await fetch('https://ai-gateway.vercel.sh/v1/embeddings', {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts, dimensions: EMBED_DIM }),
    });
    if (!res.ok) { console.warn('[busca] AI Gateway respondeu', res.status, (await res.text()).slice(0, 200)); return null; }
    const out = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return out.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  } catch (err) {
    console.warn('[busca] AI Gateway indisponível:', (err as Error).message);
    return null;
  }
}

/** Vetor determinístico por trigramas de letras: só para testes locais (EMBED_FAKE=1). */
export function fakeEmbedding(text: string): number[] {
  const v = new Array(EMBED_DIM).fill(0);
  const t = ` ${fold(text)} `;
  for (let i = 0; i < t.length - 2; i++) { let h = 0; for (const ch of t.slice(i, i + 3)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; v[h % EMBED_DIM] += 1; }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
export const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Texto que representa uma publicação: título e resumo pesam mais; o corpo entra sem marcação nem blocos. */
export function postText(p: { title: string; summary: string; tags: string[]; areas?: string[]; department?: string; body: string }) {
  const body = p.body
    .replace(/^ {0,3}:::\w+.*:::\s*$/gm, ' ')                    // blocos ricos (gráficos, slides…)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ').replace(/[#>*_`|~-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [p.title, p.title, p.summary, p.tags.join(', '), (p.areas ?? []).join(', '), p.department ?? '', body.slice(0, 6000)].filter(Boolean).join('\n');
}
export function volumeText(v: { title: string; summary: string; posts: string[] }) {
  return [v.title, v.title, v.summary, `Artigos: ${v.posts.join('; ')}`].filter(Boolean).join('\n');
}
const hashOf = (text: string) => createHash('sha256').update(`${EMBED_MODEL}:${EMBED_DIM}:${text}`).digest('hex');

/** Grava os vetores que mudaram (compara o hash do texto). Devolve quantos foram (re)calculados ou null sem gateway. */
export async function upsertVectors(db: AnyDb, items: { kind: 'post' | 'volume'; refId: string; text: string }[]) {
  if (!items.length) return 0;
  const hashes = items.map((i) => ({ ...i, hash: hashOf(i.text) }));
  const kinds = [...new Set(items.map((i) => i.kind))];
  const have = await db.select({ kind: s.searchVectors.kind, refId: s.searchVectors.refId, hash: s.searchVectors.hash }).from(s.searchVectors)
    .where(and(inArray(s.searchVectors.kind, kinds), inArray(s.searchVectors.refId, items.map((i) => i.refId))));
  const known = new Map(have.map((h: { kind: string; refId: string; hash: string }) => [`${h.kind}:${h.refId}`, h.hash]));
  const todo = hashes.filter((i) => known.get(`${i.kind}:${i.refId}`) !== i.hash);
  let done = 0;
  for (let k = 0; k < todo.length; k += 64) {
    const part = todo.slice(k, k + 64);
    const vecs = await embed(part.map((i) => i.text), part.length > 1 ? 20000 : 8000);
    if (!vecs) return done ? done : null;
    for (let j = 0; j < part.length; j++) {
      const row = { kind: part[j].kind, refId: part[j].refId, hash: part[j].hash, model: EMBED_MODEL, embedding: vecs[j], updatedAt: new Date() };
      await db.insert(s.searchVectors).values(row).onConflictDoUpdate({ target: [s.searchVectors.kind, s.searchVectors.refId], set: row });
      done++;
    }
  }
  return done;
}
export async function removeVectors(db: AnyDb, kind: 'post' | 'volume', refIds: string[]) {
  if (refIds.length) await db.delete(s.searchVectors).where(and(eq(s.searchVectors.kind, kind), inArray(s.searchVectors.refId, refIds)));
}
/** Os mais parecidos com o vetor da pergunta (similaridade de cosseno, 1 = igual). */
export async function nearest(db: AnyDb, vec: number[], limit = 40): Promise<{ kind: string; refId: string; sim: number }[]> {
  const v = `[${vec.join(',')}]`;
  const dist = sql<number>`${s.searchVectors.embedding} <=> ${v}::vector`;
  const rows = await db.select({ kind: s.searchVectors.kind, refId: s.searchVectors.refId, dist }).from(s.searchVectors).orderBy(dist).limit(limit);
  return rows.map((r: { kind: string; refId: string; dist: number | string }) => ({ kind: r.kind, refId: r.refId, sim: 1 - Number(r.dist) }));
}
