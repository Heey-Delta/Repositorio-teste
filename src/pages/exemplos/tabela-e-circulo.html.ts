// Exemplo público de uma publicação feita no editor (tabela com fórmulas + círculo).
// Gerada no build a partir de docs/editor/exemplos/*.json pelo próprio exportador HTML do motor.
// Fora do Google (noindex) e fora do sitemap: é só para ver como o conteúdo do editor fica no site.
import type { APIRoute } from 'astro';
import data from '../../../docs/editor/exemplos/publicacao-tabela-circulo.json';
import { createEngine, exportDocument } from '../../editor-core/index.ts';
import type { DocumentModel } from '../../editor-core/types.ts';

export const prerender = true;

export const GET: APIRoute = () => {
  const e = createEngine((data as { document: DocumentModel }).document);
  const html = String(exportDocument(e, 'HTML').data)
    .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex, nofollow">');
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};
