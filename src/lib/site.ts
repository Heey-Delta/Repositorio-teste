// Dados do site principal usados em mais de um lugar: serviços, combos e perguntas frequentes
// (seções da home e dados estruturados para o Google).
export const services = [
  { name: 'Web Design', desc: 'Desenho cada página no Figma, pensando primeiro em quem abre pelo celular.', how: 'Começo pela estrutura e pelo texto, mostro para você aprovar e só depois desenho o visual final.' },
  { name: 'Desenvolvimento Web', desc: 'Transformo o layout num site de verdade: leve, rápido e fácil de achar no Google.', how: 'Uso Astro, Tailwind e JavaScript e entrego o site publicado, pronto para atualizar.' },
  { name: 'Landing Pages', desc: 'Uma página só, com uma oferta clara e um jeito fácil de falar com você.', how: 'Ideal para lançar um produto, um serviço ou uma campanha, pensando em quem chega pelo anúncio.' },
  { name: 'E-commerce', desc: 'Sua loja virtual com catálogo, carrinho e pagamento.', how: 'Cuido do cadastro dos produtos até o checkout, com a compra pensada para o celular.' },
  { name: 'Creative Dev', desc: '3D, animações e interações que fazem o seu site ficar na memória.', how: 'Como a cidade em 3D desta página, feita com Three.js.' },
  { name: 'Branding Digital', desc: 'Logo, cores e tipografia que dão cara própria à sua marca.', how: 'Cada site da cidade tem uma identidade visual própria, criada do zero.' },
];

/**
 * Serviços organizados em 3 combos (seção Serviços da home). `items` usa os nomes da lista acima.
 * `deadline` e `price`: quando preenchidos (ex.: '2 a 3 semanas', 'a partir de R$ 1.500'), aparecem no card;
 * vazios, o card mostra que o prazo e o valor vão na proposta.
 */
export const combos = [
  {
    name: 'Presença', for: 'Profissionais, prestadores de serviço e quem está lançando algo novo.',
    pitch: 'Uma página que conta em poucos segundos o que você faz e transforma visita em conversa.',
    items: ['Web Design', 'Desenvolvimento Web', 'Landing Pages'],
    gets: ['Estrutura e textos da página, escritos junto com você', 'Layout para celular e computador', 'Botão de contato direto, por WhatsApp ou formulário', 'Site publicado no seu domínio, com SEO técnico', 'Ferramenta de análise de visitas configurada'],
    deadline: '', price: '',
  },
  {
    name: 'Loja', for: 'Negócios que querem vender os seus produtos pela internet.',
    pitch: 'Sua loja virtual com catálogo, carrinho e pagamento, pensada para quem compra pelo celular.',
    items: ['Web Design', 'Desenvolvimento Web', 'E-commerce', 'Branding Digital'],
    gets: ['Catálogo organizado por categorias', 'Páginas de produto que ajudam a vender', 'Carrinho e pagamento on-line', 'Sua marca aplicada em toda a loja', 'Explicação de como cadastrar e editar produtos'],
    deadline: '', price: '',
  },
  {
    name: 'Experiência', for: 'Marcas que querem ser lembradas e se diferenciar da concorrência.',
    pitch: 'Uma identidade visual completa e um site com 3D e animações que as pessoas não esquecem.',
    items: ['Branding Digital', 'Web Design', 'Desenvolvimento Web', 'Creative Dev'],
    gets: ['Logo, paleta de cores e tipografia', 'Guia simples de uso da marca', 'Site com cenas em 3D e animações', 'Versão leve e rápida para o celular', 'Marca aplicada também nas redes sociais'],
    deadline: '', price: '',
  },
];

/** O que vale para todos os combos (faixa embaixo dos cards). */
export const promises = [
  { title: 'Uma pessoa só', text: 'Quem desenha é quem programa. Nada se perde no meio do caminho.' },
  { title: 'Você aprova tudo', text: 'Cada etapa só avança depois do seu ok.' },
  { title: 'Proposta fechada', text: 'Valor, prazo e o que está incluso por escrito, antes de começar.' },
  { title: 'Site no ar', text: 'Entrego publicado, rápido e pronto para aparecer no Google.' },
];

/** Perguntas frequentes (seção Dúvidas da home e FAQPage nos dados estruturados). */
export const faq = [
  { q: 'Quanto custa um site?', a: 'Depende do combo e do tamanho do projeto. Depois de uma conversa rápida, eu mando uma proposta fechada com o valor total, o que está incluso e as etapas. Sem surpresa no meio do caminho.' },
  { q: 'Quanto tempo leva?', a: 'Varia com o combo e com a quantidade de páginas. O prazo de cada etapa vai escrito na proposta, antes de a gente começar.' },
  { q: 'Preciso ter os textos e as fotos prontos?', a: 'Não. Na etapa de estratégia eu ajudo a organizar e escrever os textos. Se você tiver fotos, eu uso; se não tiver, sugiro caminhos que cabem no seu orçamento.' },
  { q: 'Meu site vai aparecer no Google?', a: 'Construo cada site com as boas práticas de SEO técnico: páginas rápidas, títulos e descrições certos e dados estruturados. Chegar ao topo também depende de conteúdo e de tempo, e eu explico isso com sinceridade.' },
  { q: 'Vou conseguir atualizar o site sozinho?', a: 'Vai. Na entrega eu mostro, com calma, como mudar textos, fotos e produtos.' },
  { q: 'E depois que o site estiver no ar?', a: 'A gente combina o que fizer sentido para você: ajustes pontuais, novas páginas ou um acompanhamento mensal. Isso também fica claro na proposta.' },
];
