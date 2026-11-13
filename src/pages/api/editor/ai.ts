// Assistente do editor (Documentos, Apresentações e Planilhas): reescrever, resumir, expandir, mudar o tom,
// corrigir, traduzir, gerar ideias/estrutura/slides, responder sobre o documento e criar ou explicar fórmulas.
// A chave fica só no servidor (ANTHROPIC_API_KEY nas variáveis de ambiente da Vercel); sem ela, responde 503.
import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'astro/zod';
import { fail, json, readJson } from '../../../lib/api';

export const prerender = false;

const ACTIONS = {
  rewrite: 'Reescreva o texto deixando-o mais claro e fluente, sem mudar o sentido.',
  summarize: 'Resuma o texto em poucos parágrafos curtos.',
  expand: 'Desenvolva o texto com mais detalhes e exemplos, mantendo o estilo.',
  tone: 'Reescreva o texto no tom pedido na instrução.',
  grammar: 'Corrija ortografia, gramática e pontuação. Mude o mínimo possível.',
  translate: 'Traduza o texto para o idioma pedido na instrução (padrão: inglês).',
  ideas: 'Sugira ideias sobre o tema, em lista curta.',
  outline: 'Proponha a estrutura de um documento sobre o tema: títulos e subtítulos em lista com recuo.',
  titles: 'Sugira 5 títulos para o texto, um por linha.',
  slides: 'Transforme o texto em uma apresentação: para cada slide, uma linha "## Título" seguida de 3 a 5 tópicos curtos com "- ".',
  notes: 'Escreva as anotações do apresentador (o que falar) para o conteúdo do slide.',
  ask: 'Responda à pergunta da instrução usando só o conteúdo do documento. Se a resposta não estiver nele, diga isso.',
  formula: 'Escreva uma fórmula de planilha em português (Excel/LibreOffice pt-BR, separador ";") que faça o que a instrução pede. Responda só com a fórmula começando com "=", e na linha seguinte uma explicação de uma frase.',
  explain_formula: 'Explique em linguagem simples o que a fórmula faz, passo a passo, em poucas linhas.',
  analyze: 'Analise os dados: tendências, padrões, valores fora do comum e uma sugestão de gráfico. Seja breve e concreto.',
} as const;

const body = z.object({
  action: z.enum(Object.keys(ACTIONS) as [keyof typeof ACTIONS, ...(keyof typeof ACTIONS)[]]),
  text: z.string().max(60_000).default(''),
  instruction: z.string().max(2_000).optional(),
  context: z.string().max(120_000).optional(),
});

const SYSTEM = [
  'Você é o assistente de escrita e de dados de um editor de documentos, apresentações e planilhas em português do Brasil.',
  'Responda sempre em português do Brasil (a não ser que a tarefa seja traduzir).',
  'Devolva apenas o resultado pronto para inserir no documento: sem saudação, sem comentários sobre o que fez.',
  'Use Markdown simples (títulos com #, listas com -) só quando a tarefa pedir estrutura.',
].join(' ');

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!import.meta.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      return json({ error: 'O assistente ainda não foi configurado: falta a variável ANTHROPIC_API_KEY no projeto da Vercel.' }, 503);
    }
    const p = body.parse(await readJson(request));
    const client = new Anthropic({ apiKey: import.meta.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY });
    const parts = [
      `Tarefa: ${ACTIONS[p.action]}`,
      p.instruction ? `Instrução: ${p.instruction}` : '',
      p.context ? `<documento>\n${p.context}\n</documento>` : '',
      p.text ? `<texto>\n${p.text}\n</texto>` : '',
    ].filter(Boolean);
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'low' },
      // se um pedido for recusado pelos filtros, a própria API tenta de novo num modelo alternativo
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: parts.join('\n\n') }],
    });
    if (response.stop_reason === 'refusal') return json({ error: 'O assistente não pôde atender a esse pedido.' }, 422);
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    return json({ text, truncated: response.stop_reason === 'max_tokens' });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'Muitos pedidos ao assistente agora. Tente de novo em instantes.' }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'A chave do assistente (ANTHROPIC_API_KEY) não é válida.' }, 503);
    if (err instanceof Anthropic.APIError) return json({ error: `O assistente falhou (${err.status ?? 'rede'}).` }, 502);
    return fail(err);
  }
};
