// Próximo código editorial livre de um departamento
import type { APIRoute } from 'astro';
import { nextCode } from '../../../lib/posts';
import { json } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => json({ code: await nextCode(Number(url.searchParams.get('departmentId'))) });
