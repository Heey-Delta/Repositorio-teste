// Relé da colaboração: recebe as transações de um cliente e devolve as dos outros, em ordem
import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, json, readJson } from '../../../../../lib/api';
import { syncEditorDocument } from '../../../../../lib/editor-docs';

export const prerender = false;
const body = z.object({ clientId: z.string().min(1).max(80), since: z.number().int().min(0), transactions: z.array(z.unknown()).max(200) });

export const POST: APIRoute = async ({ params, request, locals }) => {
  try { return json(await syncEditorDocument(params.id!, body.parse(await readJson(request)), locals.admin!.login)); } catch (err) { return fail(err); }
};
