// Configurações da página inicial editáveis no admin (/admin/inicio/): seções escondidas, stacks (as bolinhas),
// cursos e os volumes em destaque ao lado da cidade. Ficam na tabela site_settings; sem nada salvo, valem os padrões abaixo.
// Salvar gera o site de novo (a página inicial é estática).
import { z } from 'astro/zod';
import { inArray } from 'drizzle-orm';
import { db, schema as s } from '../db/client';
import { triggerRebuild } from './rebuild';

export const stackInput = z.object({
  name: z.string().trim().min(1, 'Toda stack precisa de um nome.').max(40),
  kind: z.string().trim().max(30).default(''),
  desc: z.string().trim().max(200).default(''),
  use: z.string().trim().max(200).default(''),
  icon: z.string().trim().max(4000).default(''),
});
export const courseInput = z.object({
  name: z.string().trim().min(1, 'Todo curso precisa de um nome.').max(80),
  school: z.string().trim().max(80).default(''),
  year: z.string().trim().max(30).default(''),
  icon: z.string().trim().max(4000).default(''),
  color: z.string().trim().max(7).default(''),
});
/** Seções da página inicial, na ordem em que aparecem (o topo não pode ser escondido). */
export const SECTIONS = [
  { id: 'works', name: 'Trabalhos', about: 'A cidade 3D, os projetos e os volumes em destaque.' },
  { id: 'metrics', name: 'Métricas', about: 'Registros, raios e a atividade por dia.' },
  { id: 'lab', name: 'Laboratório', about: 'O card amarelo que leva ao laboratório.' },
  { id: 'stacks', name: 'Ferramentas & Cursos', about: 'As bolinhas das ferramentas e a lista de cursos.' },
  { id: 'about', name: 'Sobre', about: '"Cada página precisa dizer em 5 segundos o que você faz."' },
  { id: 'services', name: 'Serviços', about: 'Os três combos.' },
  { id: 'process', name: 'Processo', about: 'Os slides das cinco etapas.' },
  { id: 'faq', name: 'Dúvidas', about: 'As perguntas frequentes.' },
  { id: 'contact', name: 'Contato', about: 'O formulário e o e-mail.' },
] as const;
export type SectionId = (typeof SECTIONS)[number]['id'];
const sectionIds = SECTIONS.map((s) => s.id) as [SectionId, ...SectionId[]];

export const homeInput = z.object({
  stacks: z.array(stackInput).max(40),
  courses: z.array(courseInput).max(60),
  featuredVolumes: z.array(z.uuid()).max(30),
  hidden: z.array(z.enum(sectionIds)).max(20).default([]),
});
export type HomeSettings = z.infer<typeof homeInput>;

const SANTANDER = 'M12.3 1.5c.5 2 2.6 3.4 3.2 5.6.4 1.3.2 2.6-.4 3.7 2.8.7 6.4 2.4 6.4 5.4 0 3.7-4.4 5.3-9.5 5.3S2.5 19.9 2.5 16.2c0-3 3.6-4.7 6.4-5.4-.3 1.1-.1 2.2.5 3 .1-1.6 1-2.8 2.1-4.2 1.4-1.7 1.9-3.6.8-8.1z';
export const DEFAULTS: HomeSettings = {
  stacks: [
    { icon: 'astro', name: 'Astro', kind: 'Framework', desc: 'Gera sites estáticos rápidos, mandando só o JavaScript que a página precisa.', use: 'Base deste site: páginas, componentes e o build.' },
    { icon: 'tailwindcss', name: 'Tailwind CSS', kind: 'Estilo', desc: 'CSS com classes utilitárias, direto no HTML, sem arquivos de estilo gigantes.', use: 'Todo o visual brutalista do site e dos projetos.' },
    { icon: 'threedotjs', name: 'Three.js', kind: '3D', desc: 'Biblioteca de 3D em WebGL para criar cenas interativas no navegador.', use: 'A cidade isométrica do Fly Presentations: modelos, luz, sombras e animações.' },
    { icon: 'javascript', name: 'JavaScript', kind: 'Linguagem', desc: 'A linguagem da web: interações, animações e lógica no navegador.', use: 'Interações, física destas bolinhas e os widgets.' },
    { icon: 'typescript', name: 'TypeScript', kind: 'Linguagem', desc: 'JavaScript com tipos, para código mais seguro e fácil de manter.', use: 'Componentes e projetos maiores.' },
    { icon: 'html5', name: 'HTML', kind: 'Estrutura', desc: 'A estrutura de toda página: conteúdo, semântica e acessibilidade.', use: 'Marcação semântica e acessível em todos os projetos.' },
    { icon: 'css3', name: 'CSS', kind: 'Estilo', desc: 'Layout, cores, tipografia e animações das páginas.', use: 'Animações, glitch, glassmorphism e responsividade.' },
    { icon: 'figma', name: 'Figma', kind: 'Design', desc: 'Ferramenta de design de interfaces, protótipos e design systems.', use: 'Wireframes e layouts antes do código.' },
    { icon: 'git', name: 'Git', kind: 'Versionamento', desc: 'Controle de versões: histórico, ramificações e trabalho em equipe.', use: 'Todo projeto versionado no GitHub.' },
  ],
  courses: [
    { name: 'Storytelling para marketing digital', school: 'Santander', year: 'out. 2026', icon: SANTANDER, color: '#EC0000' },
    { name: 'Claude Platform 101', school: 'Anthropic · Claude Academy', year: 'set. 2026', icon: 'claude', color: '' },
    { name: 'Introduction to Claude Cowork', school: 'Anthropic · Claude Academy', year: 'set. 2026', icon: 'claude', color: '' },
    { name: 'Claude Code 101', school: 'Anthropic · Claude Academy', year: 'set. 2026', icon: 'claude', color: '' },
    { name: 'AI Capabilities and Limitations', school: 'Anthropic · Claude Academy', year: 'set. 2026', icon: 'claude', color: '' },
    { name: 'Claude 101', school: 'Anthropic · Claude Academy', year: 'set. 2026', icon: 'claude', color: '' },
  ],
  featuredVolumes: [],
  hidden: [],
};
const KEYS = { stacks: 'home.stacks', courses: 'home.courses', featuredVolumes: 'home.featuredVolumes', hidden: 'home.hidden' } as const;

/** Configurações salvas (ou os padrões). Sem banco (build local), devolve os padrões. */
export async function getHomeSettings(): Promise<HomeSettings> {
  if (!process.env.DATABASE_URL) return DEFAULTS;
  try {
    const rows = await db().select().from(s.siteSettings).where(inArray(s.siteSettings.key, Object.values(KEYS)));
    const get = <T,>(k: string, d: T) => (rows.find((r) => r.key === k)?.value as T | undefined) ?? d;
    return { stacks: get(KEYS.stacks, DEFAULTS.stacks), courses: get(KEYS.courses, DEFAULTS.courses), featuredVolumes: get(KEYS.featuredVolumes, DEFAULTS.featuredVolumes), hidden: get(KEYS.hidden, DEFAULTS.hidden) };
  } catch (err) {
    console.warn('[inicio] configurações não lidas, usando os padrões:', (err as Error).message);
    return DEFAULTS;
  }
}

export async function saveHomeSettings(raw: unknown, login: string) {
  const input = homeInput.parse(raw);
  const now = new Date();
  const ops = (Object.keys(KEYS) as (keyof typeof KEYS)[]).map((k) => db().insert(s.siteSettings).values({ key: KEYS[k], value: input[k], updatedAt: now })
    .onConflictDoUpdate({ target: s.siteSettings.key, set: { value: input[k], updatedAt: now } }));
  await db().batch([...ops, db().insert(s.adminLog).values({ login, action: 'home.save', target: 'inicio' })] as any);
  return { updatedAt: now.toISOString(), site: await triggerRebuild(login, 'página inicial') };
}
