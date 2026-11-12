// Uma versão salva da publicação (cópia completa), para comparar no editor
import type { APIRoute } from 'astro';
import { revisionSnapshot } from '../../../../../lib/posts';
import { json } from '../../../../../lib/api';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const rev = await revisionSnapshot(params.id!, Number(params.rev));
  if (!rev) return json({ error: 'Versão não encontrada.' }, 404);
  return json({ id: rev.id, snapshot: rev.snapshot, createdAt: rev.createdAt, note: rev.note, login: rev.login });
};
