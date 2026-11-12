// Atualiza o site público na hora (novo deploy pelo Deploy Hook)
import type { APIRoute } from 'astro';
import { triggerRebuild } from '../../../lib/rebuild';
import { json } from '../../../lib/api';

export const prerender = false;

export const POST: APIRoute = async ({ locals }) => json({ site: await triggerRebuild(locals.admin!.login, 'manual') });
