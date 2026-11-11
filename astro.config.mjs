import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Site estático. Estilos ficam dentro de cada página (inline) e os scripts das páginas são
// `is:inline`, então a saída não depende de caminhos absolutos como /_astro/: ela funciona em
// qualquer pasta (inclusive publicada como artefato) desde que os links entre páginas sejam relativos.
export default defineConfig({
  // endereço público: usado nas URLs canônicas, no sitemap e nos dados estruturados do laboratório
  site: 'https://hallan-dante.vercel.app',
  output: 'static',
  build: { inlineStylesheets: 'always', format: 'directory' },
  vite: { plugins: [tailwindcss()] },
});
