// Envio (POST, multipart) e lista (GET) da biblioteca de mídia
import type { APIRoute } from 'astro';
import { listMedia, uploadMedia } from '../../../lib/media';
import { SaveError } from '../../../lib/posts';
import { fail, json } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = async () => json({ media: await listMedia() });

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const form = await request.formData().catch(() => { throw new SaveError('Envio inválido.'); });
    const file = form.get('file');
    if (!(file instanceof File)) throw new SaveError('Escolha um arquivo.');
    const num = (k: string) => (form.get(k) ? Number(form.get(k)) : null);
    const media = await uploadMedia({
      file, alt: String(form.get('alt') ?? ''), caption: String(form.get('caption') ?? ''),
      width: num('width'), height: num('height'), login: locals.admin!.login,
    });
    return json({ media }, 201);
  } catch (err) { return fail(err); }
};
