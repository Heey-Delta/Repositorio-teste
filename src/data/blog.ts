// Lista dos posts do blog. Cada post é uma página escrita à mão em src/pages/blog/<slug>.astro
// (com o layout ../../layouts/Blog.astro). Para publicar um post novo:
//   1. crie src/pages/blog/<slug>.astro;
//   2. adicione uma entrada aqui, com o mesmo <slug>.
// A landing page mostra os 3 mais recentes (pela data); a página /blog/ mostra todos.
export interface Post {
  slug: string;      // nome do arquivo em src/pages/blog/, sem .astro
  title: string;
  date: string;      // AAAA-MM-DD
  tag: string;
  summary: string;   // uma ou duas linhas
}

export const posts: Post[] = [
  { slug: 'exemplo-1', title: '[Título do post 1]', date: '2026-11-08', tag: '[Tema]', summary: '[Resumo de uma ou duas linhas do post.]' },
  { slug: 'exemplo-2', title: '[Título do post 2]', date: '2026-10-25', tag: '[Tema]', summary: '[Resumo de uma ou duas linhas do post.]' },
  { slug: 'exemplo-3', title: '[Título do post 3]', date: '2026-10-10', tag: '[Tema]', summary: '[Resumo de uma ou duas linhas do post.]' },
];

export const byDateDesc = (list: Post[] = posts) => [...list].sort((a, b) => b.date.localeCompare(a.date));
export const latestPosts = (n = 3) => byDateDesc().slice(0, n);
export const formatDate = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
