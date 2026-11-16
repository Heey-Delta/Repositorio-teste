// Dados fixos do Laboratório Experimental (documento de conceito, seções 3, 5 e 7).
// Departamentos: o `slug` vira a URL (/lab/<slug>/) e o `code` é o prefixo das publicações (EXP-001, FN-001...).

export const LAB_NAME = 'Laboratório Experimental';
export const LAB_TAGLINE = 'Pesquisa · Experimentação · Conhecimento · Exploração';
export const LAB_DESCRIPTION =
  'Laboratório independente de pesquisa, experimentação e exploração criativa do Hallan: experimentos, ensaios, investigações e referências sobre design, tecnologia, percepção e arte digital.';

export const departments = [
  { slug: 'experiments', code: 'EXP', name: 'Experimentos', icon: 'flask',
    short: 'Experimentos visuais, técnicos e conceituais.',
    about: 'O núcleo de criação: conceitos viram experimentos práticos, documentados do conceito à conclusão, inclusive quando a hipótese falha.' },
  { slug: 'field-notes', code: 'FN', name: 'Notas de campo', icon: 'notes',
    short: 'Ensaios, observações, ideias, guias e opiniões.',
    about: 'A revista do laboratório: textos autorais, de reflexões curtas a artigos aprofundados com imagens e referências.' },
  { slug: 'research', code: 'RES', name: 'Pesquisas', icon: 'search',
    short: 'Investigações aprofundadas sobre fenômenos e conceitos.',
    about: 'Investigações sistemáticas, com contexto, método, análise, conclusões e referências bibliográficas.' },
  { slug: 'visual-archive', code: 'VA', name: 'Acervo visual', icon: 'cube',
    short: 'Acervo de referências visuais, materiais e inspirações.',
    about: 'Uma biblioteca visual organizada: cada referência tem origem, observação, tags e ligação com pesquisas e experimentos.' },
  { slug: 'open-lab', code: 'LAB', name: 'Laboratório aberto', icon: 'open',
    short: 'Experiências interativas e ferramentas abertas.',
    about: 'Ferramentas e experiências que o visitante usa no próprio site: geradores, simulações e interfaces experimentais.' },
  { slug: 'observatory', code: 'OBS', name: 'Observatório', icon: 'eye',
    short: 'Tendências, tecnologias emergentes e fenômenos atuais.',
    about: 'Acompanha o que está acontecendo no mundo e transforma acontecimentos em pontos de partida para investigações.' },
] as const;

export type DepartmentSlug = (typeof departments)[number]['slug'];
export const departmentSlugs = departments.map((d) => d.slug) as [DepartmentSlug, ...DepartmentSlug[]];
export const departmentBySlug = (slug: string) => departments.find((d) => d.slug === slug)!;

// Áreas de conhecimento: categorias transversais (uma publicação pode ter mais de uma)
export const areas = [
  { name: 'Cultura visual', about: 'Estética, arte, fotografia e comunicação visual' },
  { name: 'Design digital', about: 'Interfaces, UX, UI e experiências digitais' },
  { name: 'Tecnologia criativa', about: 'IA, programação e tecnologias criativas' },
  { name: 'Comportamento humano', about: 'Psicologia, percepção e comportamento' },
  { name: 'Arte experimental', about: 'Arte generativa, surrealismo e exploração visual' },
  { name: 'Arquitetura e espaço', about: 'Arquitetura, espaço e estruturas' },
  { name: 'Ciência dos materiais', about: 'Materiais, texturas, simulações e propriedades físicas' },
  { name: 'Estudos do futuro', about: 'Tecnologias emergentes e possibilidades futuras' },
] as const;
export const areaNames = areas.map((a) => a.name) as [string, ...string[]];

// Status da pesquisa: estágio de cada publicação
export const statuses = {
  concept: { label: 'Conceito', about: 'Ideia inicial' },
  'in-progress': { label: 'Em andamento', about: 'Em desenvolvimento' },
  active: { label: 'Ativo', about: 'Em investigação' },
  completed: { label: 'Concluído', about: 'Concluído' },
  archived: { label: 'Arquivado', about: 'Arquivado' },
} as const;
export type Status = keyof typeof statuses;

// Formatos das Notas de campo
export const formats = ['Ensaio', 'Observação', 'Ideia', 'Tutorial', 'Opinião'] as const;

// Caminho relativo até a raiz do site, a partir da profundidade da página (os links precisam ser relativos, ver astro.config)
export const up = (depth: number) => (depth === 0 ? './' : '../'.repeat(depth));

// data curta dos artigos (13 nov), no horário de Brasília; o ano só aparece quando não é o atual
const yearSP = (d: Date) => d.toLocaleDateString('pt-BR', { year: 'numeric', timeZone: 'America/Sao_Paulo' });
export const fmtDateShort = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', ...(yearSP(d) === yearSP(new Date()) ? {} : { year: 'numeric' }), timeZone: 'America/Sao_Paulo' }).replace(/\./g, '').replace(/ de /g, ' ');
// palavras do texto, sem blocos de código/dados, endereços de links e marcação
export const countWords = (md: string) => md
  .replace(/```[\s\S]*?```/g, ' ').replace(/\]\([^)]*\)/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/<[^>]+>/g, ' ')
  .split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
// 15000 → 15k palavras · 20000 → 20k · 800 → 0,8k · 17106 → 17,1k
export const fmtWords = (n: number) => `${(Math.round(n / 100) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k palavras`;
export const fmtDate = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
