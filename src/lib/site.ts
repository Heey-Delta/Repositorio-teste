// Dados do site principal usados em mais de um lugar: a lista de serviços (seção Serviços e dados estruturados da home)
export const services = [
  { name: 'Web Design', desc: 'Layout das páginas no Figma, pensado primeiro para o celular.', how: 'Começo pela estrutura e pelo texto, aprovo com você e só então desenho o visual final.' },
  { name: 'Desenvolvimento Web', desc: 'O layout vira um site de verdade: leve, rápido e fácil de achar no Google.', how: 'Astro, Tailwind e JavaScript, com o site publicado e pronto para atualizar.' },
  { name: 'Landing Pages', desc: 'Uma página só, com uma oferta clara e um botão de contato.', how: 'Para lançar um produto, um serviço ou uma campanha, com foco em quem chega pelo anúncio.' },
  { name: 'E-commerce', desc: 'Loja virtual com catálogo, carrinho e pagamento.', how: 'Do cadastro dos produtos ao checkout, com a compra pensada para o celular.' },
  { name: 'Creative Dev', desc: '3D, animações e interações que fazem o site ser lembrado.', how: 'Como a cidade isométrica desta página, feita com Three.js.' },
  { name: 'Branding Digital', desc: 'Logo, cores e tipografia aplicados ao site e às redes.', how: 'Cada site da cidade tem identidade visual própria, criada do zero.' },
];

// Serviços organizados em 3 combos (seção Serviços da home). `items` usa os nomes da lista acima.
export const combos = [
  {
    name: 'Presença', for: 'Profissionais, prestadores de serviço e lançamentos.',
    pitch: 'Uma página que explica em segundos o que você faz e transforma visita em contato.',
    items: ['Web Design', 'Desenvolvimento Web', 'Landing Pages'],
  },
  {
    name: 'Loja', for: 'Negócios que querem vender os seus produtos pela internet.',
    pitch: 'Sua loja virtual com catálogo, carrinho e pagamento, pensada para vender no celular.',
    items: ['Web Design', 'Desenvolvimento Web', 'E-commerce', 'Branding Digital'],
  },
  {
    name: 'Experiência', for: 'Marcas que querem ser lembradas e se destacar da concorrência.',
    pitch: 'Identidade visual completa e um site com 3D e animações que ninguém esquece.',
    items: ['Branding Digital', 'Web Design', 'Desenvolvimento Web', 'Creative Dev'],
  },
] as const;
