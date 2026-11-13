// Sinônimos e siglas da busca do Lab (valem mesmo sem o gateway de vetores): IA = inteligência artificial,
// cérebro ≈ neurônios, etc. Cada grupo é um conjunto de palavras equivalentes, sem acento e em minúsculas.
export const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const GROUPS = [
  ['ia', 'inteligencia artificial', 'ai', 'aprendizado de maquina', 'machine learning', 'rede neural', 'redes neurais', 'modelo de linguagem', 'llm', 'gpt'],
  ['cerebro', 'neuronio', 'neuronios', 'neural', 'neurociencia', 'cognicao', 'cognitivo', 'mente', 'memoria'],
  ['3d', 'tridimensional', 'webgl', 'modelagem', 'render', 'shader', 'shaders'],
  ['ux', 'experiencia do usuario', 'usabilidade'],
  ['ui', 'interface', 'interfaces', 'tela', 'telas'],
  ['cor', 'cores', 'paleta', 'paletas'],
  ['tipografia', 'fonte', 'fontes', 'letra', 'letras'],
  ['som', 'audio', 'musica', 'sonoro'],
  ['desempenho', 'performance', 'velocidade', 'otimizacao', 'lento', 'rapido'],
  ['percepcao', 'visao', 'olhar', 'atencao'],
  ['arquitetura', 'espaco', 'espacos', 'construcao', 'brutalismo'],
];
/** Termos da pergunta + sinônimos do mesmo grupo. */
export function expand(q: string) {
  const f = fold(q);
  const terms = new Set(f.split(/[^a-z0-9#]+/).filter((t) => t.length > 1 || /\d/.test(t)));
  for (const g of GROUPS) if (g.some((w) => (w.includes(' ') ? f.includes(w) : terms.has(w)))) g.forEach((w) => terms.add(w));
  return [...terms];
}

