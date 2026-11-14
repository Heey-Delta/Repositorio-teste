// Dados do site principal usados em mais de um lugar: serviços, combos e perguntas frequentes
// (seções da home e dados estruturados para o Google).
export const services = [
  { name: 'Web Design', plain: 'É o desenho das páginas: onde fica cada coisa, as cores, as letras e as imagens.', desc: 'Desenho cada página no Figma, pensando primeiro em quem abre pelo celular.', how: 'Começo pela estrutura e pelo texto, mostro para você aprovar e só depois desenho o visual final.' },
  { name: 'Desenvolvimento Web', plain: 'É transformar o desenho num site que funciona de verdade, abre rápido e aparece no Google.', desc: 'Transformo o layout num site de verdade: leve, rápido e fácil de achar no Google.', how: 'Uso Astro, Tailwind e JavaScript e entrego o site publicado, pronto para atualizar.' },
  { name: 'Landing Pages', plain: 'É uma página única, feita para uma coisa só: fazer a pessoa te chamar ou comprar.', desc: 'Uma página só, com uma oferta clara e um jeito fácil de falar com você.', how: 'Ideal para lançar um produto, um serviço ou uma campanha, pensando em quem chega pelo anúncio.' },
  { name: 'E-commerce', plain: 'É a loja virtual: o cliente escolhe o produto, coloca no carrinho e paga pelo próprio site.', desc: 'Sua loja virtual com catálogo, carrinho e pagamento.', how: 'Cuido do cadastro dos produtos até o checkout, com a compra pensada para o celular.' },
  { name: 'Creative Dev', plain: 'São as animações e os detalhes interativos que dão vida e personalidade ao site.', desc: 'Animações e interações que fazem o seu site ficar na memória.', how: 'Como os detalhes animados desta página.' },
  { name: 'Branding Digital', plain: 'É a identidade da sua marca: logo, cores e o jeito de ela se apresentar.', desc: 'Logo, cores e tipografia que dão cara própria à sua marca.', how: 'Cada site da cidade tem uma identidade visual própria, criada do zero.' },
];

/**
 * Serviços organizados em 3 combos (seção Serviços da home). `items` usa os nomes da lista acima.
 * `deadline` e `price`: quando preenchidos (ex.: '2 a 3 semanas', 'a partir de R$ 1.500'), aparecem no card;
 * vazios, o card mostra que o prazo e o valor vão na proposta.
 */
export const combos = [
  {
    name: 'Presença', for: 'quem trabalha por conta própria, presta serviços ou está começando algo novo.',
    pitch: 'O seu endereço na internet. Uma página simples, que explica de um jeito claro o que você faz e deixa fácil para o cliente te chamar.',
    items: ['Web Design', 'Desenvolvimento Web', 'Landing Pages'],
    gets: ['Estrutura e textos da página, escritos junto com você', 'Layout para celular e computador', 'Botão de contato direto, por WhatsApp ou formulário', 'Site publicado no seu domínio, com SEO técnico', 'Ferramenta de análise de visitas configurada'],
    deadline: '', price: '',
  },
  {
    name: 'Loja', for: 'quem já vende, ou quer começar a vender, os seus produtos pela internet.',
    pitch: 'Para levar os seus produtos para a internet. A gente pensa junto em como mostrar cada um, como o cliente escolhe e como ele paga, de um jeito fácil até para quem compra pelo celular.',
    items: ['Web Design', 'Desenvolvimento Web', 'E-commerce', 'Branding Digital'],
    gets: ['Uma vitrine organizada para os seus produtos', 'Página de cada produto, com fotos e detalhes', 'Compra e pagamento pelo próprio site', 'A cara da sua marca em toda a loja', 'Eu te ensino a colocar e mudar produtos'],
    deadline: '', price: '',
  },
  {
    name: 'Experiência', for: 'marcas que querem ir além do básico e ser lembradas.',
    pitch: 'Para quem quer uma marca com personalidade. Criamos juntos a identidade visual e um site cheio de detalhes e movimento, daqueles que fazem as pessoas lembrarem de você.',
    items: ['Branding Digital', 'Web Design', 'Desenvolvimento Web', 'Creative Dev'],
    gets: ['Logo, cores e letras da sua marca', 'Um guia simples de como usar a marca', 'Site com animações e interações sob medida', 'Abre rápido, até no celular', 'A marca aplicada também nas redes sociais'],
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
