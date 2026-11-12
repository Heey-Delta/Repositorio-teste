// Respostas da API do admin: JSON, sem cache, e erros de validação apontando o campo
import { z } from 'astro/zod';
import { SaveError } from './posts';

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function readJson(request: Request) {
  try { return await request.json(); } catch { throw new SaveError('Corpo da requisição inválido.'); }
}

export function fail(err: unknown) {
  if (err instanceof z.ZodError) {
    const issue = err.issues[0];
    return json({ error: issue.message, field: issue.path.join('.') }, 400);
  }
  if (err instanceof SaveError) return json({ error: err.message, field: err.field }, err.status);
  console.error(err);
  return json({ error: 'Erro inesperado ao salvar. Tente de novo.' }, 500);
}
